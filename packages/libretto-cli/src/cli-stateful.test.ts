import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect } from "vitest";
import { test } from "./test-fixtures";

describe("state-driven CLI subprocess behavior", () => {
  test("shows missing AI config", async ({ librettoCli }) => {
    const result = await librettoCli("ai configure");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No AI config set.");
  });

  test("configures, shows, and clears AI config", async ({
    librettoCli,
    workspacePath,
  }) => {
    const configure = await librettoCli("ai configure codex");
    expect(configure.exitCode).toBe(0);
    expect(configure.stdout).toContain("AI config saved.");

    const configPath = workspacePath(".libretto", "config.json");
    expect(existsSync(configPath)).toBe(true);
    const rawConfig = JSON.parse(await readFile(configPath, "utf8")) as {
      ai?: {
        preset?: string;
      };
    };
    expect(rawConfig.ai?.preset).toBe("codex");

    const show = await librettoCli("ai configure");
    expect(show.exitCode).toBe(0);
    expect(show.stdout).toContain("AI preset: codex");

    const clear = await librettoCli("ai configure --clear");
    expect(clear.exitCode).toBe(0);
    expect(clear.stdout).toContain("Cleared AI config:");

    const clearedConfig = JSON.parse(await readFile(configPath, "utf8")) as {
      version?: number;
      ai?: unknown;
    };
    expect(clearedConfig.version).toBe(1);
    expect(clearedConfig.ai).toBeUndefined();
  });

  test("configures gemini AI preset", async ({
    librettoCli,
    workspacePath,
  }) => {
    const configure = await librettoCli("ai configure gemini");
    expect(configure.exitCode).toBe(0);
    expect(configure.stdout).toContain("AI config saved.");

    const configPath = workspacePath(".libretto", "config.json");
    const rawConfig = JSON.parse(await readFile(configPath, "utf8")) as {
      ai?: {
        preset?: string;
        commandPrefix?: string[];
      };
    };
    expect(rawConfig.ai?.preset).toBe("gemini");
    expect(rawConfig.ai?.commandPrefix).toEqual([
      "gemini",
      "--output-format",
      "json",
    ]);
  });

  test("reads and clears network logs from seeded run data", async ({
    seedSessionState,
    seedNetworkLog,
    librettoCli,
    workspacePath,
  }) => {
    await seedSessionState({
      session: "net-session",
      runId: "run-net",
    });
    const logPath = await seedNetworkLog("net-session", [
      {
        ts: "2026-01-01T00:00:00.000Z",
        method: "GET",
        url: "https://example.com/a",
        status: 200,
        contentType: "application/json",
        size: 50,
        durationMs: 10,
      },
      {
        ts: "2026-01-01T00:00:01.000Z",
        method: "POST",
        url: "https://example.com/b",
        status: 201,
        contentType: "application/json",
        size: 60,
        durationMs: 20,
      },
    ]);

    const view = await librettoCli(
      "network --session net-session --method POST --last 1",
    );
    expect(view.exitCode).toBe(0);
    expect(view.stdout).toContain("POST");
    expect(view.stdout).toContain("https://example.com/b");
    expect(view.stdout).toContain("1 request(s) shown.");

    const clear = await librettoCli("network --session net-session --clear");
    expect(clear.exitCode).toBe(0);
    expect(clear.stdout).toContain("Network log cleared.");

    const cleared = await readFile(logPath, "utf8");
    expect(cleared).toBe("");
    expect(
      existsSync(workspacePath(".libretto", "sessions", "net-session", "network.jsonl")),
    ).toBe(true);
  });

  test("reads and clears action logs from seeded run data", async ({
    seedSessionState,
    seedActionLog,
    librettoCli,
    workspacePath,
  }) => {
    await seedSessionState({
      session: "actions-session",
      runId: "run-actions",
    });
    const logPath = await seedActionLog("actions-session", [
      {
        ts: "2026-01-01T00:00:00.000Z",
        action: "click",
        source: "agent",
        selector: "button#submit",
        success: true,
      },
      {
        ts: "2026-01-01T00:00:01.000Z",
        action: "fill",
        source: "user",
        selector: "input#email",
        success: true,
      },
    ]);

    const view = await librettoCli(
      "actions --session actions-session --source user --last 1",
    );
    expect(view.exitCode).toBe(0);
    expect(view.stdout).toContain("fill");
    expect(view.stdout).toContain("input#email");
    expect(view.stdout).toContain("1 action(s) shown.");

    const clear = await librettoCli(
      "actions --session actions-session --clear",
    );
    expect(clear.exitCode).toBe(0);
    expect(clear.stdout).toContain("Action log cleared.");

    const cleared = await readFile(logPath, "utf8");
    expect(cleared).toBe("");
    expect(
      existsSync(
        workspacePath(".libretto", "sessions", "actions-session", "actions.jsonl"),
      ),
    ).toBe(true);
  });

  test("blocks exec in read-only open sessions", async ({
    seedSessionState,
    librettoCli,
  }) => {
    await seedSessionState({
      session: "readonly-session",
      mode: "read-only",
    });

    const result = await librettoCli(
      "exec \"return await page.title()\" --session readonly-session",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Session \"readonly-session\" is read-only. Only a human can authorize interactive mode.",
    );
  });

  test("rejects exec when session mode is not specified", async ({
    seedSessionState,
    librettoCli,
  }) => {
    await seedSessionState({
      session: "legacy-session",
    });

    const result = await librettoCli(
      "exec \"return await page.title()\" --session legacy-session",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Session \"legacy-session\" is read-only. Only a human can authorize interactive mode.",
    );
    expect(result.stderr).toContain(
      "libretto-cli session-mode interactive --session legacy-session",
    );
  });

  test("rejects exec when session mode is missing even if permissioned interactive", async ({
    seedSessionState,
    seedSessionPermission,
    librettoCli,
  }) => {
    await seedSessionState({
      session: "permissioned-session",
      port: 65534,
    });
    await seedSessionPermission("permissioned-session", "interactive");

    const result = await librettoCli(
      "exec \"return await page.title()\" --session permissioned-session",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Session \"permissioned-session\" is read-only. Only a human can authorize interactive mode.",
    );
  });

  test("does not apply read-only guard when session allows actions", async ({
    seedSessionState,
    librettoCli,
  }) => {
    await seedSessionState({
      session: "interactive-session",
      port: 65534,
      mode: "interactive",
    });

    const result = await librettoCli(
      "exec \"return await page.title()\" --session interactive-session",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("is read-only");
    expect(result.stderr).toContain(
      "No browser running for session \"interactive-session\".",
    );
  });

  test("rejects exec after session is switched back to read-only", async ({
    seedSessionState,
    librettoCli,
  }) => {
    await seedSessionState({
      session: "flip-session",
      mode: "interactive",
    });

    const setReadOnly = await librettoCli(
      "session-mode read-only --session flip-session",
    );
    expect(setReadOnly.exitCode).toBe(0);
    expect(setReadOnly.stdout).toContain(
      "Session \"flip-session\" is now read-only.",
    );

    const result = await librettoCli(
      "exec \"return await page.title()\" --session flip-session",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Session \"flip-session\" is read-only. Only a human can authorize interactive mode.",
    );
    expect(result.stderr).toContain(
      "libretto-cli session-mode interactive --session flip-session",
    );
  });

  test("rejects session state files with unsupported version", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "invalid-version-session";
    const sessionDir = workspacePath(".libretto", "sessions", session);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      workspacePath(".libretto", "sessions", session, "state.json"),
      JSON.stringify(
        {
          version: 2,
          session,
          runId: "run-invalid-version",
          port: 65534,
          pid: 12345,
          startedAt: "2026-01-01T00:00:00.000Z",
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await librettoCli(
      `exec "return await page.title()" --session ${session}`,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`Could not read session state for "${session}"`);
    expect(result.stderr).toContain("version");
  });
});
