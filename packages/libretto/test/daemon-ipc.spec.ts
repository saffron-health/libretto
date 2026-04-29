import { writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { describe, expect } from "vitest";
import { test } from "./fixtures.js";

/**
 * Helper: write a minimal HTML fixture and return its file:// URL.
 * Using local files eliminates network-dependent flakiness from tests
 * that would otherwise hit https://example.com.
 */
async function writeFixturePage(
  workspacePath: (...segments: string[]) => string,
  name: string,
  title = "Test Page",
  body = "<h1>Hello</h1>",
): Promise<string> {
  const dir = workspacePath("fixtures");
  await mkdir(dir, { recursive: true });
  const htmlPath = workspacePath("fixtures", `${name}.html`);
  await writeFile(
    htmlPath,
    `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`,
    "utf8",
  );
  return pathToFileURL(htmlPath).href;
}

describe("daemon IPC", () => {
  test("pages returns page list through daemon IPC", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-pages";
    const url = await writeFixturePage(workspacePath, "pages", "Pages Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const pages = await librettoCli(`pages --session ${session}`);
    expect(pages.stdout).toContain("pages.html");
  }, 45_000);

  test("exec returns values through daemon IPC", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec";
    const url = await writeFixturePage(workspacePath, "exec", "Exec Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `exec "return await page.title()" --session ${session}`,
    );
    expect(result.stdout).toContain("Exec Test");
  }, 45_000);

  test("exec persists state across calls", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-exec-state";
    const url = await writeFixturePage(workspacePath, "state", "State Test");
    await librettoCli(`open "${url}" --headless --session ${session}`);

    await librettoCli(`exec "state.x = 42" --session ${session}`);

    const result = await librettoCli(
      `exec "return state.x" --session ${session}`,
    );
    expect(result.stdout).toContain("42");
  }, 45_000);

  test("readonly-exec works through daemon IPC", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-readonly";
    const url = await writeFixturePage(
      workspacePath,
      "readonly",
      "Readonly Test",
    );
    await librettoCli(`open "${url}" --headless --session ${session}`);

    const result = await librettoCli(
      `readonly-exec "return page.url()" --session ${session}`,
    );
    expect(result.stdout).toContain("readonly.html");
  }, 45_000);

  test("snapshot through daemon IPC fails at analysis, not at daemon layer", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-snapshot";
    const url = await writeFixturePage(
      workspacePath,
      "snapshot",
      "Snapshot Test",
    );
    await librettoCli(`open "${url}" --headless --session ${session}`);

    // Without valid AI credentials the command fails at model
    // validation or analysis — not at the daemon/IPC layer. Verify
    // the error is NOT a daemon connection failure.
    const result = await librettoCli(
      `snapshot --session ${session} --objective "test" --context "test"`,
    );
    expect(result.stderr).not.toContain("daemon socket");
    expect(result.stderr).not.toContain("daemon may have crashed");
  }, 45_000);
});
