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
  test("open twice without --session creates distinct sessions", async ({
    librettoCli,
  }) => {
    const firstOpen = await librettoCli("open https://example.com --headless");
    expect(firstOpen.stdout).toContain("Browser open");
    const firstSessionId = requireReturnedSessionId(
      "open",
      firstOpen.stdout,
      firstOpen.stderr,
    );

    const secondOpen = await librettoCli("open https://example.com --headless");
    expect(secondOpen.stderr).not.toContain(
      `Session "${firstSessionId}" is already open and connected to`,
    );
    expect(secondOpen.stdout).toContain("Browser open");
    const secondSessionId = requireReturnedSessionId(
      "open",
      secondOpen.stdout,
      secondOpen.stderr,
    );

    expect(secondSessionId).not.toBe(firstSessionId);
  }, 60_000);

  test("run twice without --session creates distinct sessions", async ({
    librettoCli,
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
    expect(firstRun.stdout).toContain("AUTO_SESSION_RUN_OK");
    expect(firstRun.stdout).toContain("Integration completed.");
    const firstSessionId = requireReturnedSessionId(
      "run",
      firstRun.stdout,
      firstRun.stderr,
    );

    const secondRun = await librettoCli(
      `run "${integrationFilePath}" main --headless`,
    );
    expect(secondRun.stderr).not.toContain(
      `Session "${firstSessionId}" is already open and connected to`,
    );
    expect(secondRun.stdout).toContain("AUTO_SESSION_RUN_OK");
    expect(secondRun.stdout).toContain("Integration completed.");
    const secondSessionId = requireReturnedSessionId(
      "run",
      secondRun.stdout,
      secondRun.stderr,
    );

    expect(secondSessionId).not.toBe(firstSessionId);
  }, 90_000);

  test("exec without --session explains a session is required", async ({
    librettoCli,
  }) => {
    const result = await librettoCli(`exec "return 1"`);
    expect(result.stderr).toContain(`Missing required --session for "exec".`);
    expect(result.stderr).toContain("Pass --session <name>");
  });

  test("close --all works without --session", async ({ librettoCli }) => {
    await librettoCli("open https://example.com --headless");
    await librettoCli("open https://example.com --headless");

    const closeAll = await librettoCli("close --all");
    expect(closeAll.stdout).toContain("Closed 2 session(s).");
  }, 60_000);

  test("explicit --session is used as-is", async ({ librettoCli }) => {
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
    expect(secondOpen.stderr).toContain(
      `Session "${session}" is already open and connected to`,
    );
  }, 60_000);
});
