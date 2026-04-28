import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildInlinePromptSelection } from "../src/cli/core/snapshot-analyzer.js";
import {
  parseDotEnvAssignment,
  resolveSnapshotApiModelOrThrow,
  resolveSnapshotApiModel,
} from "../src/cli/core/ai-model.js";
import { LIBRETTO_CONFIG_PATH } from "../src/cli/core/context.js";
import { resolveOpenAiCredentials } from "../src/cli/core/openai-credentials.js";
import { buildOpenAiProviderSettings } from "../src/cli/core/resolve-model.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

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
  vi.stubEnv("OPENROUTER_API_KEY", "");
}

describe("snapshot API model resolution", () => {
  it("prefers OpenAI automatically when only OPENAI_API_KEY is present", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");

    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "openai/gpt-5.4",
      provider: "openai",
      source: "env:OPENAI_API_KEY",
    });
  });

  it("uses Codex auth.json API key as OpenAI credentials", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    const codexHome = join(
      tmpdir(),
      `libretto-test-codex-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, "auth.json"),
      JSON.stringify({ OPENAI_API_KEY: "sk-codex-api-key" }),
      "utf-8",
    );
    vi.stubEnv("CODEX_HOME", codexHome);

    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "openai/gpt-5.4",
      provider: "openai",
      source: "codex-auth-json-api-key",
    });
  });

  it("uses CODEX_OAUTH_TOKEN as OpenAI credentials", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    vi.stubEnv("CODEX_OAUTH_TOKEN", "test-codex-access-token");
    vi.stubEnv("CODEX_ACCOUNT_ID", "test-account-id");

    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "openai/gpt-5.4",
      provider: "openai",
      source: "env:CODEX_OAUTH_TOKEN",
    });

    expect(resolveOpenAiCredentials()).toEqual({
      kind: "codex-oauth",
      token: "test-codex-access-token",
      accountId: "test-account-id",
      source: "CODEX_OAUTH_TOKEN",
    });
  });

  it("uses Codex auth.json OAuth tokens as OpenAI credentials", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    const codexHome = join(
      tmpdir(),
      `libretto-test-codex-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, "auth.json"),
      JSON.stringify({
        tokens: {
          access_token: "test-codex-access-token",
          account_id: "test-account-id",
        },
      }),
      "utf-8",
    );
    vi.stubEnv("CODEX_HOME", codexHome);

    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "openai/gpt-5.4",
      provider: "openai",
      source: "codex-auth-json-oauth",
    });

    expect(resolveOpenAiCredentials()).toEqual({
      kind: "codex-oauth",
      token: "test-codex-access-token",
      accountId: "test-account-id",
      source: "codex-auth-json-oauth",
    });
  });

  it("ignores CODEX_OAUTH_TOKEN without an account id", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    vi.stubEnv("CODEX_OAUTH_TOKEN", "test-codex-access-token");

    expect(resolveSnapshotApiModel(null)).toBeNull();
  });

  it("ignores Codex auth.json OAuth tokens without an account id", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    const codexHome = join(
      tmpdir(),
      `libretto-test-codex-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, "auth.json"),
      JSON.stringify({ tokens: { access_token: "test-codex-access-token" } }),
      "utf-8",
    );
    vi.stubEnv("CODEX_HOME", codexHome);

    expect(resolveSnapshotApiModel(null)).toBeNull();
  });

  it("builds Codex OAuth OpenAI provider settings for the Codex backend", () => {
    expect(
      buildOpenAiProviderSettings({
        kind: "codex-oauth",
        token: "test-codex-access-token",
        accountId: "test-account-id",
        source: "codex-auth-json-oauth",
      }),
    ).toEqual({
      apiKey: "test-codex-access-token",
      baseURL: "https://chatgpt.com/backend-api/codex",
      headers: {
        "chatgpt-account-id": "test-account-id",
        "OpenAI-Beta": "responses=experimental",
        originator: "libretto",
      },
    });
  });

  it("uses config model when set", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");

    expect(resolveSnapshotApiModel("openai/gpt-5.4")).toMatchObject({
      model: "openai/gpt-5.4",
      provider: "openai",
      source: "config",
    });
  });

  it("uses config model for anthropic", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");

    expect(resolveSnapshotApiModel("anthropic/claude-sonnet-4-6")).toMatchObject({
      model: "anthropic/claude-sonnet-4-6",
      provider: "anthropic",
      source: "config",
    });
  });

  it("auto-detects Gemini when GEMINI_API_KEY is present", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "google/gemini-3-flash-preview",
      provider: "google",
      source: "env:GEMINI_API_KEY",
    });
  });

  it("auto-detects Gemini when GOOGLE_GENERATIVE_AI_API_KEY is present", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-gemini-key");

    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "google/gemini-3-flash-preview",
      provider: "google",
      source: "env:GOOGLE_GENERATIVE_AI_API_KEY",
    });
  });

  it("auto-detects Vertex when only GOOGLE_CLOUD_PROJECT is present", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");

    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "vertex/gemini-2.5-flash",
      provider: "vertex",
      source: "env:GOOGLE_CLOUD_PROJECT",
    });
  });

  it("falls back to auto-detection even when config exists", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    // Config with no model — should still auto-detect from env
    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "openai/gpt-5.4",
      provider: "openai",
      source: "env:OPENAI_API_KEY",
    });
  });

  it("explains how to configure snapshot analysis when no analyzer is available", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();

    expect(() => resolveSnapshotApiModelOrThrow(null)).toThrowError(
      "Failed to analyze snapshot because no snapshot analyzer is configured. Add OPENAI_API_KEY, CODEX_OAUTH_TOKEN with CODEX_ACCOUNT_ID, ANTHROPIC_API_KEY, GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY, GOOGLE_CLOUD_PROJECT, or OPENROUTER_API_KEY to .env or as a shell environment variable, use a Codex login, or choose a default model with `npx libretto ai configure openai | anthropic | gemini | vertex | openrouter`. For more info, run `npx libretto setup`.",
    );
  });

  it("auto-detects OpenRouter when OPENROUTER_API_KEY is present", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "openrouter/free",
      provider: "openrouter",
      source: "env:OPENROUTER_API_KEY",
    });
  });

  it("uses config model for openrouter", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

    expect(resolveSnapshotApiModel("openrouter/google/gemma-4-31b-it:free")).toMatchObject({
      model: "openrouter/google/gemma-4-31b-it:free",
      provider: "openrouter",
      source: "config",
    });
  });

  it("prefers OpenAI over OpenRouter when both keys are present", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-key");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");

    expect(resolveSnapshotApiModel(null)).toMatchObject({
      provider: "openai",
    });
  });

  it("explains how to fix a configured provider with missing credentials", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    clearProviderEnv();

    expect(() =>
      resolveSnapshotApiModelOrThrow("openai/gpt-5.4"),
    ).toThrowError(
      `Failed to analyze snapshot because openai is configured in ${LIBRETTO_CONFIG_PATH}, but OpenAI API key and Codex OAuth credentials are missing. Add OPENAI_API_KEY to .env or as a shell environment variable, set CODEX_OAUTH_TOKEN with CODEX_ACCOUNT_ID, or use a Codex login. For more info, run \`npx libretto setup\`.`,
    );
  });
});

