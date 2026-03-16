import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiConfig } from "../src/cli/core/ai-config.js";
import {
  buildInlinePromptSelection,
} from "../src/cli/core/snapshot-analyzer.js";
import {
  parseDotEnvAssignment,
  resolveSnapshotApiModel,
} from "../src/cli/core/snapshot-api-config.js";

function makeConfig(model: string): AiConfig {
  return {
    model,
    updatedAt: new Date(0).toISOString(),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("snapshot API model resolution", () => {
  it("prefers OpenAI automatically when only OPENAI_API_KEY is present", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");

    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "openai/gpt-5.4",
      provider: "openai",
      source: "env:auto-openai",
    });
  });

  it("uses config model when set", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");

    const config = makeConfig("openai/gpt-5.4");

    expect(resolveSnapshotApiModel(config)).toMatchObject({
      model: "openai/gpt-5.4",
      provider: "openai",
      source: "config",
    });
  });

  it("uses config model for anthropic", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");

    const config = makeConfig("anthropic/claude-sonnet-4-6");

    expect(resolveSnapshotApiModel(config)).toMatchObject({
      model: "anthropic/claude-sonnet-4-6",
      provider: "anthropic",
      source: "config",
    });
  });

  it("auto-detects Gemini when GEMINI_API_KEY is present", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "google/gemini-2.5-flash",
      provider: "google",
      source: "env:auto-google",
    });
  });

  it("auto-detects Gemini when GOOGLE_GENERATIVE_AI_API_KEY is present", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-gemini-key");

    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "google/gemini-2.5-flash",
      provider: "google",
      source: "env:auto-google",
    });
  });

  it("auto-detects Vertex when only GOOGLE_CLOUD_PROJECT is present", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");

    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "vertex/gemini-2.5-pro",
      provider: "vertex",
      source: "env:auto-vertex",
    });
  });

  it("falls back to auto-detection even when config exists", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    // Config with no model — should still auto-detect from env
    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "openai/gpt-5.4",
      provider: "openai",
      source: "env:auto-openai",
    });
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
      "<html><body><button data-testid=\"submit\">Submit</button></body></html>",
      "<html><body><button data-testid=\"submit\">Submit</button></body></html>",
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
      "<html><body><button data-testid=\"submit\">Submit</button></body></html>";

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
