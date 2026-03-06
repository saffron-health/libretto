import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect } from "vitest";
import { test } from "../test-fixtures";

import { readLibrettoConfig } from "./ai-config";

describe("ai config helpers", () => {
  test("reads a valid config.json file", async ({ workspacePath }) => {
    await mkdir(workspacePath(".libretto"), { recursive: true });
    const configPath = workspacePath(".libretto", "config.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          version: 1,
          ai: {
            preset: "codex",
            commandPrefix: ["codex", "exec"],
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const parsed = readLibrettoConfig(configPath);
    expect(parsed.version).toBe(1);
    expect(parsed.ai?.preset).toBe("codex");
    expect(parsed.ai?.commandPrefix).toEqual(["codex", "exec"]);
  });

  test("throws a path-specific error when config shape is invalid", async ({
    workspacePath,
  }) => {
    await mkdir(workspacePath(".libretto"), { recursive: true });
    const configPath = workspacePath(".libretto", "config.json");
    await writeFile(
      configPath,
      JSON.stringify(
        {
          version: 1,
          ai: {
            preset: "codex",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    expect(() => readLibrettoConfig(configPath)).toThrowError(
      `AI config is invalid at ${configPath}.`,
    );
  });
});
