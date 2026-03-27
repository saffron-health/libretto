import { generateObject, type LanguageModel } from "ai";
import type { ZodType, output as ZodOutput } from "zod";
import type { LLMClient, Message } from "./types.js";

/**
 * Creates a libretto LLMClient from a Vercel AI SDK LanguageModel.
 *
 * This eliminates the need for consumers to write their own adapter
 * when using @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google-vertex,
 * or any other Vercel AI SDK-compatible provider.
 *
 * @example
 * ```typescript
 * import { createLLMClientFromModel } from "libretto/llm";
 * import { openai } from "@ai-sdk/openai";
 *
 * const llmClient = createLLMClientFromModel(openai("gpt-4o"));
 * ```
 */
export function createLLMClientFromModel(model: LanguageModel): LLMClient {
  return {
    async generateObject<T extends ZodType>(opts: {
      prompt: string;
      schema: T;
      temperature?: number;
    }): Promise<ZodOutput<T>> {
      const { object } = await generateObject({
        model,
        schema: opts.schema,
        prompt: opts.prompt,
        temperature: opts.temperature ?? 0,
      });
      return object as ZodOutput<T>;
    },

    async generateObjectFromMessages<T extends ZodType>(opts: {
      messages: Message[];
      schema: T;
      temperature?: number;
    }): Promise<ZodOutput<T>> {
      // Convert libretto Message format to AI SDK message format
      const messages = opts.messages.map((msg) => {
        if (typeof msg.content === "string") {
          return { role: msg.role, content: msg.content };
        }
        if (msg.role === "assistant") {
          // AssistantContent only supports text parts (no images)
          return {
            role: "assistant" as const,
            content: msg.content
              .filter(
                (part): part is typeof part & { type: "text" } =>
                  part.type === "text",
              )
              .map((part) => ({ type: "text" as const, text: part.text })),
          };
        }
        return {
          role: "user" as const,
          content: msg.content.map((part) =>
            part.type === "text"
              ? { type: "text" as const, text: part.text }
              : {
                  type: "image" as const,
                  image: part.image,
                  ...(part.mediaType ? { mediaType: part.mediaType } : {}),
                },
          ),
        };
      });

      const { object } = await generateObject({
        model,
        schema: opts.schema,
        messages,
        temperature: opts.temperature ?? 0,
      });
      return object as ZodOutput<T>;
    },
  };
}
