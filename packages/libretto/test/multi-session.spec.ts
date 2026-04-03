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
  test("open without --session auto-generates distinct sessions", async ({
    librettoCli,
  }) => {
    const firstOpen = await librettoCli("open https://example.com --headless");
    expect(firstOpen.stdout).toContain("Browser open");
    expect(firstOpen.stdout).toContain("example.com");
    const firstSessionId = requireReturnedSessionId(
      "open",
      firstOpen.stdout,
      firstOpen.stderr,
    );

    const secondOpen = await librettoCli("open https://example.com --headless");
    expect(secondOpen.stdout).toContain("Browser open");
    expect(secondOpen.stdout).toContain("example.com");
    const secondSessionId = requireReturnedSessionId(
      "open",
      secondOpen.stdout,
      secondOpen.stderr,
    );
    expect(firstSessionId).not.toBe(secondSessionId);
  }, 60_000);

  test("run twice without --session creates distinct sessions", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-auto-session.mjs",
      `
export default workflow("main", async () => {
  console.log("AUTO_SESSION_RUN_OK");
});
`,
    );

    const firstRun = await librettoCli(`run "${integrationFilePath}" --headless`);
    expect(firstRun.stdout).toContain("AUTO_SESSION_RUN_OK");
    expect(firstRun.stdout).toContain("Integration completed.");

    const secondRun = await librettoCli(
      `run "${integrationFilePath}" --headless`,
    );
    expect(secondRun.stdout).toContain("AUTO_SESSION_RUN_OK");
    expect(secondRun.stdout).toContain("Integration completed.");
    expect(secondRun.stderr).not.toContain("is already open and connected to");
  }, 90_000);

  test("run creates a fresh write-access session even if another session is read-only", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const unrelatedSession = "unrelated-readonly-session";
    await librettoCli(
      `open https://example.com --headless --read-only --session ${unrelatedSession}`,
    );

    const integrationFilePath = await writeWorkflow(
      "integration-run-write-access.mjs",
      `
export default workflow("main", async () => {
  console.log("RUN_MODE_OK");
});
`,
    );

    const runSession = "run-write-access-session";
    const runResult = await librettoCli(
      `run "${integrationFilePath}" --session ${runSession} --headless`,
    );
    expect(runResult.stdout).toContain("RUN_MODE_OK");
    expect(runResult.stdout).toContain("Integration completed.");

    const runMode = await librettoCli(
      `session-mode --session ${runSession}`,
    );
    expect(runMode.stdout).toContain(
      `Session "${runSession}" mode: write-access`,
    );
  }, 90_000);

  test("run supports --read-only for the created session", async ({
    librettoCli,
    writeWorkflow,
  }) => {
    const integrationFilePath = await writeWorkflow(
      "integration-run-readonly.mjs",
      `
export default workflow("main", async () => {
  console.log("RUN_READONLY_OK");
});
`,
    );

    const session = "run-readonly-session";
    const runResult = await librettoCli(
      `run "${integrationFilePath}" --session ${session} --headless --read-only`,
    );
    expect(runResult.stdout).toContain("RUN_READONLY_OK");
    expect(runResult.stdout).toContain("Integration completed.");

    const mode = await librettoCli(`session-mode --session ${session}`);
    expect(mode.stdout).toContain(`Session "${session}" mode: read-only`);
  }, 90_000);

  test("exec without --session shows missing session error", async ({
    librettoCli,
  }) => {
    const result = await librettoCli(`exec "return 1"`);
    expect(result.stderr).toContain("Missing required option --session.");
  });

  test("exec rejects unquoted multi-token code", async ({ librettoCli }) => {
    const result = await librettoCli(
      "exec await page.title() --session test-session",
    );
    expect(result.stderr).toContain("Unexpected arguments for exec.");
  });

  test("close --all works without --session", async ({ librettoCli }) => {
    await librettoCli("open https://example.com --headless");
    await librettoCli(
      "open https://example.com --headless --session close-all-second",
    );

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
    expect(secondOpen.stderr).toContain(`libretto close --session ${session}`);
  }, 60_000);
});
