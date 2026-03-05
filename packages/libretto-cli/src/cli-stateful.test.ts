import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect } from "vitest";
import { test } from "./test-fixtures";

describe("state-driven CLI subprocess behavior", () => {
  test("shows missing snapshot analyzer config", async ({ librettoCli }) => {
    const result = await librettoCli("snapshot configure --show");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No snapshot analyzer configured.");
  });

  test("configures, shows, and clears snapshot analyzer config", async ({
    librettoCli,
    workspacePath,
  }) => {
    const configure = await librettoCli("snapshot configure codex");
    expect(configure.exitCode).toBe(0);
    expect(configure.stdout).toContain("Snapshot analyzer configured.");

    const configPath = workspacePath(
      ".libretto-cli",
      "snapshot-config.json",
    );
    expect(existsSync(configPath)).toBe(true);
    const rawConfig = JSON.parse(await readFile(configPath, "utf8")) as {
      preset?: string;
    };
    expect(rawConfig.preset).toBe("codex");

    const show = await librettoCli("snapshot configure --show");
    expect(show.exitCode).toBe(0);
    expect(show.stdout).toContain("Snapshot analyzer preset: codex");

    const clear = await librettoCli("snapshot configure --clear");
    expect(clear.exitCode).toBe(0);
    expect(clear.stdout).toContain("Cleared snapshot analyzer config:");
    expect(existsSync(configPath)).toBe(false);
  });

  test("configures gemini snapshot analyzer preset", async ({
    librettoCli,
    workspacePath,
  }) => {
    const configure = await librettoCli("snapshot configure gemini");
    expect(configure.exitCode).toBe(0);
    expect(configure.stdout).toContain("Snapshot analyzer configured.");

    const configPath = workspacePath(
      ".libretto-cli",
      "snapshot-config.json",
    );
    const rawConfig = JSON.parse(await readFile(configPath, "utf8")) as {
      preset?: string;
      commandPrefix?: string[];
    };
    expect(rawConfig.preset).toBe("gemini");
    expect(rawConfig.commandPrefix).toEqual([
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
    const logPath = await seedNetworkLog("run-net", [
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
    expect(existsSync(workspacePath("tmp", "libretto-cli", "run-net", "network.jsonl"))).toBe(true);
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
    const logPath = await seedActionLog("run-actions", [
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
    expect(existsSync(workspacePath("tmp", "libretto-cli", "run-actions", "actions.jsonl"))).toBe(true);
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

  test("allows exec when session mode is missing but session is permissioned interactive", async ({
    seedSessionState,
    seedSessionPermission,
    librettoCli,
  }) => {
    await seedSessionState({
      session: "permissioned-session",
    });
    await seedSessionPermission("permissioned-session", "interactive");

    const result = await librettoCli(
      "exec \"return await page.title()\" --session permissioned-session",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("is read-only");
    expect(result.stderr).toContain(
      "No browser running for session \"permissioned-session\".",
    );
  });

  test("does not apply read-only guard when session allows actions", async ({
    seedSessionState,
    librettoCli,
  }) => {
    await seedSessionState({
      session: "interactive-session",
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
});
