import { tmpdir } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { describe, expect } from "vitest";
import { test } from "./test-fixtures";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("cli test fixtures", () => {
  test("creates workspace under OS temp directory", async ({ workspaceDir }) => {
    expect(workspaceDir.startsWith(tmpdir())).toBe(true);
  });

  test.concurrent(
    "isolates workspace files for concurrent test A",
    async ({ workspacePath }) => {
      const file = workspacePath("collision-check.txt");
      await writeFile(file, "test-A", "utf8");
      await wait(60);
      const value = await readFile(file, "utf8");
      expect(value).toBe("test-A");
    },
  );

  test.concurrent(
    "isolates workspace files for concurrent test B",
    async ({ workspacePath }) => {
      const file = workspacePath("collision-check.txt");
      await writeFile(file, "test-B", "utf8");
      await wait(60);
      const value = await readFile(file, "utf8");
      expect(value).toBe("test-B");
    },
  );

  test("seeds state and run logs in workspace-scoped paths", async ({
    workspacePath,
    seedSessionState,
    seedNetworkLog,
    seedActionLog,
    seedSnapshotConfig,
  }) => {
    const seeded = await seedSessionState({
      session: "spec-session",
      runId: "run-2",
    });
    await seedNetworkLog("spec-session", [
      { ts: "2026-01-01T00:00:00.000Z", method: "GET", url: "https://example.com", status: 200, contentType: "text/html", size: 1, durationMs: 1 },
    ]);
    await seedActionLog("spec-session", [
      { ts: "2026-01-01T00:00:00.000Z", action: "click", source: "agent", success: true },
    ]);
    const configPath = await seedSnapshotConfig();

    expect(seeded.session).toBe("spec-session");
    expect(
      existsSync(workspacePath(".libretto", "sessions", "spec-session", "state.json")),
    ).toBe(true);
    expect(
      existsSync(workspacePath(".libretto", "sessions", "spec-session", "network.jsonl")),
    ).toBe(true);
    expect(
      existsSync(workspacePath(".libretto", "sessions", "spec-session", "actions.jsonl")),
    ).toBe(true);
    expect(existsSync(configPath)).toBe(true);
  });

  test(
    "runs CLI with workspace cwd",
    async ({ librettoCli, workspacePath }) => {
      const result = await librettoCli("--help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Usage: libretto-cli");
      expect(existsSync(workspacePath(".libretto"))).toBe(true);
      expect(existsSync(workspacePath(".libretto", ".gitignore"))).toBe(true);
      expect(existsSync(workspacePath("tmp", "libretto-cli"))).toBe(false);
    },
    20_000,
  );
});
