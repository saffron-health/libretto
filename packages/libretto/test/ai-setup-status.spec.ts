import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveAiSetupStatus } from "../src/cli/core/ai-setup-status.js";

function clearProviderEnv(): void {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
  vi.stubEnv("GCLOUD_PROJECT", "");
}

let testDir: string;
let configPath: string;

beforeEach(() => {
  vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
  clearProviderEnv();
  testDir = join(
    tmpdir(),
    `libretto-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
  configPath = join(testDir, "config.json");
});

afterEach(() => {
  vi.unstubAllEnvs();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

function writeConfig(obj: unknown): void {
  writeFileSync(configPath, JSON.stringify(obj, null, 2), "utf-8");
}

describe("resolveAiSetupStatus", () => {
  describe("env-only ready", () => {
    it("resolves ready from OpenAI env when no config exists", () => {
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      expect(resolveAiSetupStatus(configPath)).toEqual({
        kind: "ready",
        model: "openai/gpt-5.4",
        provider: "openai",
        source: "env:auto-openai",
      });
    });

    it("resolves ready from Anthropic env when no config exists", () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      expect(resolveAiSetupStatus(configPath)).toEqual({
        kind: "ready",
        model: "anthropic/claude-sonnet-4-6",
        provider: "anthropic",
        source: "env:auto-anthropic",
      });
    });

    it("resolves ready from Gemini env when no config exists", () => {
      vi.stubEnv("GEMINI_API_KEY", "test-key");
      expect(resolveAiSetupStatus(configPath)).toEqual({
        kind: "ready",
        model: "google/gemini-3-flash-preview",
        provider: "google",
        source: "env:auto-google",
      });
    });

    it("resolves ready from env when config exists without ai block", () => {
      writeConfig({ version: 1 });
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      expect(resolveAiSetupStatus(configPath)).toEqual({
        kind: "ready",
        model: "openai/gpt-5.4",
        provider: "openai",
        source: "env:auto-openai",
      });
    });
  });

  describe("config ready", () => {
    it("resolves ready from config when config and credentials match", () => {
      writeConfig({
        version: 1,
        ai: { model: "openai/gpt-5.4", updatedAt: "2026-01-01T00:00:00.000Z" },
      });
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      expect(resolveAiSetupStatus(configPath)).toEqual({
        kind: "ready",
        model: "openai/gpt-5.4",
        provider: "openai",
        source: "config",
      });
    });

    it("resolves ready from config for anthropic model", () => {
      writeConfig({
        version: 1,
        ai: {
          model: "anthropic/claude-sonnet-4-6",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      });
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      expect(resolveAiSetupStatus(configPath)).toEqual({
        kind: "ready",
        model: "anthropic/claude-sonnet-4-6",
        provider: "anthropic",
        source: "config",
      });
    });
  });

  describe("configured provider missing credentials", () => {
    it("reports configured-missing-credentials when OpenAI is pinned but key is missing", () => {
      writeConfig({
        version: 1,
        ai: { model: "openai/gpt-5.4", updatedAt: "2026-01-01T00:00:00.000Z" },
      });
      expect(resolveAiSetupStatus(configPath)).toEqual({
        kind: "configured-missing-credentials",
        model: "openai/gpt-5.4",
        provider: "openai",
      });
    });

    it("a pinned OpenAI model with only Anthropic credentials must NOT be reported as ready", () => {
      writeConfig({
        version: 1,
        ai: { model: "openai/gpt-5.4", updatedAt: "2026-01-01T00:00:00.000Z" },
      });
      vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
      const status = resolveAiSetupStatus(configPath);
      expect(status.kind).not.toBe("ready");
      expect(status).toEqual({
        kind: "configured-missing-credentials",
        model: "openai/gpt-5.4",
        provider: "openai",
      });
    });

    it("reports configured-missing-credentials for Anthropic model without Anthropic key", () => {
      writeConfig({
        version: 1,
        ai: {
          model: "anthropic/claude-sonnet-4-6",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      });
      vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
      expect(resolveAiSetupStatus(configPath)).toEqual({
        kind: "configured-missing-credentials",
        model: "anthropic/claude-sonnet-4-6",
        provider: "anthropic",
      });
    });
  });

  describe("invalid config", () => {
    it("reports invalid-config for bad JSON", () => {
      writeFileSync(configPath, "not json{", "utf-8");
      const status = resolveAiSetupStatus(configPath);
      expect(status.kind).toBe("invalid-config");
    });

    it("reports invalid-config for wrong schema version", () => {
      writeConfig({ version: 999 });
      expect(resolveAiSetupStatus(configPath).kind).toBe("invalid-config");
    });

    it("does NOT collapse invalid config into env-only ready", () => {
      writeConfig({ version: 999 });
      vi.stubEnv("OPENAI_API_KEY", "test-key");
      expect(resolveAiSetupStatus(configPath).kind).toBe("invalid-config");
    });
  });

  describe("fully unconfigured", () => {
    it("reports unconfigured when no config and no env credentials", () => {
      expect(resolveAiSetupStatus(configPath)).toEqual({
        kind: "unconfigured",
      });
    });

    it("reports unconfigured when config exists without ai block and no env credentials", () => {
      writeConfig({ version: 1 });
      expect(resolveAiSetupStatus(configPath)).toEqual({
        kind: "unconfigured",
      });
    });
  });
});
