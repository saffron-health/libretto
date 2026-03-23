import { generateObject, type LanguageModel, type ModelMessage } from "ai";
import type { ZodType, output as ZodOutput } from "zod";
import type { LLMClient, Message, MessageContentPart } from "./types.js";

export type Provider = "google" | "vertex" | "anthropic" | "openai";

const GEMINI_API_KEY_ENV_VARS = [
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const;

const VERTEX_PROJECT_ENV_VARS = [
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
] as const;

const SUPPORTED_PROVIDER_ALIASES = {
  google: "google",
  gemini: "google",
  vertex: "vertex",
  anthropic: "anthropic",
  codex: "openai",
  openai: "openai",
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
      `Unsupported provider "${providerInput}". Supported providers: openai/codex, anthropic, google (Gemini API), and vertex.`,
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
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      const google = createGoogleGenerativeAI({ apiKey });
      return google(modelId);
    }
    case "vertex": {
      const project = readFirstEnvValue(process.env, VERTEX_PROJECT_ENV_VARS);
      if (!project) {
        throw new Error(missingProviderCredentialsMessage(provider));
      }
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
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const anthropic = createAnthropic({ apiKey });
      return anthropic(modelId);
    }
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) {
        throw new Error(missingProviderCredentialsMessage(provider));
      }
      const { createOpenAI } = await import("@ai-sdk/openai");
      const openai = createOpenAI({ apiKey });
      return openai(modelId);
    }
  }
}

function convertUserContentParts(parts: MessageContentPart[]) {
  return parts.map((part) => {
    if (part.type === "text") {
      return { type: "text" as const, text: part.text };
    }
    return {
      type: "image" as const,
      image: part.image,
      ...(part.mediaType ? { mediaType: part.mediaType } : {}),
    };
  });
}

function convertAssistantContentParts(parts: MessageContentPart[]) {
  return parts
    .filter(
      (part): part is MessageContentPart & { type: "text" } =>
        part.type === "text",
    )
    .map((part) => ({ type: "text" as const, text: part.text }));
}

function convertMessages(messages: Message[]): ModelMessage[] {
  return messages.map((msg): ModelMessage => {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        return { role: "user", content: msg.content };
      }
      return {
        role: "user",
        content: convertUserContentParts(msg.content),
      };
    }
    if (typeof msg.content === "string") {
      return { role: "assistant", content: msg.content };
    }
    return {
      role: "assistant",
      content: convertAssistantContentParts(msg.content),
    };
  });
}

export function createLLMClient(model: string): LLMClient {
  const { provider, modelId } = parseModel(model);
  let modelPromise: Promise<LanguageModel> | null = null;

  const getModel = () => {
    modelPromise ??= getProviderModel(provider, modelId);
    return modelPromise;
  };

  return {
    async generateObject<T extends ZodType>(opts: {
      prompt: string;
      schema: T;
      temperature?: number;
    }): Promise<ZodOutput<T>> {
      const aiModel = await getModel();
      const result = await generateObject({
        model: aiModel,
        prompt: opts.prompt,
        schema: opts.schema,
        temperature: opts.temperature ?? 0,
      });
      return result.object as ZodOutput<T>;
    },

    async generateObjectFromMessages<T extends ZodType>(opts: {
      messages: Message[];
      schema: T;
      temperature?: number;
    }): Promise<ZodOutput<T>> {
      const aiModel = await getModel();
      const result = await generateObject({
        model: aiModel,
        messages: convertMessages(opts.messages),
        schema: opts.schema,
        temperature: opts.temperature ?? 0,
      });
      return result.object as ZodOutput<T>;
    },
  };
}
