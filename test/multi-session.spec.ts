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

describe("multi-session CLI behavior", () => {
  test("open without --session uses the default session and blocks a second open", async ({
    librettoCli,
    evaluate,
  }) => {
    const firstOpen = await librettoCli("open https://example.com --headless");
    await evaluate(firstOpen.stdout).toMatch(
      'Confirms the browser opened successfully for example.com in session "default".',
    );
    const firstSessionId = requireReturnedSessionId(
      "open",
      firstOpen.stdout,
      firstOpen.stderr,
    );
    expect(firstSessionId).toBe("default");

    const secondOpen = await librettoCli("open https://example.com --headless");
    await evaluate(secondOpen.stderr).toMatch(
      'Explains that session "default" is already open and suggests closing it or using a different session name.',
    );
  }, 60_000);

  test("run twice without --session creates distinct sessions", async ({
    librettoCli,
    evaluate,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-auto-session.mjs",
      `
export const main = workflow({}, async () => {
  console.log("AUTO_SESSION_RUN_OK");
});
`,
    );

    const firstRun = await librettoCli(
      `run "${integrationFilePath}" main --headless`,
    );
    await evaluate(firstRun.stdout).toMatch(
      "Includes AUTO_SESSION_RUN_OK and confirms the integration completed successfully.",
    );

    const secondRun = await librettoCli(
      `run "${integrationFilePath}" main --headless`,
    );
    await evaluate(secondRun.stdout).toMatch(
      "Includes AUTO_SESSION_RUN_OK and confirms the integration completed successfully.",
    );
    expect(secondRun.stderr).not.toContain("is already open and connected to");
  }, 90_000);

  test("exec without --session targets the default session and explains recovery when it is missing", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli(`exec "return 1"`);
    await evaluate(result.stderr).toMatch(
      'Explains that the default session is missing, that no active sessions exist, and suggests starting one with "libretto open <url> --session default".',
    );
  });

  test("exec accepts unquoted multi-token code", async ({
    librettoCli,
    evaluate,
  }) => {
    const result = await librettoCli("exec await page.title()");
    await evaluate(result.stderr).toMatch(
      'Explains that the default session is missing, that no active sessions exist, and suggests starting one with "libretto open <url> --session default".',
    );
    expect(result.stderr).not.toContain("Unexpected arguments for exec.");
  });

  test("close --all works without --session", async ({ librettoCli }) => {
    await librettoCli("open https://example.com --headless");
    await librettoCli("open https://example.com --headless --session close-all-second");

    const closeAll = await librettoCli("close --all");
    expect(closeAll.stdout).toContain("Closed 2 session(s).");
  }, 60_000);

  test("explicit --session is used as-is", async ({ librettoCli, evaluate }) => {
    const session = "explicit-session-e2e";
    const opened = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    const returnedSessionId = requireReturnedSessionId(
      "open",
      opened.stdout,
      opened.stderr,
    );
    expect(returnedSessionId).toBe(session);

    const secondOpen = await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );
    await evaluate(secondOpen.stderr).toMatch(
      `Explains that session "${session}" is already open and suggests closing it or choosing another session.`,
    );
  }, 60_000);
});
