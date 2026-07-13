import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	judgePiBrowserTask,
	runPiBrowserTask,
} from "./pi-harness.js";
import { requireKernelApiKey } from "./setup.js";

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
	async ({ name, task }) => {
		requireKernelApiKey();
		const workspace = await mkdtemp(
			join(tmpdir(), "browser-tools-public-eval-"),
		);

		try {
			const run = await runPiBrowserTask({ task, workspace });
			expect(run.answer.trim().length).toBeGreaterThan(0);
			expect(run.toolNames).toContain("browser_open");
			expect(
				run.toolNames.some(
					(toolName) =>
						toolName === "browser_snapshot" || toolName === "browser_exec",
				),
			).toBe(true);

			const judgment = await judgePiBrowserTask({
				task,
				run,
				workspace,
			});
			console.log(
				JSON.stringify({
					eval: name,
					score: judgment.completed ? "1/1" : "0/1",
					judgment,
				}),
			);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	},
	600_000,
);
