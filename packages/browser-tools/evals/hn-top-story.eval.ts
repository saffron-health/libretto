import { openai } from "@ai-sdk/openai";
import { stepCountIs, ToolLoopAgent } from "ai";
import { expect, test } from "vitest";
import { createAiSdkBrowserTools } from "../src/adapters/ai-sdk/index.js";
import type { BrowserProvider } from "../src/provider.js";
import { BrowserbaseBrowserProvider } from "../src/providers/browserbase.js";
import { KernelBrowserProvider } from "../src/providers/kernel.js";
import { LibrettoCloudBrowserProvider } from "../src/providers/libretto-cloud.js";
import { SteelBrowserProvider } from "../src/providers/steel.js";
import { requireOpenAiApiKey } from "./setup.js";

const providers: Array<[name: string, create: () => BrowserProvider]> = [
	["Kernel", () => new KernelBrowserProvider()],
	["Browserbase", () => new BrowserbaseBrowserProvider()],
	["Steel", () => new SteelBrowserProvider()],
	["Libretto Cloud", () => new LibrettoCloudBrowserProvider()],
];

test.each(providers)(
	"reads the first Hacker News story title with %s",
	async (_name, createProvider) => {
		requireOpenAiApiKey();

		const { tools, dispose } = createAiSdkBrowserTools(createProvider());

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
	},
);
