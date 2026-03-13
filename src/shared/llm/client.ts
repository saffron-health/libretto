import { createVertex } from "@ai-sdk/google-vertex";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, type ModelMessage } from "ai";
import type { ZodType, output as ZodOutput } from "zod";
import type { LLMClient, Message, MessageContentPart } from "./types.js";

type Provider = "google" | "anthropic" | "openai";

function parseModel(model: string): { provider: Provider; modelId: string } {
	const slashIndex = model.indexOf("/");
	if (slashIndex === -1) {
		throw new Error(
			`Invalid model string "${model}". Expected format: "provider/model-id" (e.g. "google/gemini-3-flash-preview").`,
		);
	}
	const provider = model.slice(0, slashIndex) as Provider;
	const modelId = model.slice(slashIndex + 1);

	if (!["google", "anthropic", "openai"].includes(provider)) {
		throw new Error(
			`Unsupported provider "${provider}". Supported providers: google, anthropic, openai.`,
		);
	}

	return { provider, modelId };
}

function getProviderModel(provider: Provider, modelId: string) {
	switch (provider) {
		case "google": {
			const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
			if (!project) {
				throw new Error(
					"Missing GCP project for Vertex AI. Set GOOGLE_CLOUD_PROJECT environment variable and ensure application default credentials are configured (gcloud auth application-default login).",
				);
			}
			const vertex = createVertex({
				project,
				location: process.env.GOOGLE_CLOUD_LOCATION || "global",
			});
			return vertex(modelId);
		}
		case "anthropic": {
			const apiKey = process.env.ANTHROPIC_API_KEY;
			if (!apiKey) {
				throw new Error(
					"Missing API key for Anthropic. Set ANTHROPIC_API_KEY environment variable.",
				);
			}
			const anthropic = createAnthropic({ apiKey });
			return anthropic(modelId);
		}
		case "openai": {
			const apiKey = process.env.OPENAI_API_KEY;
			if (!apiKey) {
				throw new Error(
					"Missing API key for OpenAI. Set OPENAI_API_KEY environment variable.",
				);
			}
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
		// Image parts: the AI SDK accepts data URIs directly
		return { type: "image" as const, image: part.image };
	});
}

function convertAssistantContentParts(parts: MessageContentPart[]) {
	// AssistantContent only supports text parts (no image parts)
	return parts
		.filter((part): part is MessageContentPart & { type: "text" } => part.type === "text")
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
		// assistant
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
	const aiModel = getProviderModel(provider, modelId);

	return {
		async generateObject<T extends ZodType>(opts: {
			prompt: string;
			schema: T;
			temperature?: number;
		}): Promise<ZodOutput<T>> {
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
