import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

const SNAPSHOT_PRESETS = ["codex", "claude", "gemini"] as const;

async function writeFakeAnalyzer(workspaceDir: string): Promise<string> {
  const analyzerPath = join(workspaceDir, "fake-analyzer.mjs");
  await writeFile(
    analyzerPath,
    `
import { writeFileSync } from "node:fs";

const preset = process.argv[2] ?? "unknown";
const args = process.argv.slice(3);
const stdinChunks = [];
for await (const chunk of process.stdin) {
  stdinChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
}
const stdinText = Buffer.concat(stdinChunks).toString("utf8");
const outputIndex = args.indexOf("--output-last-message");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
const payload = JSON.stringify({
  answer: "snapshot-ok-" + preset,
  selectors: [],
  notes: "stdin-has-objective=" + stdinText.includes("Find heading") + ";argv-has-objective=" + args.some((arg) => arg.includes("Find heading")),
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

async function writeEarlyExitAnalyzer(workspaceDir: string): Promise<string> {
  const analyzerPath = join(workspaceDir, "early-exit-analyzer.mjs");
  await writeFile(
    analyzerPath,
    `
process.stderr.write("simulated analyzer exit\\n");
process.exit(1);
`,
    "utf8",
  );
  return analyzerPath;
}

describe("state-driven CLI subprocess behavior", () => {
  test("shows missing AI config", async ({ librettoCli, evaluate }) => {
    const result = await librettoCli("ai configure");
    await evaluate(result.stdout).toMatch(
      "Explains that no AI config is currently set.",
    );
    expect(result.stderr).toBe("");
  });

  test("configures, shows, and clears AI config", async ({
    librettoCli,
    evaluate,
  }) => {
    const configure = await librettoCli("ai configure codex");
    await evaluate(configure.stdout).toMatch(
      "Confirms the AI config was saved.",
    );
    expect(configure.stderr).toBe("");

    const show = await librettoCli("ai configure");
    await evaluate(show.stdout).toMatch(
      "Shows that the configured AI preset is codex.",
    );
    expect(show.stderr).toBe("");

    const clear = await librettoCli("ai configure --clear");
    await evaluate(clear.stdout).toMatch(
      "Confirms the AI config was cleared.",
    );
    expect(clear.stderr).toBe("");

    const showAfterClear = await librettoCli("ai configure");
    await evaluate(showAfterClear.stdout).toMatch(
      "Explains that no AI config is currently set.",
    );
    expect(showAfterClear.stderr).toBe("");
  });

  test("configures gemini AI preset", async ({ librettoCli, evaluate }) => {
    const configure = await librettoCli("ai configure gemini");
    await evaluate(configure.stdout).toMatch(
      "Confirms the AI config was saved.",
    );

    const show = await librettoCli("ai configure");
    await evaluate(show.stdout).toMatch(
      "Shows that the configured AI preset is gemini.",
    );
  });

  test("configures custom AI command prefix and shows it", async ({
    librettoCli,
    evaluate,
    workspaceDir,
  }) => {
    const analyzerPath = await writeFakeAnalyzer(workspaceDir);
    const configure = await librettoCli(
      `ai configure codex -- "${process.execPath}" "${analyzerPath}" "custom-prefix"`,
    );
    await evaluate(configure.stdout).toMatch(
      "Confirms the AI config was saved.",
    );

    const show = await librettoCli("ai configure");
    await evaluate(show.stdout).toMatch(
      `Shows that the AI preset is codex and includes the custom command prefix "${process.execPath} ${analyzerPath} custom-prefix".`,
    );
  });

  for (const preset of SNAPSHOT_PRESETS) {
    test(`configures ${preset} and snapshot analysis works`, async ({
      librettoCli,
      evaluate,
      workspaceDir,
    }) => {
      const session = `snapshot-${preset}`;
      const analyzerPath = await writeFakeAnalyzer(workspaceDir);
      await librettoCli(
        `ai configure ${preset} -- "${process.execPath}" "${analyzerPath}" "${preset}"`,
      );

      const opened = await librettoCli(
        `open https://example.com --headless --session ${session}`,
      );
      await evaluate(opened.stdout).toMatch(
        `Confirms the browser opened successfully for example.com in session "${session}".`,
      );

      const snapshot = await librettoCli(
        `snapshot --objective "Find heading" --context "Preset ${preset} snapshot smoke test" --session ${session}`,
      );
      await evaluate(snapshot.stdout).toMatch(
        `Includes an interpretation and the answer snapshot-ok-${preset}.`,
      );
    }, 45_000);
  }

  test("runs snapshot analysis when only --objective is provided", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const session = "snapshot-objective-only";
    const analyzerPath = await writeFakeAnalyzer(workspaceDir);
    await librettoCli(
      `ai configure codex -- "${process.execPath}" "${analyzerPath}" "objective-only"`,
    );

    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(opened.stdout).toContain("Browser open");

    const snapshot = await librettoCli(
      `snapshot --objective "Find heading" --session ${session}`,
    );
    expect(snapshot.stdout).toContain("Interpretation:");
    expect(snapshot.stdout).toContain("Answer: snapshot-ok-objective-only");
  }, 45_000);

  test("surfaces analyzer early exit without crashing on stdin pipe errors", async ({
    librettoCli,
    workspaceDir,
  }) => {
    const session = "snapshot-analyzer-early-exit";
    const analyzerPath = await writeEarlyExitAnalyzer(workspaceDir);
    await librettoCli(
      `ai configure codex -- "${process.execPath}" "${analyzerPath}"`,
    );

    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(opened.stdout).toContain("Browser open");

    const snapshot = await librettoCli(
      `snapshot --objective "Find heading" --session ${session}`,
    );
    expect(snapshot.exitCode).toBe(1);
    expect(snapshot.stderr).toContain("Analyzer command failed");
    expect(snapshot.stderr).toContain("simulated analyzer exit");
    expect(snapshot.stderr).not.toContain("Unhandled 'error' event");
  }, 45_000);

  for (const preset of ["claude", "gemini"] as const) {
    test(`${preset} snapshot analysis sends prompt via stdin instead of argv`, async ({
      librettoCli,
      workspaceDir,
    }) => {
      const session = `snapshot-${preset}-stdin`;
      const analyzerPath = await writeFakeAnalyzer(workspaceDir);
      await librettoCli(
        `ai configure ${preset} -- "${process.execPath}" "${analyzerPath}" "${preset}"`,
      );

      const opened = await librettoCli(
        `open https://example.com --headless --session ${session}`,
      );
      expect(opened.stdout).toContain("Browser open");

      const snapshot = await librettoCli(
        `snapshot --objective "Find heading" --context "${preset} stdin verification" --session ${session}`,
      );
      expect(snapshot.stdout).toContain("Interpretation:");
      expect(snapshot.stdout).toContain("stdin-has-objective=true");
      expect(snapshot.stdout).toContain("argv-has-objective=false");
    }, 45_000);
  }

  test("shows a clear error when --context is provided without --objective", async ({
    librettoCli,
  }) => {
    const session = "snapshot-context-only";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const snapshot = await librettoCli(
      `snapshot --context "extra context only" --session ${session}`,
    );
    expect(snapshot.stderr).toContain(
      "Couldn't run analysis: --objective is required when providing --context.",
    );
  }, 45_000);

  test("open without --session uses the default session", async ({
    librettoCli,
    evaluate,
  }) => {
    const opened = await librettoCli("open https://example.com --headless");
    await evaluate(opened.stdout).toMatch(
      "Confirms the browser opened successfully for example.com using the default session.",
    );

    const snapshot = await librettoCli("snapshot --session default");
    expect(snapshot.stdout).toContain("Screenshot saved:");
  }, 60_000);

  test("shows a clear error when opening an already active session", async ({
    librettoCli,
  }) => {
    const session = "already-open";
    await librettoCli(`open https://example.com --headless --session ${session}`);

    const secondOpen = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(secondOpen.stderr).toContain(
      `Session "${session}" is already open and connected to`,
    );
    expect(secondOpen.stderr).toContain(
      `libretto-cli close --session ${session}`,
    );
  }, 45_000);

  test("shows recovery guidance when a session-backed command targets a missing session", async ({
    librettoCli,
    evaluate,
  }) => {
    const session = "missing-session";
    const result = await librettoCli(`pages --session ${session}`);

    expect(result.stdout).toBe("");
    await evaluate(result.stderr).toMatch(
      'Explains that session "missing-session" does not exist, no active sessions are available, and suggests opening a session with libretto-cli open <url> --session missing-session.',
    );
    expect(result.stderr.trimEnd().split("\n")).toEqual([
      `No session "${session}" found.`,
      "",
      "No active sessions.",
      "",
      "Start one with:",
      `  libretto-cli open <url> --session ${session}`,
    ]);
  });

  test("prints no-op message when closing a session with no browser", async ({
    librettoCli,
  }) => {
    const session = "no-browser-session";
    const result = await librettoCli(`close --session ${session}`);
    expect(result.stdout).toContain(
      `No browser running for session "${session}".`,
    );
  });

  test("prints no-op message when closing all sessions and none exist", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("close --all");
    expect(result.stdout).toContain("No browser sessions found.");
  });

  test("rejects close --force without --all", async ({
    librettoCli,
  }) => {
    const result = await librettoCli("close --force");
    expect(result.stderr).toContain("Usage: libretto-cli close --all [--force]");
  });

  test("close --all closes active sessions", async ({
    librettoCli,
  }) => {
    const sessionOne = "close-all-session-one";
    const sessionTwo = "close-all-session-two";

    await librettoCli(
      `open https://example.com --headless --session ${sessionOne}`,
    );
    await librettoCli(
      `open https://example.com --headless --session ${sessionTwo}`,
    );

    const closeAll = await librettoCli("close --all");
    expect(closeAll.stdout).toContain("Closed 2 session(s).");

    const closeOne = await librettoCli(`close --session ${sessionOne}`);
    expect(closeOne.stdout).toContain(
      `No browser running for session "${sessionOne}".`,
    );

    const closeTwo = await librettoCli(`close --session ${sessionTwo}`);
    expect(closeTwo.stdout).toContain(
      `No browser running for session "${sessionTwo}".`,
    );
  }, 45_000);

  test("reads and clears network logs for a live session", async ({
    librettoCli,
  }) => {
    const session = "network-live-session";
    await librettoCli(`open https://example.com --headless --session ${session}`);

    await librettoCli(
      `exec "await page.goto('https://example.com/?network=one'); return await page.url();" --session ${session}`,
    );

    const view = await librettoCli(`network --session ${session} --last 5`);
    expect(view.stdout).toContain("example.com/?network=one");
    expect(view.stdout).toContain("request(s) shown.");

    const clear = await librettoCli(`network --session ${session} --clear`);
    expect(clear.stdout).toContain("Network log cleared.");
  }, 60_000);

  test("reads and clears action logs for a live session", async ({
    librettoCli,
  }) => {
    const session = "actions-live-session";
    await librettoCli(`open https://example.com --headless --session ${session}`);

    await librettoCli(
      `exec "await page.reload(); return await page.url();" --session ${session}`,
    );

    const view = await librettoCli(`actions --session ${session} --last 5`);
    expect(view.stdout).toContain("[AGENT]");
    expect(view.stdout).toMatch(/(reload|goto)/);
    expect(view.stdout).toContain("action(s) shown.");

    const clear = await librettoCli(`actions --session ${session} --clear`);
    expect(clear.stdout).toContain("Action log cleared.");
  }, 60_000);
});
