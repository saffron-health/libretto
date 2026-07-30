import type { LanguageModel } from "ai";

export type Provider =
  | "google"
  | "vertex"
  | "anthropic"
  | "openai"
  | "openrouter"
  | "minimax";

const GEMINI_API_KEY_ENV_VARS = [
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const;

const VERTEX_PROJECT_ENV_VARS = [
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
] as const;

// MiniMax exposes OpenAI-compatible and Anthropic-compatible endpoints. The
// global endpoint (api.minimax.io) and the China endpoint (api.minimaxi.com)
// share the same path layout: the OpenAI-compatible base is `${host}/v1` and
// the Anthropic-compatible base is `${host}/anthropic`.
const MINIMAX_GLOBAL_HOST = "https://api.minimax.io";
const MINIMAX_CHINA_HOST = "https://api.minimaxi.com";

function isMinimaxChinaRegion(): boolean {
  const region = process.env.MINIMAX_REGION?.trim().toLowerCase();
  return region === "cn" || region === "cn_zh" || region === "china";
}

function resolveMinimaxOpenAiBaseUrl(): string {
  return `${isMinimaxChinaRegion() ? MINIMAX_CHINA_HOST : MINIMAX_GLOBAL_HOST}/v1`;
}

function resolveMinimaxAnthropicBaseUrl(): string {
  return `${isMinimaxChinaRegion() ? MINIMAX_CHINA_HOST : MINIMAX_GLOBAL_HOST}/anthropic`;
}

const SUPPORTED_PROVIDER_ALIASES = {
  google: "google",
  gemini: "google",
  vertex: "vertex",
  anthropic: "anthropic",
  codex: "openai",
  openai: "openai",
  openrouter: "openrouter",
  minimax: "minimax",
} as const satisfies Record<string, Provider>;

function readFirstEnvValue(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

export function parseModel(model: string): {
  provider: Provider;
  modelId: string;
} {
  const slashIndex = model.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(
      `Invalid model string "${model}". Expected format: "provider/model-id" (for example "openai/gpt-5.4", "anthropic/claude-sonnet-4-6", "google/gemini-3-flash-preview", or "vertex/gemini-2.5-pro").`,
    );
  }
  const providerInput = model.slice(0, slashIndex).toLowerCase();
  const provider =
    SUPPORTED_PROVIDER_ALIASES[
      providerInput as keyof typeof SUPPORTED_PROVIDER_ALIASES
    ];
  const modelId = model.slice(slashIndex + 1);

  if (!provider) {
    throw new Error(
      `Unsupported provider "${providerInput}". Supported providers: openai/codex, anthropic, google (Gemini API), vertex, openrouter, and minimax.`,
    );
  }

  return { provider, modelId };
}

export function hasProviderCredentials(
  provider: Provider,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  switch (provider) {
    case "google":
      return readFirstEnvValue(env, GEMINI_API_KEY_ENV_VARS) !== null;
    case "vertex":
      return readFirstEnvValue(env, VERTEX_PROJECT_ENV_VARS) !== null;
    case "anthropic":
      return Boolean(env.ANTHROPIC_API_KEY?.trim());
    case "openai":
      return Boolean(env.OPENAI_API_KEY?.trim());
    case "openrouter":
      return Boolean(env.OPENROUTER_API_KEY?.trim());
    case "minimax":
      return Boolean(env.MINIMAX_API_KEY?.trim());
  }
}

export function missingProviderCredentialsMessage(provider: Provider): string {
  switch (provider) {
    case "google":
      return "Gemini API key is missing. Set GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.";
    case "vertex":
      return "Vertex AI project is missing. Set GOOGLE_CLOUD_PROJECT (or GCLOUD_PROJECT) and ensure application default credentials are configured.";
    case "anthropic": {
      return "Anthropic API key is missing. Set ANTHROPIC_API_KEY.";
    }
    case "openai": {
      return "OpenAI API key is missing. Set OPENAI_API_KEY.";
    }
    case "openrouter": {
      return "OpenRouter API key is missing. Set OPENROUTER_API_KEY.";
    }
    case "minimax": {
      return "MiniMax API key is missing. Set MINIMAX_API_KEY.";
    }
  }
}

async function getProviderModel(
  provider: Provider,
  modelId: string,
): Promise<LanguageModel> {
  switch (provider) {
    case "google": {
      const apiKey = readFirstEnvValue(process.env, GEMINI_API_KEY_ENV_VARS);
      if (!apiKey) {
        throw new Error(missingProviderCredentialsMessage(provider));
      }
      // oxlint-disable-next-line libretto/no-await-import -- Human-approved: we don't want to import unless the user is using that subagent.
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      const google = createGoogleGenerativeAI({ apiKey });
      return google(modelId);
    }
    case "vertex": {
      const project = readFirstEnvValue(process.env, VERTEX_PROJECT_ENV_VARS);
      if (!project) {
        throw new Error(missingProviderCredentialsMessage(provider));
      }
      // oxlint-disable-next-line libretto/no-await-import -- Human-approved: we don't want to import unless the user is using that subagent.
      const { createVertex } = await import("@ai-sdk/google-vertex");
      const vertex = createVertex({
        project,
        location: process.env.GOOGLE_CLOUD_LOCATION || "global",
      });
      return vertex(modelId);
    }
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
      if (!apiKey) {
        throw new Error(missingProviderCredentialsMessage(provider));
      }
      // oxlint-disable-next-line libretto/no-await-import -- Human-approved: we don't want to import unless the user is using that subagent.
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const anthropic = createAnthropic({ apiKey });
      return anthropic(modelId);
    }
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) {
        throw new Error(missingProviderCredentialsMessage(provider));
      }
      // oxlint-disable-next-line libretto/no-await-import -- Human-approved: we don't want to import unless the user is using that subagent.
      const { createOpenAI } = await import("@ai-sdk/openai");
      const openai = createOpenAI({ apiKey });
      return openai(modelId);
    }
    case "openrouter": {
      const apiKey = process.env.OPENROUTER_API_KEY?.trim();
      if (!apiKey) {
        throw new Error(missingProviderCredentialsMessage(provider));
      }
      // oxlint-disable-next-line libretto/no-await-import -- Human-approved: we don't want to import unless the user is using that subagent.
      const { createOpenAI } = await import("@ai-sdk/openai");
      const openrouter = createOpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
      });
      return openrouter(modelId);
    }
    case "minimax": {
      const apiKey = process.env.MINIMAX_API_KEY?.trim();
      if (!apiKey) {
        throw new Error(missingProviderCredentialsMessage(provider));
      }
      // MiniMax models are reachable through either the OpenAI-compatible
      // endpoint (default) or the Anthropic-compatible endpoint. Set
      // MINIMAX_API_STYLE=anthropic to use the Anthropic-compatible base.
      const useAnthropicStyle =
        process.env.MINIMAX_API_STYLE?.trim().toLowerCase() === "anthropic";
      if (useAnthropicStyle) {
        // oxlint-disable-next-line libretto/no-await-import -- Human-approved: we don't want to import unless the user is using that subagent.
        const { createAnthropic } = await import("@ai-sdk/anthropic");
        const anthropic = createAnthropic({
          apiKey,
          baseURL: resolveMinimaxAnthropicBaseUrl(),
        });
        return anthropic(modelId);
      }
      // oxlint-disable-next-line libretto/no-await-import -- Human-approved: we don't want to import unless the user is using that subagent.
      const { createOpenAI } = await import("@ai-sdk/openai");
      const minimax = createOpenAI({
        apiKey,
        baseURL: resolveMinimaxOpenAiBaseUrl(),
      });
      return minimax(modelId);
    }
  }
}

export async function resolveModel(model: string): Promise<LanguageModel> {
  const { provider, modelId } = parseModel(model);
  return getProviderModel(provider, modelId);
}
