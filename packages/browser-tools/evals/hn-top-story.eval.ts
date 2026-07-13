import { openai } from "@ai-sdk/openai";
import { stepCountIs, ToolLoopAgent } from "ai";
import { expect, test } from "vitest";
import { createAiSdkBrowserTools } from "../src/adapters/ai-sdk/index.js";
import { KernelBrowserProvider } from "../src/providers/kernel.js";
import {
	requireKernelApiKey,
	requireOpenAiApiKey,
} from "./setup.js";

test("reads the first Hacker News story title", async () => {
	requireOpenAiApiKey();
	requireKernelApiKey();

	const { tools, dispose } = createAiSdkBrowserTools(
		new KernelBrowserProvider({ stealth: true, headless: false }),
	);

	try {
		const agent = new ToolLoopAgent({
			model: openai("gpt-5.5"),
			tools,
			stopWhen: stepCountIs(8),
			providerOptions: {
				openai: {
					// Required for Zero Data Retention orgs.
					store: false,
				},
			},
		});

		const result = await agent.generate({
			prompt:
				"Open https://news.ycombinator.com, read the page, and reply with only " +
				"the title of the first story link on the page (no commentary).",
		});

		const toolCalls = result.steps.flatMap((step) => step.toolCalls);

		expect(result.text.trim().length).toBeGreaterThan(0);
		expect(toolCalls.some((call) => call.toolName === "browser_open")).toBe(true);
	} finally {
		await dispose();
	}
});
