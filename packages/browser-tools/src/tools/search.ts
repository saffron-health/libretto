import { z } from "zod";
import { errorMessage } from "../errors.js";
import {
	formatHtmlForSearch,
	searchFormattedHtml,
	type SearchHtmlMatch,
} from "../html-search/search-html.js";
import type { SessionRegistry } from "../session-registry.js";
import type { BrowserTool, ToolResult } from "../tool.js";

const searchInputSchema = z.object({
	sessionId: z
		.string()
		.describe('Session ID returned by browser_open, e.g. "ses-4f2a".'),
	pattern: z
		.string()
		.describe(
			"JavaScript regex pattern to search for in the formatted HTML snapshot.",
		),
	pageId: z
		.string()
		.optional()
		.describe(
			"Optional page ID from browser_status. Defaults to the most recently opened tab.",
		),
});

export type SearchToolInput = z.infer<typeof searchInputSchema>;

export type SearchMatch = SearchHtmlMatch;

export type SearchToolOutput = {
	matches: SearchMatch[];
	matchCount: number;
};

export type SearchTool = {
	inputSchema: typeof searchInputSchema;
} & BrowserTool<SearchToolInput, SearchToolOutput>;

function isInvalidRegExpError(err: unknown): boolean {
	return err instanceof SyntaxError;
}

export function createSearchTool(registry: SessionRegistry): SearchTool {
	return {
		name: "browser_search",
		description:
			"Search the current page's condensed HTML snapshot with a JavaScript " +
			"regex. Returns matching regions with surrounding context. Use this to " +
			"find attributes, text, or markup that the accessibility tree may omit " +
			"(for example data-* attrs, hidden fields, or raw tag structure).",
		inputSchema: searchInputSchema,
		async execute({
			sessionId,
			pattern,
			pageId,
		}): Promise<ToolResult<SearchToolOutput>> {
			let page;
			try {
				page = registry.getCurrentPage(sessionId, pageId);
			} catch (err) {
				return {
					ok: false,
					error:
						`${errorMessage(err)}. Call browser_open to get a session ID, ` +
						"then pass it to browser_search.",
				};
			}

			try {
				const html = await page.content();
				const formattedHtml = formatHtmlForSearch(html);
				const matches = searchFormattedHtml(formattedHtml, pattern);
				return {
					ok: true,
					matches,
					matchCount: matches.length,
				};
			} catch (err) {
				if (isInvalidRegExpError(err)) {
					return {
						ok: false,
						error:
							`Invalid JavaScript regex pattern /${pattern}/ (${errorMessage(err)}). ` +
							"Pass a valid RegExp source string — for example `data-testid=\"submit\"` " +
							"or `class=\"[^\"]*btn[^\"]*\"`.",
					};
				}
				return {
					ok: false,
					error:
						`Could not search page HTML (${errorMessage(err)}). ` +
						"Try browser_status to see open pages, or browser_open if the session ended.",
				};
			}
		},
	};
}
