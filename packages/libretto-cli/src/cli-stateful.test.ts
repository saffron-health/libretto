import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect } from "vitest";
import { test } from "./test-fixtures";

describe("state-driven CLI subprocess behavior", () => {
  test("shows missing snapshot analyzer config", async ({ librettoCli }) => {
    const result = await librettoCli("snapshot configure --show");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No snapshot analyzer configured.");
  });

  test("configures, shows, and clears snapshot analyzer config", async ({
    librettoCli,
    workspacePath,
  }) => {
    const configure = await librettoCli("snapshot configure codex");
    expect(configure.exitCode).toBe(0);
    expect(configure.stdout).toContain("Snapshot analyzer configured.");

    const configPath = workspacePath(
      ".libretto-cli",
      "snapshot-config.json",
    );
    expect(existsSync(configPath)).toBe(true);
    const rawConfig = JSON.parse(await readFile(configPath, "utf8")) as {
      preset?: string;
    };
    expect(rawConfig.preset).toBe("codex");

    const show = await librettoCli("snapshot configure --show");
    expect(show.exitCode).toBe(0);
    expect(show.stdout).toContain("Snapshot analyzer preset: codex");

    const clear = await librettoCli("snapshot configure --clear");
    expect(clear.exitCode).toBe(0);
    expect(clear.stdout).toContain("Cleared snapshot analyzer config:");
    expect(existsSync(configPath)).toBe(false);
  });

  test("reads and clears network logs from seeded run data", async ({
    seedSessionState,
    seedNetworkLog,
    librettoCli,
    workspacePath,
  }) => {
    await seedSessionState({
      session: "net-session",
      runId: "run-net",
    });
    const logPath = await seedNetworkLog("run-net", [
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
    expect(existsSync(workspacePath("tmp", "libretto-cli", "run-net", "network.jsonl"))).toBe(true);
  });

  test("reads and clears action logs from seeded run data", async ({
    seedSessionState,
    seedActionLog,
    librettoCli,
    workspacePath,
  }) => {
    await seedSessionState({
      session: "actions-session",
      runId: "run-actions",
    });
    const logPath = await seedActionLog("run-actions", [
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
    expect(existsSync(workspacePath("tmp", "libretto-cli", "run-actions", "actions.jsonl"))).toBe(true);
  });
});
