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

describe("state-driven CLI subprocess behavior", () => {
  test("shows missing AI config", async ({ librettoCli }) => {
    const result = await librettoCli("ai configure");
    expect(result.stdout).toContain("No AI config set.");
  });

  test("configures, shows, and clears AI config", async ({
    librettoCli,
  }) => {
    const configure = await librettoCli("ai configure openai");
    expect(configure.stdout).toContain("AI config saved.");

    const show = await librettoCli("ai configure");
    expect(show.stdout).toContain("Model: openai/gpt-5.4");

    const clear = await librettoCli("ai configure --clear");
    expect(clear.stdout).toContain("Cleared AI config:");

    const showAfterClear = await librettoCli("ai configure");
    expect(showAfterClear.stdout).toContain("No AI config set.");
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
    expect(show.stdout).toContain("Model: google/gemini-2.5-flash");
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

  test("snapshot without --objective captures files without analysis", async ({
    librettoCli,
  }) => {
    const session = "snapshot-no-objective";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const snapshot = await librettoCli(
      `snapshot --session ${session}`,
    );
    expect(snapshot.stdout).toContain("Screenshot saved:");
    expect(snapshot.stdout).toContain("PNG:");
    expect(snapshot.stdout).toContain("HTML:");
    expect(snapshot.stdout).toContain("Condensed HTML:");
    expect(snapshot.stdout).toContain("Use --objective flag to analyze snapshots.");
  }, 45_000);

  test("snapshot --objective requires API credentials", async ({
    librettoCli,
  }) => {
    const session = "snapshot-no-creds";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const snapshot = await librettoCli(
      `snapshot --objective "Find heading" --session ${session}`,
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
    expect(snapshot.stderr).toContain("No API snapshot analyzer is available");
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
    expect(snapshot.stderr).toContain(
      "Couldn't run analysis: --objective is required when providing --context.",
    );
  }, 45_000);

  test("open without --session returns a session id usable by snapshot", async ({
    librettoCli,
  }) => {
    const opened = await librettoCli("open https://example.com --headless");
    expect(opened.stdout).toContain("Browser open");
    const session = extractReturnedSessionId(`${opened.stdout}\n${opened.stderr}`);
    expect(session).toMatch(/^ses-\d{4}$/);

    const snapshot = await librettoCli(`snapshot --session ${session}`);
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
    evaluate,
  }) => {
    const session = "network-live-session";
    await librettoCli(`open https://example.com --headless --session ${session}`);

    await librettoCli(
      `exec "await page.goto('https://example.com/?network=one'); return await page.url();" --session ${session}`,
    );

    const view = await librettoCli(`network --session ${session} --last 5`);
    await evaluate(view.stdout).toMatch(
      "Shows at least one network request result for the session.",
    );

    const clear = await librettoCli(`network --session ${session} --clear`);
    expect(clear.stdout).toContain("Network log cleared.");
  }, 60_000);

  test("reads and clears action logs for a live session", async ({
    librettoCli,
    evaluate,
  }) => {
    const session = "actions-live-session";
    await librettoCli(`open https://example.com --headless --session ${session}`);

    await librettoCli(
      `exec "await page.reload(); return await page.url();" --session ${session}`,
    );

    const view = await librettoCli(`actions --session ${session} --last 5`);
    await evaluate(view.stdout).toMatch(
      "Shows at least one action result for the session.",
    );

    const clear = await librettoCli(`actions --session ${session} --clear`);
    expect(clear.stdout).toContain("Action log cleared.");
  }, 60_000);
});
