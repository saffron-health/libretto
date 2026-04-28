import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect } from "vitest";
import { test } from "./fixtures.js";

describe("daemon IPC", () => {
  test("open writes daemonSocketPath into session state", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-state";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const raw = await readFile(
      workspacePath(".libretto", "sessions", session, "state.json"),
      "utf8",
    );
    const state = JSON.parse(raw) as { daemonSocketPath?: string };
    expect(state.daemonSocketPath).toBeDefined();
    expect(typeof state.daemonSocketPath).toBe("string");
    expect(state.daemonSocketPath).toMatch(/^\/tmp\/libretto-/);
  }, 45_000);

  test("pages returns page list through daemon IPC", async ({
    librettoCli,
  }) => {
    const session = "daemon-ipc-pages";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const pages = await librettoCli(`pages --session ${session}`);
    expect(pages.stdout).toContain("example.com");
  }, 45_000);

  test("exec returns values through daemon IPC", async ({ librettoCli }) => {
    const session = "daemon-ipc-exec";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const result = await librettoCli(
      `exec "return await page.title()" --session ${session}`,
    );
    expect(result.stdout).toContain("Example Domain");
  }, 45_000);

  test("exec persists state across calls", async ({ librettoCli }) => {
    const session = "daemon-ipc-exec-state";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    await librettoCli(`exec "state.x = 42" --session ${session}`);

    const result = await librettoCli(
      `exec "return state.x" --session ${session}`,
    );
    expect(result.stdout).toContain("42");
  }, 45_000);

  test("readonly-exec works through daemon IPC", async ({ librettoCli }) => {
    const session = "daemon-ipc-readonly";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const result = await librettoCli(
      `readonly-exec "return page.url()" --session ${session}`,
    );
    expect(result.stdout).toContain("example.com");
  }, 45_000);

  test("close removes daemon socket file", async ({
    librettoCli,
    workspacePath,
  }) => {
    const session = "daemon-ipc-close";
    await librettoCli(
      `open https://example.com --headless --session ${session}`,
    );

    const raw = await readFile(
      workspacePath(".libretto", "sessions", session, "state.json"),
      "utf8",
    );
    const state = JSON.parse(raw) as { daemonSocketPath?: string };
    expect(state.daemonSocketPath).toBeDefined();
    const socketPath = state.daemonSocketPath!;

    await librettoCli(`close --session ${session}`);

    expect(existsSync(socketPath)).toBe(false);
  }, 60_000);
});
