import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

async function writeSessionState(
  workspaceDir: string,
  state: {
    session: string;
    runId?: string;
    port?: number;
    pid?: number;
    startedAt?: string;
    mode?: "read-only" | "full-access";
  },
): Promise<string> {
  const dir = join(workspaceDir, ".libretto", "sessions", state.session);
  const path = join(workspaceDir, ".libretto", "sessions", state.session, "state.json");
  await mkdir(dir, { recursive: true });
  const payload: Record<string, unknown> = {
    version: 1,
    session: state.session,
    runId: state.runId ?? "run-seeded",
    port: state.port ?? 9222,
    pid: state.pid ?? 12345,
    startedAt: state.startedAt ?? "2026-01-01T00:00:00.000Z",
  };
  if (state.mode) payload.mode = state.mode;
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
}

async function writeJsonl(
  workspaceDir: string,
  session: string,
  fileName: "network.jsonl" | "actions.jsonl",
  entries: Record<string, unknown>[],
): Promise<string> {
  const sessionDir = join(workspaceDir, ".libretto", "sessions", session);
  const filePath = join(workspaceDir, ".libretto", "sessions", session, fileName);
  await mkdir(sessionDir, { recursive: true });
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
  await writeFile(filePath, body ? `${body}\n` : "", "utf8");
  return filePath;
}

describe("state-driven CLI subprocess behavior", () => {
  test("shows missing AI config", async ({ librettoCli }) => {
    const result = await librettoCli("ai configure");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No AI config set.");
  });

  test("configures, shows, and clears AI config", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const configure = await librettoCli("ai configure codex");
    expect(configure.exitCode).toBe(0);
    expect(configure.stdout).toContain("AI config saved.");

    const configPath = join(workspaceDir, ".libretto", "config.json");
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
    workspaceDir,
  }) => {
    const configure = await librettoCli("ai configure gemini");
    expect(configure.exitCode).toBe(0);
    expect(configure.stdout).toContain("AI config saved.");

    const configPath = join(workspaceDir, ".libretto", "config.json");
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
    librettoCli,
    workspaceDir,
  }) => {
    await writeSessionState(workspaceDir, {
      session: "net-session",
      runId: "run-net",
    });
    const logPath = await writeJsonl(workspaceDir, "net-session", "network.jsonl", [
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
      existsSync(join(workspaceDir, ".libretto", "sessions", "net-session", "network.jsonl")),
    ).toBe(true);
  });

  test("reads and clears action logs from seeded run data", async ({
    librettoCli,
    workspaceDir,
  }) => {
    await writeSessionState(workspaceDir, {
      session: "actions-session",
      runId: "run-actions",
    });
    const logPath = await writeJsonl(workspaceDir, "actions-session", "actions.jsonl", [
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
        join(workspaceDir, ".libretto", "sessions", "actions-session", "actions.jsonl"),
      ),
    ).toBe(true);
  });

  test("blocks exec in read-only open sessions", async ({
    workspaceDir,
    librettoCli,
  }) => {
    await writeSessionState(workspaceDir, {
      session: "readonly-session",
      mode: "read-only",
    });

    const result = await librettoCli(
      "exec \"return await page.title()\" --session readonly-session",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Session \"readonly-session\" is read-only. Only a human can authorize full-access mode.",
    );
  });

  test("rejects exec when session mode is not specified", async ({
    workspaceDir,
    librettoCli,
  }) => {
    await writeSessionState(workspaceDir, {
      session: "legacy-session",
    });

    const result = await librettoCli(
      "exec \"return await page.title()\" --session legacy-session",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Session \"legacy-session\" is read-only. Only a human can authorize full-access mode.",
    );
    expect(result.stderr).toContain(
      "libretto-cli session-mode full-access --session legacy-session",
    );
  });

  test("rejects exec when session mode is missing even if permissioned full-access", async ({
    workspaceDir,
    librettoCli,
  }) => {
    await writeSessionState(workspaceDir, {
      session: "permissioned-session",
      port: 65534,
    });
    await mkdir(join(workspaceDir, ".libretto"), { recursive: true });
    await writeFile(
      join(workspaceDir, ".libretto", "config.json"),
      JSON.stringify(
        {
          version: 1,
          permissions: {
            sessions: {
              "permissioned-session": "full-access",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await librettoCli(
      "exec \"return await page.title()\" --session permissioned-session",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Session \"permissioned-session\" is read-only. Only a human can authorize full-access mode.",
    );
  });

  test("does not apply read-only guard when session allows actions", async ({
    workspaceDir,
    librettoCli,
  }) => {
    await writeSessionState(workspaceDir, {
      session: "interactive-session",
      port: 65534,
      mode: "full-access",
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
    workspaceDir,
    librettoCli,
  }) => {
    await writeSessionState(workspaceDir, {
      session: "flip-session",
      mode: "full-access",
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
      "Session \"flip-session\" is read-only. Only a human can authorize full-access mode.",
    );
    expect(result.stderr).toContain("libretto-cli session-mode full-access --session flip-session");
  });

  test("rejects session state files with unsupported version", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const session = "invalid-version-session";
    const sessionDir = join(workspaceDir, ".libretto", "sessions", session);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(workspaceDir, ".libretto", "sessions", session, "state.json"),
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
