import type z from "zod";

export type MessageContentPart =
	| { type: "text"; text: string }
	| { type: "image"; image: string };

export type Message = {
	role: "user" | "assistant";
	content: string | MessageContentPart[];
};

/**
 * Pluggable LLM client interface.
 *
 * Users provide their own implementation backed by any LLM provider
 * (OpenAI, Anthropic, etc.). Libretto uses this interface for AI extraction,
 * recovery agents, and error detection.
 */
export interface LLMClient {
	generateObject<T extends z.ZodType>(opts: {
		prompt: string;
		schema: T;
		temperature?: number;
	}): Promise<z.infer<T>>;

	generateObjectFromMessages<T extends z.ZodType>(opts: {
		messages: Message[];
		schema: T;
		temperature?: number;
	}): Promise<z.infer<T>>;
}