describe("parseDotEnvAssignment", () => {
  it("parses quoted values with trailing inline comments", () => {
    expect(
      parseDotEnvAssignment(`OPENAI_API_KEY="sk-test" # local note`),
    ).toEqual({
      key: "OPENAI_API_KEY",
      value: "sk-test",
    });
  });

  it("parses exported single-quoted values with trailing inline comments", () => {
    expect(
      parseDotEnvAssignment(`export GEMINI_API_KEY='gem-test' # local note`),
    ).toEqual({
      key: "GEMINI_API_KEY",
      value: "gem-test",
    });
  });

  it("strips inline comments from unquoted values", () => {
    expect(
      parseDotEnvAssignment(`GOOGLE_CLOUD_PROJECT=test-project # local note`),
    ).toEqual({
      key: "GOOGLE_CLOUD_PROJECT",
      value: "test-project",
    });
  });

  it("does not decode escapes in unquoted values", () => {
    expect(
      parseDotEnvAssignment(String.raw`OPENAI_API_KEY=sk-test\nliteral`),
    ).toEqual({
      key: "OPENAI_API_KEY",
      value: String.raw`sk-test\nliteral`,
    });
  });
});

describe("buildInlinePromptSelection", () => {
  it("chooses the full DOM when the full prompt fits the estimated budget", () => {
    const selection = buildInlinePromptSelection(
      {
        objective: "Find the submit button",
        session: "session",
        context: "Simple page",
        pngPath: "/tmp/page.png",
        htmlPath: "/tmp/page.html",
        condensedHtmlPath: "/tmp/page.condensed.html",
      },
      '<html><body><button data-testid="submit">Submit</button></body></html>',
      '<html><body><button data-testid="submit">Submit</button></body></html>',
      "openai/gpt-5.4",
    );

    expect(selection.domSource).toBe("full");
    expect(selection.truncated).toBe(false);
  });

  it("chooses the condensed DOM when the full prompt would exceed the budget", () => {
    const fullHtml =
      "<html><body>" +
      `<section data-testid="card">${"x".repeat(1_100_000)}</section>` +
      "</body></html>";
    const condensedHtml =
      '<html><body><button data-testid="submit">Submit</button></body></html>';

    const selection = buildInlinePromptSelection(
      {
        objective: "Find the submit button",
        session: "session",
        context: "Large page",
        pngPath: "/tmp/page.png",
        htmlPath: "/tmp/page.html",
        condensedHtmlPath: "/tmp/page.condensed.html",
      },
      fullHtml,
      condensedHtml,
      "openai/gpt-5.4",
    );

    expect(selection.domSource).toBe("condensed");
    expect(selection.truncated).toBe(false);
  });
});
