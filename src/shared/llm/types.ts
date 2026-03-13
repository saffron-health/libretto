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
 *
 * **Error handling:** implementations should throw on failure rather than
 * returning sentinel values (e.g. `null` or `undefined`). Libretto relies
 * on exceptions to trigger retry/recovery logic.
 *
 * A ready-made adapter for the Vercel AI SDK is available via
 * {@link createLLMClientFromModel} in `libretto/llm`.
 */
export interface LLMClient {
	/**
	 * Generate a structured object from a single text prompt.
	 *
	 * The underlying model **must** support structured / JSON output so that
	 * the response can be parsed and validated against the provided Zod schema.
	 *
	 * @param opts.prompt - The text prompt sent to the model.
	 * @param opts.schema - A Zod schema describing the expected response shape.
	 * @param opts.temperature - Sampling temperature (default chosen by implementation, typically 0).
	 * @returns The parsed object matching the schema.
	 * @throws On LLM or parsing failure.
	 */
	generateObject<T extends z.ZodType>(opts: {
		prompt: string;
		schema: T;
		temperature?: number;
	}): Promise<z.output<T>>;

	/**
	 * Generate a structured object from a conversation-style message array.
	 *
	 * Messages may contain **image content** (base64 data URIs via
	 * {@link MessageContentPart}), so the backing model must support
	 * vision / multimodal input when images are present.
	 *
	 * @param opts.messages - Ordered list of user/assistant messages, potentially multimodal.
	 * @param opts.schema - A Zod schema describing the expected response shape.
	 * @param opts.temperature - Sampling temperature (default chosen by implementation, typically 0).
	 * @returns The parsed object matching the schema.
	 * @throws On LLM or parsing failure.
	 */
	generateObjectFromMessages<T extends z.ZodType>(opts: {
		messages: Message[];
		schema: T;
		temperature?: number;
	}): Promise<z.output<T>>;
}
