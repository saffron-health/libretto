import type { Page } from "playwright";
import type { ZodType, infer as ZodInfer } from "zod";
import type { LoggerApi } from "../../shared/logger/logger.js";
import type { LLMClient } from "../../shared/llm/types.js";

export type ExtractOptions<T extends ZodType> = {
	page: Page;
	instruction: string;
	schema: T;
	llmClient: LLMClient;
	logger: LoggerApi;
	/** Optional CSS selector to scope extraction to a specific element. */
	selector?: string;
};

/**
 * Generic AI-powered data extraction from page elements.
 * Takes a screenshot (full-page via CDP or scoped to an element),
 * captures DOM content, and uses an LLM to extract structured data
 * matching the provided Zod schema.
 */
export async function extractFromPage<T extends ZodType>(
	options: ExtractOptions<T>,
): Promise<ZodInfer<T>> {
	const { page, instruction, schema, selector, logger, llmClient } = options;

	let screenshot: string;
	let domContent: string | undefined;

	if (selector) {
		const element = page.locator(selector);
		await element.waitFor({ state: "visible", timeout: 10_000 });

		const screenshotBuffer = await element.screenshot();
		screenshot = screenshotBuffer.toString("base64");

		try {
			domContent = await element.innerHTML();
			if (domContent.length > 30000) {
				domContent = domContent.slice(0, 30000) + "\n... [truncated]";
			}
		} catch {
			domContent = undefined;
		}
	} else {
		const cdpClient = await page.context().newCDPSession(page);
		await cdpClient.send("Page.enable");
		const { data } = await cdpClient.send("Page.captureScreenshot", {
			format: "png",
		});
		screenshot = data;

		try {
			const htmlContent = await page.content();
			domContent =
				htmlContent.length > 50000
					? htmlContent.slice(0, 50000) + "\n... [truncated]"
					: htmlContent;
		} catch {
			domContent = undefined;
		}
	}

	const prompt = `You are analyzing a screenshot${selector ? " of a specific element" : ""} from a web page to extract structured data.

Instruction: ${instruction}

${domContent ? `Here is the HTML content for additional context:\n<html>\n${domContent}\n</html>` : ""}

Extract the requested information from the screenshot and return it in the specified format. Be precise and only extract what is visible.`;

	const result = await llmClient.generateObjectFromMessages({
		schema,
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: prompt },
					{ type: "image", image: `data:image/png;base64,${screenshot}` },
				],
			},
		],
		temperature: 0,
	});

	logger.info("extractFromPage completed", {
		selector,
		instruction: instruction.slice(0, 100),
	});

	return result;
}
