import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiConfig } from "../src/cli/core/ai-config.js";
import {
  buildInlinePromptSelection,
} from "../src/cli/core/snapshot-analyzer.js";
import {
  parseDotEnvAssignment,
  resolveSnapshotApiModel,
  shouldUseApiSnapshotAnalyzer,
} from "../src/cli/core/snapshot-api-config.js";

function makeConfig(
  preset: AiConfig["preset"],
  commandPrefix: string[],
  model?: string,
): AiConfig {
  return {
    preset,
    commandPrefix,
    ...(model ? { model } : {}),
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
      model: "openai/gpt-5-mini",
      provider: "openai",
      source: "env:auto-openai",
    });
  });

  it("maps the built-in codex preset to the OpenAI API model", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");

    const config = makeConfig("codex", [
      "codex",
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
    ]);

    expect(resolveSnapshotApiModel(config)).toMatchObject({
      model: "openai/gpt-5-mini",
      provider: "openai",
      source: "ai-config",
    });
    expect(shouldUseApiSnapshotAnalyzer(config)).toBe(true);
  });

  it("accepts codex model aliases in LIBRETTO_SNAPSHOT_MODEL", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("LIBRETTO_SNAPSHOT_MODEL", "codex/gpt-5-mini");

    expect(resolveSnapshotApiModel(null)).toMatchObject({
      model: "codex/gpt-5-mini",
      provider: "openai",
      source: "env:LIBRETTO_SNAPSHOT_MODEL",
    });
  });

  it("maps the built-in gemini preset to Gemini API when GEMINI_API_KEY is present", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");

    const config = makeConfig("gemini", [
      "gemini",
      "--sandbox",
      "--yolo",
      "--output-format",
      "json",
    ]);

    expect(resolveSnapshotApiModel(config)).toMatchObject({
      model: "google/gemini-2.5-flash",
      provider: "google",
      source: "ai-config",
    });
  });

  it("maps the built-in gemini preset to Gemini API when GOOGLE_GENERATIVE_AI_API_KEY is present", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-gemini-key");

    const config = makeConfig("gemini", [
      "gemini",
      "--sandbox",
      "--yolo",
      "--output-format",
      "json",
    ]);

    expect(resolveSnapshotApiModel(config)).toMatchObject({
      model: "google/gemini-2.5-flash",
      provider: "google",
      source: "ai-config",
    });
  });

  it("maps the built-in gemini preset to Vertex when only GOOGLE_CLOUD_PROJECT is present", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");

    const config = makeConfig("gemini", [
      "gemini",
      "--sandbox",
      "--yolo",
      "--output-format",
      "json",
    ]);

    expect(resolveSnapshotApiModel(config)).toMatchObject({
      model: "vertex/gemini-2.5-flash",
      provider: "vertex",
      source: "ai-config",
    });
  });

  it("does not override a custom CLI analyzer unless LIBRETTO_SNAPSHOT_MODEL is set", () => {
    vi.stubEnv("LIBRETTO_DISABLE_DOTENV", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");

    const config = makeConfig("codex", [process.execPath, "/tmp/custom-analyzer.mjs"]);

    expect(shouldUseApiSnapshotAnalyzer(config)).toBe(false);
    expect(resolveSnapshotApiModel(config)).toBeNull();

    vi.stubEnv("LIBRETTO_SNAPSHOT_MODEL", "vertex/gemini-2.5-flash");
    expect(shouldUseApiSnapshotAnalyzer(config)).toBe(true);
    expect(resolveSnapshotApiModel(config)).toMatchObject({
      model: "vertex/gemini-2.5-flash",
      provider: "vertex",
      source: "env:LIBRETTO_SNAPSHOT_MODEL",
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

  it("preserves unknown backslashes in double-quoted values", () => {
    expect(
      parseDotEnvAssignment(
        String.raw`GOOGLE_APPLICATION_CREDENTIALS="C:\\Users\\me\\key.json"`,
      ),
    ).toEqual({
      key: "GOOGLE_APPLICATION_CREDENTIALS",
      value: String.raw`C:\Users\me\key.json`,
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
    const config = makeConfig("codex", ["codex"], "openai/gpt-5-mini");
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
      config,
    );

    expect(selection.domSource).toBe("full");
    expect(selection.truncated).toBe(false);
  });

  it("chooses the condensed DOM when the full prompt would exceed the budget", () => {
    const config = makeConfig("codex", ["codex"], "openai/gpt-5-mini");
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
      config,
    );

    expect(selection.domSource).toBe("condensed");
    expect(selection.truncated).toBe(false);
  });
});
