import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { describe, expect, onTestFinished } from "vitest";
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

function parseJsonStdout<T>(stdout: string): T {
  return JSON.parse(stdout.trim()) as T;
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
    expect(show.stdout).toContain("Model: vertex/gemini-2.5-flash");
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

  test("status shows unconfigured AI when no credentials or config exist", async ({
    librettoCli,
  }) => {
    const status = await librettoCli("status", {
      LIBRETTO_DISABLE_DOTENV: "1",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      GOOGLE_CLOUD_PROJECT: "",
      GCLOUD_PROJECT: "",
    });
    expect(status.stdout).toContain("AI configuration:");
    expect(status.stdout).toContain("No AI model configured");
    expect(status.stdout).toContain("npx libretto setup");
  });

  test("status shows configured model after setup pins it", async ({
    librettoCli,
  }) => {
    // Run setup to pin the model
    await librettoCli("setup --skip-browsers", {
      LIBRETTO_DISABLE_DOTENV: "1",
      OPENAI_API_KEY: "test-openai-key",
    });

    // Status should reflect the pinned model
    const status = await librettoCli("status", {
      LIBRETTO_DISABLE_DOTENV: "1",
      OPENAI_API_KEY: "test-openai-key",
    });
    expect(status.stdout).toContain("AI configuration:");
    expect(status.stdout).toContain("openai/gpt-5.4");
    expect(status.stdout).toContain(
      "To change: npx libretto ai configure openai | anthropic | gemini | vertex",
    );
  });


  test("open and connect sessions default to write-access and support --read-only", async ({
    librettoCli,
    workspacePath,
  }) => {
    const sourceSession = "connect-source-session-mode";
    const connectedSession = "connect-target-session-mode";
    const readonlyOpenSession = "open-readonly-session-mode";
    const readonlyConnectedSession = "connect-readonly-session-mode";
    await librettoCli(
      `open https://example.com --headless --session ${sourceSession}`,
    );

    const sourceMode = await librettoCli(
      `session-mode --session ${sourceSession}`,
    );
    expect(sourceMode.stdout).toContain(
      `Session "${sourceSession}" mode: write-access`,
    );

    await librettoCli(
      `open https://example.com --headless --read-only --session ${readonlyOpenSession}`,
    );
    const readonlyOpenMode = await librettoCli(
      `session-mode --session ${readonlyOpenSession}`,
    );
    expect(readonlyOpenMode.stdout).toContain(
      `Session "${readonlyOpenSession}" mode: read-only`,
    );

    const sourceState = JSON.parse(
      await readFile(
        workspacePath(".libretto", "sessions", sourceSession, "state.json"),
        "utf8",
      ),
    ) as { port: number };

    const connected = await librettoCli(
      `connect http://127.0.0.1:${sourceState.port} --session ${connectedSession}`,
    );
    expect(connected.stdout).toContain(`(session: ${connectedSession})`);

    const connectedMode = await librettoCli(
      `session-mode --session ${connectedSession}`,
    );
    expect(connectedMode.stdout).toContain(
      `Session "${connectedSession}" mode: write-access`,
    );

    await librettoCli(
      `connect http://127.0.0.1:${sourceState.port} --read-only --session ${readonlyConnectedSession}`,
    );
    const readonlyConnectedMode = await librettoCli(
      `session-mode --session ${readonlyConnectedSession}`,
    );
    expect(readonlyConnectedMode.stdout).toContain(
      `Session "${readonlyConnectedSession}" mode: read-only`,
    );
  }, 60_000);

  test("read-only sessions block exec but still allow readonly-exec", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "exec-readonly-guard";
    const htmlPath = workspacePath("fixtures", "exec-readonly-guard.html");
    await mkdir(workspacePath("fixtures"), { recursive: true });
    await writeFile(
      htmlPath,
      "<!doctype html><html><head><title>Exec Guard</title></head><body><h1>Guarded</h1></body></html>",
      "utf8",
    );

    const fileUrl = pathToFileURL(htmlPath).href;
    await librettoCli(
      `open "${fileUrl}" --headless --read-only --session ${session}`,
    );

    const blockedExec = await librettoCli(
      `exec "return page.url()" --session ${session}`,
    );
    expect(blockedExec.stderr).toContain(
      `Command "exec" is blocked for session "${session}" because it is in read-only mode.`,
    );
    expect(blockedExec.stderr).toContain(
      `libretto session-mode write-access --session ${session}`,
    );

    const readonlyExec = await librettoCli(
      `readonly-exec "return page.url()" --session ${session}`,
    );
    expect(readonlyExec.stderr).toBe("");
    expect(readonlyExec.stdout.trim()).toBe(fileUrl);
  }, 60_000);

  test("read-only guard also applies to remote CDP-backed sessions", async ({
    librettoCli,
    seedSessionState,
    workspacePath,
  }) => {
    const sourceSession = "remote-cdp-source";
    await librettoCli(
      `open https://example.com --headless --session ${sourceSession}`,
    );

    const sourceState = JSON.parse(
      await readFile(
        workspacePath(".libretto", "sessions", sourceSession, "state.json"),
        "utf8",
      ),
    ) as { port: number };

    const remoteSession = "remote-cdp-readonly";
    await seedSessionState({
      session: remoteSession,
      port: sourceState.port,
      cdpEndpoint: `http://127.0.0.1:${sourceState.port}`,
      mode: "read-only",
      pid: 12345,
      status: "active",
    });

    const blockedExec = await librettoCli(
      `exec "return page.url()" --session ${remoteSession}`,
    );
    expect(blockedExec.stderr).toContain(
      `Command "exec" is blocked for session "${remoteSession}" because it is in read-only mode.`,
    );

    const readonlyExec = await librettoCli(
      `readonly-exec "return page.url()" --session ${remoteSession}`,
    );
    expect(readonlyExec.stderr).toBe("");
    expect(readonlyExec.stdout.trim()).toContain("example.com");
  }, 60_000);

  test("readonly-exec allows read-only page and locator inspection", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "readonly-exec-reads";
    const htmlPath = workspacePath("fixtures", "readonly-exec.html");
    await mkdir(workspacePath("fixtures"), { recursive: true });
    await writeFile(
      htmlPath,
      [
        "<!doctype html>",
        "<html>",
        "<head><title>Readonly Fixture</title></head>",
        "<body>",
        '<h1 id="heading">Readonly Heading</h1>',
        "<ul>",
        "<li>Alpha</li>",
        "<li>Beta</li>",
        "</ul>",
        '<div id="visible">Visible</div>',
        '<div id="hidden" style="display:none">Hidden</div>',
        '<input id="name" value="unchanged" />',
        "</body>",
        "</html>",
      ].join(""),
      "utf8",
    );

    const fileUrl = pathToFileURL(htmlPath).href;
    await librettoCli(`open "${fileUrl}" --headless --session ${session}`);

    const result = await librettoCli(
      `readonly-exec - --session ${session}`,
      undefined,
      [
        "await page.waitForLoadState('domcontentloaded');",
        "const pageErrorCount = (await page.pageErrors()).length;",
        "const allItems = await Promise.all((await page.getByRole('listitem').all()).map((item) => item.textContent()));",
        "return {",
        "  url: page.url(),",
        "  title: await page.title(),",
        "  pageErrorCount,",
        "  loaded: true,",
        "  heading: await page.locator('#heading').textContent(),",
        "  headingId: await page.locator('#heading').getAttribute('id'),",
        "  count: await page.locator('li').count(),",
        "  secondItem: await page.getByRole('listitem').nth(1).textContent(),",
        "  allItems,",
        "  visible: await page.locator('#visible').isVisible(),",
        "  hidden: await page.locator('#hidden').isHidden(),",
        "  nameValue: await page.locator('#name').inputValue(),",
        "  nameEditable: await page.locator('#name').isEditable(),",
        "};",
      ].join("\n"),
    );

    expect(result.stderr).toBe("");
    expect(parseJsonStdout<Record<string, unknown>>(result.stdout)).toEqual({
      url: fileUrl,
      title: "Readonly Fixture",
      pageErrorCount: 0,
      loaded: true,
      heading: "Readonly Heading",
      headingId: "heading",
      count: 2,
      secondItem: "Beta",
      allItems: ["Alpha", "Beta"],
      visible: true,
      hidden: true,
      nameValue: "unchanged",
      nameEditable: true,
    });
  }, 60_000);

  test("readonly-exec allows safe scrolling helpers", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "readonly-exec-scroll";
    const htmlPath = workspacePath("fixtures", "readonly-scroll.html");
    await mkdir(workspacePath("fixtures"), { recursive: true });
    await writeFile(
      htmlPath,
      [
        "<!doctype html>",
        "<html>",
        "<head><title>Readonly Scroll</title></head>",
        '<body style="margin:0">',
        '<div style="height:1800px;background:linear-gradient(#fff,#ddd)">Spacer</div>',
        '<div id="target" style="height:120px">Target</div>',
        "</body>",
        "</html>",
      ].join(""),
      "utf8",
    );

    const fileUrl = pathToFileURL(htmlPath).href;
    await librettoCli(`open "${fileUrl}" --headless --session ${session}`);

    const result = await librettoCli(
      `readonly-exec - --session ${session}`,
      undefined,
      [
        "const target = page.locator('#target');",
        "const beforeBox = await target.boundingBox();",
        "await scrollBy(0, 2200);",
        "const afterScrollByBox = await target.boundingBox();",
        "await target.scrollIntoViewIfNeeded();",
        "const afterLocatorScrollBox = await target.boundingBox();",
        "return {",
        "  movedByScrollBy: Boolean(beforeBox && afterScrollByBox && afterScrollByBox.y < beforeBox.y),",
        "  afterLocatorScrollInViewport: Boolean(afterLocatorScrollBox && afterLocatorScrollBox.y >= 0 && afterLocatorScrollBox.y < 720),",
        "};",
      ].join("\n"),
    );

    expect(result.stderr).toBe("");
    expect(parseJsonStdout<Record<string, unknown>>(result.stdout)).toEqual({
      movedByScrollBy: true,
      afterLocatorScrollInViewport: true,
    });
  }, 60_000);

  test("readonly-exec snapshot returns diagnostic payload", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "readonly-exec-snapshot";
    const htmlPath = workspacePath("fixtures", "readonly-snapshot.html");
    await mkdir(workspacePath("fixtures"), { recursive: true });
    await writeFile(
      htmlPath,
      "<!doctype html><html><head><title>Snapshot Fixture</title></head><body><main><h1>Snapshot Heading</h1></main></body></html>",
      "utf8",
    );

    const fileUrl = pathToFileURL(htmlPath).href;
    await librettoCli(`open "${fileUrl}" --headless --session ${session}`);

    const result = await librettoCli(
      `readonly-exec - --session ${session}`,
      undefined,
      [
        "const snap = await snapshot();",
        "return {",
        "  url: snap.currentUrl,",
        "  title: snap.pageTitle,",
        "  htmlContainsHeading: snap.pageHtml.includes('Snapshot Heading'),",
        "  hasScreenshot: snap.screenshot.bytesBase64.length > 0,",
        "};",
      ].join("\n"),
    );

    expect(result.stderr).toBe("");
    expect(parseJsonStdout<Record<string, unknown>>(result.stdout)).toEqual({
      url: fileUrl,
      title: "Snapshot Fixture",
      htmlContainsHeading: true,
      hasScreenshot: true,
    });
  }, 60_000);

  test("readonly-exec denies mutating Playwright APIs", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "readonly-exec-denials";
    const htmlPath = workspacePath("fixtures", "readonly-denials.html");
    await mkdir(workspacePath("fixtures"), { recursive: true });
    await writeFile(
      htmlPath,
      "<!doctype html><html><head><title>Readonly Denials</title></head><body><button id=\"submit\">Submit</button><input id=\"name\" value=\"unchanged\" /></body></html>",
      "utf8",
    );

    const fileUrl = pathToFileURL(htmlPath).href;
    await librettoCli(`open "${fileUrl}" --headless --session ${session}`);

    const blockedGoto = await librettoCli(
      `readonly-exec "await page.goto('https://example.com')" --session ${session}`,
    );
    expect(blockedGoto.stderr).toContain(
      "ReadonlyExecDenied: page.goto is blocked in readonly-exec",
    );

    const blockedFill = await librettoCli(
      `readonly-exec "await page.locator('#name').fill('Alice')" --session ${session}`,
    );
    expect(blockedFill.stderr).toContain(
      "ReadonlyExecDenied: locator.fill is blocked in readonly-exec",
    );

    const blockedEvaluate = await librettoCli(
      `readonly-exec "return await page.evaluate(() => document.title)" --session ${session}`,
    );
    expect(blockedEvaluate.stderr).toContain(
      "ReadonlyExecDenied: page.evaluate is blocked in readonly-exec",
    );

    const blockedKeyboard = await librettoCli(
      `readonly-exec "await page.keyboard.press('Tab')" --session ${session}`,
    );
    expect(blockedKeyboard.stderr).toContain(
      "ReadonlyExecDenied: page.keyboard is blocked in readonly-exec",
    );

    const blockedMouse = await librettoCli(
      `readonly-exec "await page.mouse.click(1, 1)" --session ${session}`,
    );
    expect(blockedMouse.stderr).toContain(
      "ReadonlyExecDenied: page.mouse is blocked in readonly-exec",
    );

    const blockedClock = await librettoCli(
      `readonly-exec "return typeof page.clock" --session ${session}`,
    );
    expect(blockedClock.stderr).toContain(
      "ReadonlyExecDenied: page.clock is blocked in readonly-exec",
    );

    const currentUrlResult = await librettoCli(
      `readonly-exec "return page.url()" --session ${session}`,
    );
    expect(currentUrlResult.stderr).toBe("");
    expect(currentUrlResult.stdout.trim()).toBe(fileUrl);
  }, 60_000);

  test("readonly-exec only allows GET network requests", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "readonly-exec-network";
    const methods: string[] = [];
    const server = createServer((req, res) => {
      methods.push(req.method ?? "UNKNOWN");
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("pong");
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );

    onTestFinished(async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }),
      );
    });

    const port = (server.address() as AddressInfo).port;
    const htmlPath = workspacePath("fixtures", "readonly-network.html");
    await mkdir(workspacePath("fixtures"), { recursive: true });
    await writeFile(
      htmlPath,
      "<!doctype html><html><head><title>Readonly Network</title></head><body><p>network</p></body></html>",
      "utf8",
    );

    const fileUrl = pathToFileURL(htmlPath).href;
    await librettoCli(`open "${fileUrl}" --headless --session ${session}`);

    const getResult = await librettoCli(
      `readonly-exec - --session ${session}`,
      undefined,
      [
        `const response = await get('http://127.0.0.1:${port}/ping');`,
        "return { status: response.status, body: await response.text() };",
      ].join("\n"),
    );
    expect(getResult.stderr).toBe("");
    expect(parseJsonStdout<Record<string, unknown>>(getResult.stdout)).toEqual(
      {
        status: 200,
        body: "pong",
      },
    );

    const blockedPost = await librettoCli(
      `readonly-exec - --session ${session}`,
      undefined,
      `await get('http://127.0.0.1:${port}/ping', { method: 'POST' });`,
    );
    expect(blockedPost.stderr).toContain(
      "ReadonlyExecDenied: POST requests are blocked in readonly-exec",
    );
    expect(methods).toEqual(["GET"]);
  }, 60_000);
});
