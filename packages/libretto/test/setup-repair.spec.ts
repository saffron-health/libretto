import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveAiSetupStatus } from "../src/cli/core/ai-model.js";
import {
  buildRepairPlan,
  formatMissingCredentialsMessage,
} from "../src/cli/commands/setup.js";
import type { AiSetupStatus } from "../src/cli/core/ai-model.js";

function clearProviderEnv(): void {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("CODEX_OAUTH_TOKEN", "");
  vi.stubEnv("CODEX_ACCOUNT_ID", "");
  vi.stubEnv("CHATGPT_ACCOUNT_ID", "");
  vi.stubEnv("CODEX_HOME", join(tmpdir(), "libretto-test-missing-codex-home"));
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

describe("buildRepairPlan", () => {
  it("returns repair-missing-credentials for pinned OpenAI with missing key", () => {
    const status: AiSetupStatus = {
      kind: "configured-missing-credentials",
      model: "openai/gpt-5.4",
      provider: "openai",
    };
    const plan = buildRepairPlan(status);
    expect(plan).toEqual({
      kind: "repair-missing-credentials",
      provider: "openai",
      model: "openai/gpt-5.4",
      envVar: "OPENAI_API_KEY",
      choices: ["switch-provider", "skip"],
    });
  });

  it("returns repair-missing-credentials for pinned Anthropic with missing key", () => {
    const status: AiSetupStatus = {
      kind: "configured-missing-credentials",
      model: "anthropic/claude-sonnet-4-6",
      provider: "anthropic",
    };
    const plan = buildRepairPlan(status);
    expect(plan).toEqual({
      kind: "repair-missing-credentials",
      provider: "anthropic",
      model: "anthropic/claude-sonnet-4-6",
      envVar: "ANTHROPIC_API_KEY",
      choices: ["switch-provider", "skip"],
    });
  });

  it("returns repair-invalid-config for invalid config", () => {
    const status: AiSetupStatus = {
      kind: "invalid-config",
      message: "Bad JSON",
    };
    const plan = buildRepairPlan(status);
    expect(plan).toEqual({
      kind: "repair-invalid-config",
      message: "Bad JSON",
    });
  });

  it("returns no-repair-needed for ready status", () => {
    const status: AiSetupStatus = {
      kind: "ready",
      model: "openai/gpt-5.4",
      provider: "openai",
      source: "config",
    };
    expect(buildRepairPlan(status)).toEqual({ kind: "no-repair-needed" });
  });

  it("returns no-repair-needed for unconfigured status", () => {
    const status: AiSetupStatus = { kind: "unconfigured" };
    expect(buildRepairPlan(status)).toEqual({ kind: "no-repair-needed" });
  });
});

describe("buildRepairPlan integrated with resolveAiSetupStatus", () => {
  it("pinned OpenAI + missing OpenAI key + Anthropic key present → repair plan names OpenAI", () => {
    writeConfig({
      version: 1,
      snapshotModel: "openai/gpt-5.4",
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");

    const status = resolveAiSetupStatus(configPath);
    expect(status.kind).toBe("configured-missing-credentials");

    const plan = buildRepairPlan(status);
    expect(plan.kind).toBe("repair-missing-credentials");
    if (plan.kind === "repair-missing-credentials") {
      expect(plan.provider).toBe("openai");
      expect(plan.envVar).toBe("OPENAI_API_KEY");
      expect(plan.model).toBe("openai/gpt-5.4");
      expect(plan.choices).toContain("switch-provider");
    }
  });

  it("invalid config + any env credentials → repair-invalid-config (not ready)", () => {
    writeConfig({ version: 999 });
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    const status = resolveAiSetupStatus(configPath);
    expect(status.kind).toBe("invalid-config");

    const plan = buildRepairPlan(status);
    expect(plan.kind).toBe("repair-invalid-config");
  });
});

describe("formatMissingCredentialsMessage", () => {
  it("names the configured provider and the missing env var", () => {
    const plan = buildRepairPlan({
      kind: "configured-missing-credentials",
      model: "openai/gpt-5.4",
      provider: "openai",
    });
    if (plan.kind !== "repair-missing-credentials") {
      throw new Error("Expected repair-missing-credentials");
    }
    const msg = formatMissingCredentialsMessage(plan);
    expect(msg).toContain("openai");
    expect(msg).toContain("OpenAI API key");
    expect(msg).toContain("Codex OAuth");
    expect(msg).toContain("openai/gpt-5.4");
    expect(msg).not.toContain("No snapshot API credentials detected");
  });

  it("names anthropic provider specifically", () => {
    const plan = buildRepairPlan({
      kind: "configured-missing-credentials",
      model: "anthropic/claude-sonnet-4-6",
      provider: "anthropic",
    });
    if (plan.kind !== "repair-missing-credentials") {
      throw new Error("Expected repair-missing-credentials");
    }
    const msg = formatMissingCredentialsMessage(plan);
    expect(msg).toContain("anthropic");
    expect(msg).toContain("ANTHROPIC_API_KEY");
  });
});
