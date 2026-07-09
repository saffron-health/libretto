import { openai } from "@ai-sdk/openai";
import { stepCountIs, ToolLoopAgent } from "ai";
import { expect, test } from "vitest";
import { createAiSdkBrowserTools } from "../src/adapters/ai-sdk/index.js";
import { LocalBrowserProvider } from "../src/providers/local.js";
import { requireOpenAiApiKey } from "./setup.js";

test("reads the first Hacker News story title", async () => {
	requireOpenAiApiKey();

	const { tools, dispose } = createAiSdkBrowserTools(
		new LocalBrowserProvider({ headless: true }),
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
		expect(toolCalls.some((call) => call.toolName === "browser_open")).toBe(
			true,
		);
	} finally {
		await dispose();
	}
});
