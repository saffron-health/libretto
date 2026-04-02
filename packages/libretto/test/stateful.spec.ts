import { existsSync } from "node:fs";
import { describe, expect } from "vitest";
import { test } from "./fixtures";

function extractReturnedSessionId(output: string): string | null {
  const patterns = [
    /\(session:\s*([a-zA-Z0-9._-]+)\)/i,
    /session id[:=]\s*([a-zA-Z0-9._-]+)/i,
    /session[:=]\s*([a-zA-Z0-9._-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function requireReturnedSessionId(
  command: string,
  stdout: string,
  stderr: string,
): string {
  const combined = `${stdout}\n${stderr}`;
  const sessionId = extractReturnedSessionId(combined);
  if (!sessionId) {
    throw new Error(
      `Could not find a returned session id for "${command}".\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  return sessionId;
}

function expectMissingSessionError(output: string, session: string): void {
  expect(output).toContain(`No session "${session}" found.`);
  expect(output).toContain("No active sessions.");
  expect(output).toContain("Start one with:");
  expect(output).toContain(`libretto open <url> --session ${session}`);
}

describe("state-driven CLI subprocess behavior", () => {
  test("shows missing AI config", async ({ librettoCli }) => {
    const result = await librettoCli("ai configure");
    expect(result.stdout).toContain("No AI config set.");
    expect(result.stderr).toBe("");
  });

  test("configures, shows, and clears AI config", async ({ librettoCli }) => {
    const configure = await librettoCli("ai configure openai");
    expect(configure.stdout).toContain("AI config saved.");
    expect(configure.stdout).toContain("Model: openai/gpt-5.4");
    expect(configure.stderr).toBe("");

    const show = await librettoCli("ai configure");
    expect(show.stdout).toContain("Model: openai/gpt-5.4");
    expect(show.stderr).toBe("");

    const clear = await librettoCli("ai configure --clear");
    expect(clear.stdout).toContain("Cleared AI config:");
    expect(clear.stderr).toBe("");

    const showAfterClear = await librettoCli("ai configure");
    expect(showAfterClear.stdout).toContain("No AI config set.");
    expect(showAfterClear.stderr).toBe("");
  });

  test("configures anthropic provider", async ({ librettoCli }) => {
    const configure = await librettoCli("ai configure anthropic");
    expect(configure.stdout).toContain("AI config saved.");

    const show = await librettoCli("ai configure");
    expect(show.stdout).toContain("Model: anthropic/claude-sonnet-4-6");
  });

  test("configures gemini provider", async ({ librettoCli }) => {
    const configure = await librettoCli("ai configure gemini");
    expect(configure.stdout).toContain("AI config saved.");

    const show = await librettoCli("ai configure");
    expect(show.stdout).toContain("Model: google/gemini-3-flash-preview");
  });

  test("configures vertex provider", async ({ librettoCli }) => {
    const configure = await librettoCli("ai configure vertex");
    expect(configure.stdout).toContain("AI config saved.");

    const show = await librettoCli("ai configure");
    expect(show.stdout).toContain("Model: vertex/gemini-2.5-pro");
  });

  test("configures custom model string", async ({ librettoCli }) => {
    const configure = await librettoCli("ai configure openai/gpt-4o");
    expect(configure.stdout).toContain("AI config saved.");

    const show = await librettoCli("ai configure");
    expect(show.stdout).toContain("Model: openai/gpt-4o");
  });

  test("snapshot without --objective shows a clear error", async ({
    librettoCli,
  }) => {
    const session = "snapshot-no-objective";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const snapshot = await librettoCli(`snapshot --session ${session}`);
    expect(snapshot.exitCode).not.toBe(0);
    expect(snapshot.stderr).toContain("Missing required option --objective.");
  }, 45_000);

  test("snapshot --objective requires API credentials", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "snapshot-no-creds";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const snapshot = await librettoCli(
      `snapshot --objective "Find heading" --context "Testing credentials" --session ${session}`,
      {
        LIBRETTO_DISABLE_DOTENV: "1",
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        GEMINI_API_KEY: "",
        GOOGLE_GENERATIVE_AI_API_KEY: "",
        GOOGLE_CLOUD_PROJECT: "",
        GCLOUD_PROJECT: "",
      },
    );
    expect(snapshot.exitCode).not.toBe(0);
    expect(snapshot.stdout).not.toContain("Screenshot saved:");
    expect(snapshot.stderr).toContain(
      "Failed to analyze snapshot because no snapshot analyzer is configured.",
    );
    expect(snapshot.stderr).toContain(
      "For more info, run `npx libretto setup`.",
    );
    expect(
      existsSync(workspacePath(".libretto", "sessions", session, "snapshots")),
    ).toBe(false);
  }, 45_000);

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
    expect(snapshot.exitCode).not.toBe(0);
    expect(snapshot.stderr).toContain("Missing required option --objective.");
  }, 45_000);

  test("open without --session auto-generates a session", async ({
    librettoCli,
  }) => {
    const opened = await librettoCli("open https://example.com --headless");
    expect(opened.stdout).toContain("Browser open");
    expect(opened.stdout).toContain("example.com");
    const sessionId = requireReturnedSessionId(
      "open",
      opened.stdout,
      opened.stderr,
    );
    expect(sessionId).toBeTruthy();
  }, 60_000);

  test("shows a clear error when opening an already active session", async ({
    librettoCli,
  }) => {
    const session = "already-open";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const secondOpen = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    expect(secondOpen.stderr).toContain(
      `Session "${session}" is already open and connected to`,
    );
    expect(secondOpen.stderr).toContain(`libretto close --session ${session}`);
  }, 45_000);

  test("shows recovery guidance when a session-backed command targets a missing session", async ({
    librettoCli,
  }) => {
    const session = "missing-session";
    const result = await librettoCli(`pages --session ${session}`);

    expect(result.stdout).toBe("");
    expectMissingSessionError(result.stderr, session);
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

  test("rejects close --force without --all", async ({ librettoCli }) => {
    const result = await librettoCli("close --force");
    expect(result.stderr).toContain("Usage: libretto close --all [--force]");
  });

  test("close --all closes active sessions", async ({ librettoCli }) => {
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
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

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
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    await librettoCli(
      `exec "await page.reload(); return await page.url();" --session ${session}`,
    );

    const view = await librettoCli(`actions --session ${session} --last 5`);
    expect(view.stdout).toContain("[AGENT]");
    expect(view.stdout).toMatch(/reload|goto/);
    expect(view.stdout).toContain("action(s) shown.");

    const clear = await librettoCli(`actions --session ${session} --clear`);
    expect(clear.stdout).toContain("Action log cleared.");
  }, 60_000);

  test("status shows AI config and open sessions", async ({ librettoCli }) => {
    // Configure AI model
    const configure = await librettoCli("ai configure openai");
    expect(configure.stdout).toContain("AI config saved.");

    // Open a headless session
    const session = "status-test-session";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    // Run status and verify both AI model and session appear
    const status = await librettoCli("status");
    expect(status.stdout).toContain("AI configuration:");
    expect(status.stdout).toContain("openai/gpt-5.4");
    expect(status.stdout).toContain("Open sessions:");
    expect(status.stdout).toContain(session);
    expect(status.stdout).toContain("http://127.0.0.1:");
  }, 45_000);

  test("status shows no open sessions when none exist", async ({
    librettoCli,
  }) => {
    const status = await librettoCli("status");
    expect(status.stdout).toContain("No open sessions.");
  });

  test("logs richer user action selectors for nested click targets", async ({
    librettoCli,
  }) => {
    const session = "actions-rich-user-log";
    const html = encodeURIComponent(
      `<button id="saveBtn" aria-label="Save record"><span>Save</span></button>`,
    );
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    await librettoCli(
      `exec "await page.goto('data:text/html,${html}'); return await page.url();" --session ${session}`,
    );
    await librettoCli(
      `exec "await page.evaluate(() => { const target = document.querySelector('#saveBtn span'); if (!(target instanceof HTMLElement)) throw new Error('Missing nested span target'); target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 42, clientY: 24 })); });" --session ${session}`,
    );

    const view = await librettoCli(
      `actions --session ${session} --action dblclick --source user --last 5`,
    );
    expect(view.stdout).toContain("dblclick");
    expect(view.stdout).toContain("button#saveBtn");
    expect(view.stdout).toContain("target=span");
    expect(view.stdout).toContain('text="Save"');
    expect(view.stdout).toContain("@(42,24)");
  }, 60_000);
});
