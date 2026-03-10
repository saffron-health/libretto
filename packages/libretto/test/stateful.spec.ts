import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

async function writeSessionState(
  workspaceDir: string,
  state: {
    session: string;
    port?: number;
    pid?: number;
    startedAt?: string;
  },
): Promise<string> {
  const dir = join(workspaceDir, ".libretto", "sessions", state.session);
  const path = join(workspaceDir, ".libretto", "sessions", state.session, "state.json");
  await mkdir(dir, { recursive: true });
  const payload: Record<string, unknown> = {
    version: 1,
    session: state.session,
    port: state.port ?? 9222,
    pid: state.pid ?? 12345,
    startedAt: state.startedAt ?? "2026-01-01T00:00:00.000Z",
  };
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

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessToStop(
  pid: number,
  timeoutMs: number = 3_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isProcessRunning(pid);
}

const SNAPSHOT_PRESETS = ["codex", "claude", "gemini"] as const;

async function writeFakeAnalyzer(workspaceDir: string): Promise<string> {
  const analyzerPath = join(workspaceDir, "fake-analyzer.mjs");
  await writeFile(
    analyzerPath,
    `
import { writeFileSync } from "node:fs";

const preset = process.argv[2] ?? "unknown";
const args = process.argv.slice(3);
const outputIndex = args.indexOf("--output-last-message");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
const payload = JSON.stringify({
  answer: "snapshot-ok-" + preset,
  selectors: [],
  notes: "",
});

if (outputPath) {
  writeFileSync(outputPath, payload, "utf8");
}
process.stdout.write(payload);
`,
    "utf8",
  );
  return analyzerPath;
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

  test("configures custom AI command prefix and shows persisted config", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const analyzerPath = await writeFakeAnalyzer(workspaceDir);
    const configure = await librettoCli(
      `ai configure codex -- "${process.execPath}" "${analyzerPath}" "custom-prefix"`,
    );
    expect(configure.exitCode).toBe(0);
    expect(configure.stdout).toContain("AI config saved.");

    const show = await librettoCli("ai configure");
    expect(show.exitCode).toBe(0);
    expect(show.stdout).toContain("AI preset: codex");
    expect(show.stdout).toContain(
      `Command prefix: ${process.execPath} ${analyzerPath} custom-prefix`,
    );
  });

  for (const preset of SNAPSHOT_PRESETS) {
    test(`configures ${preset} and snapshot analysis works`, async ({
      librettoCli,
      workspaceDir,
    }) => {
      const session = `snapshot-${preset}`;
      const analyzerPath = await writeFakeAnalyzer(workspaceDir);
      const configure = await librettoCli(
        `ai configure ${preset} -- "${process.execPath}" "${analyzerPath}" "${preset}"`,
      );
      expect(configure.exitCode).toBe(0);
      expect(configure.stdout).toContain("AI config saved.");

      const opened = await librettoCli(
        `open https://example.com --headless --session ${session}`,
      );
      expect(opened.exitCode).toBe(0);

        const snapshot = await librettoCli(
          `snapshot --objective "Find heading" --context "Preset ${preset} snapshot smoke test" --session ${session}`,
        );
        expect(snapshot.exitCode).toBe(0);
        expect(snapshot.stdout).toContain("Interpretation:");
        expect(snapshot.stdout).toContain(`Answer: snapshot-ok-${preset}`);
    }, 45_000);
  }

  test("runs snapshot analysis when only --objective is provided", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const session = "snapshot-objective-only";
    const analyzerPath = await writeFakeAnalyzer(workspaceDir);
    const configure = await librettoCli(
      `ai configure codex -- "${process.execPath}" "${analyzerPath}" "objective-only"`,
    );
    expect(configure.exitCode).toBe(0);

    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(opened.exitCode).toBe(0);
      const snapshot = await librettoCli(
        `snapshot --objective "Find heading" --session ${session}`,
      );
      expect(snapshot.exitCode).toBe(0);
      expect(snapshot.stdout).toContain("Interpretation:");
      expect(snapshot.stdout).toContain("Answer: snapshot-ok-objective-only");
  }, 45_000);

  test("fails snapshot when --context is provided without --objective", async ({
    librettoCli,
  }) => {
    const session = "snapshot-context-only";
    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(opened.exitCode).toBe(0);
      const snapshot = await librettoCli(
        `snapshot --context "extra context only" --session ${session}`,
      );
      expect(snapshot.exitCode).toBe(1);
      expect(snapshot.stderr).toContain(
        "Couldn't run analysis: --objective is required when providing --context.",
      );
  }, 45_000);

  test("fails open when session already has an active browser", async ({
    librettoCli,
  }) => {
    const session = "already-open";
    const firstOpen = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(firstOpen.exitCode).toBe(0);
      const secondOpen = await librettoCli(
        `open https://example.com --headless --session ${session}`,
      );
      expect(secondOpen.exitCode).toBe(1);
      expect(secondOpen.stderr).toContain(
        `Session "${session}" is already open and connected to`,
      );
      expect(secondOpen.stderr).toContain(
        `libretto-cli close --session ${session}`,
      );
  }, 45_000);

  test("prints no-op message when closing a session with no browser", async ({
    librettoCli,
  }) => {
    const session = "no-browser-session";
    const result = await librettoCli(`close --session ${session}`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `No browser running for session "${session}".`,
    );
  });

  test("prints no-op message when closing all sessions and none exist", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("close --all");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No browser sessions found.");
  });

  test("rejects close --force without --all", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("close --force");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: libretto-cli close --all [--force]");
  });

  test("close --all clears stale session state files", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const firstStatePath = await writeSessionState(workspaceDir, {
      session: "stale-one",
      pid: 424_241,
      port: 65531,
    });
    const secondStatePath = await writeSessionState(workspaceDir, {
      session: "stale-two",
      pid: 424_242,
      port: 65532,
    });

    const result = await librettoCli("close --all");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Closed 2 session(s).");
    expect(existsSync(firstStatePath)).toBe(false);
    expect(existsSync(secondStatePath)).toBe(false);
  });

  test("close --all requires --force when a session ignores SIGTERM", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const session = "stubborn-sigterm";
    const stubbornChild = spawn(
      process.execPath,
      [
        "-e",
        "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
      ],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    stubbornChild.unref();
    const pid = stubbornChild.pid;
    expect(pid).toBeDefined();

    const statePath = await writeSessionState(workspaceDir, {
      session,
      pid: pid!,
      port: 65533,
    });
      const graceful = await librettoCli("close --all");
      expect(graceful.exitCode).toBe(1);
      expect(graceful.stderr).toContain(
        `Failed to close 1 session(s) gracefully: "${session}".`,
      );
      expect(graceful.stderr).toContain("Retry with: libretto-cli close --all --force");
      expect(existsSync(statePath)).toBe(true);
      expect(isProcessRunning(pid!)).toBe(true);

      const forced = await librettoCli("close --all --force");
      expect(forced.exitCode).toBe(0);
      expect(forced.stdout).toContain("Closed 1 session(s).");
      expect(forced.stdout).toContain("Force-killed 1 session(s).");
      expect(existsSync(statePath)).toBe(false);
      expect(await waitForProcessToStop(pid!, 5_000)).toBe(true);
  }, 20_000);

  test("reads and clears network logs from seeded run data", async ({
    librettoCli,
    workspaceDir,
  }) => {
    await writeSessionState(workspaceDir, {
      session: "net-session",
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

  test("exec ignores legacy mode fields and attempts to connect", async ({
    workspaceDir,
    librettoCli,
  }) => {
    const statePath = await writeSessionState(workspaceDir, {
      session: "legacy-mode-session",
      port: 65534,
    });
    const rawState = JSON.parse(await readFile(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    rawState.mode = "read-only";
    await writeFile(statePath, JSON.stringify(rawState, null, 2), "utf8");

    const result = await librettoCli(
      "exec \"return await page.title()\" --session legacy-mode-session",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "No browser running for session \"legacy-mode-session\".",
    );
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
