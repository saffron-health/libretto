import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLibrettoConfig } from "../src/cli/core/ai-config.js";

describe("ai config validation output", () => {
  it("prints a valid config example instead of raw JSON schema", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "libretto-ai-config-"));
    const configPath = join(tempDir, "config.json");

    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          version: 2,
          ai: {
            preset: "codex",
          },
        }),
      );

      let message = "";
      try {
        readLibrettoConfig(configPath);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain(`AI config is invalid at ${configPath}.`);
      expect(message).toContain("Expected config example:");
      expect(message).toContain('"version": 1');
      expect(message).toContain('"model": "openai/gpt-5.4"');
      expect(message).toContain('"updatedAt": "2026-01-01T00:00:00.000Z"');
      expect(message).toContain('"viewport": {');
      expect(message).not.toContain('"$schema"');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
