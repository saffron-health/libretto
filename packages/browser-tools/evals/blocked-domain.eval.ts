import { openai } from "@ai-sdk/openai";
import { stepCountIs, ToolLoopAgent } from "ai";
import { expect, test } from "vitest";
import { createAiSdkBrowserTools } from "../src/adapters/ai-sdk/index.js";
import { LocalBrowserProvider } from "../src/providers/local.js";
import { requireOpenAiApiKey } from "./setup.js";

test("reports when domain policy blocks the requested website", async () => {
	requireOpenAiApiKey();

	const { tools, dispose } = createAiSdkBrowserTools(
		new LocalBrowserProvider({ headless: true }),
		{ blockedDomains: ["example.com"] },
	);
	const agent = new ToolLoopAgent({
		model: openai("gpt-5.5"),
		tools,
		stopWhen: stepCountIs(4),
		providerOptions: {
			openai: {
				store: false,
			},
		},
	});

	const result = await agent.generate({
		prompt:
			"Open https://example.com and report its page title. If access is blocked, " +
			"explain the restriction instead of retrying another way.",
	});
	const toolCalls = result.steps.flatMap((step) => step.toolCalls);

	expect(toolCalls.some((call) => call.toolName === "browser_open")).toBe(true);
	expect(result.text).toMatch(/block|restrict|policy/i);
	await dispose();
});
