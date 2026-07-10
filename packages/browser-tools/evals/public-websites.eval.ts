import { openai } from "@ai-sdk/openai";
import { stepCountIs, ToolLoopAgent } from "ai";
import { expect, test } from "vitest";
import { createAiSdkBrowserTools } from "../src/adapters/ai-sdk/index.js";
import { LibrettoCloudBrowserProvider } from "../src/providers/libretto-cloud.js";
import {
	requireLibrettoApiKey,
	requireOpenAiApiKey,
} from "./setup.js";

type PublicWebsiteEval = {
	name: string;
	task: string;
};

// Ported from the public Libretto benchmark in evals/public-website-benchmark.ts.
const PUBLIC_WEBSITE_EVALS: PublicWebsiteEval[] = [
	{
		name: "craigslist used bikes search",
		task: "Search Craigslist for used bikes in San Francisco. Tell me the title and price of the first relevant listing.",
	},
	{
		name: "apartments.com austin apartment search",
		task: "Search Apartments.com for apartments in Austin under $2,000. Tell me the first listing name, price, and neighborhood.",
	},
	{
		name: "apple newest iphone lookup",
		task: "Find the newest iPhone on Apple.com. Tell me its starting price and available colors.",
	},
	{
		name: "google official playwright docs result",
		task: 'Search Google for "Playwright docs network mocking". Open the official docs result and tell me the page title.',
	},
	{
		name: "youtube playwright tutorial search",
		task: 'Search YouTube for "Playwright tutorial". Tell me the title of the first video result.',
	},
];

test.concurrent.each(PUBLIC_WEBSITE_EVALS)(
	"$name",
	async ({ task }) => {
		requireOpenAiApiKey();
		requireLibrettoApiKey();

		const { tools, dispose } = createAiSdkBrowserTools(
			new LibrettoCloudBrowserProvider(),
		);

		try {
			const agent = new ToolLoopAgent({
				model: openai("gpt-5.5"),
				tools,
				stopWhen: stepCountIs(100),
				providerOptions: {
					openai: {
						store: false,
					},
				},
			});

			const result = await agent.generate({ prompt: task });
			const toolCalls = result.steps.flatMap((step) => step.toolCalls);

			expect(result.text.trim().length).toBeGreaterThan(0);
			expect(toolCalls.some((call) => call.toolName === "browser_open")).toBe(
				true,
			);
			expect(
				toolCalls.some(
					(call) =>
						call.toolName === "browser_snapshot" ||
						call.toolName === "browser_exec",
				),
			).toBe(true);
		} finally {
			await dispose();
		}
	},
	300_000,
);
