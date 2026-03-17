/**
 * Web Tools Extension
 *
 * Provides two tools the LLM can use:
 *   - read_web_page: Fetch a URL and return its text content (HTML stripped to readable text)
 *   - web_search: Search the web via DuckDuckGo and return results
 *
 * Ported from OpenCode's built-in read_web_page and web_search tools.
 * Uses only Node built-ins and shell commands — no npm dependencies.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

/**
 * Minimal HTML-to-text: strips tags, decodes common entities, collapses whitespace.
 */
function htmlToText(html: string): string {
	let text = html;
	// Remove script/style blocks
	text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
	text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
	// Convert block elements to newlines
	text = text.replace(/<(br|p|div|h[1-6]|li|tr|blockquote|hr)[^>]*>/gi, "\n");
	// Strip remaining tags
	text = text.replace(/<[^>]+>/g, "");
	// Decode common entities
	text = text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");
	// Collapse whitespace
	text = text.replace(/[ \t]+/g, " ");
	text = text.replace(/\n{3,}/g, "\n\n");
	return text.trim();
}

export default function (pi: ExtensionAPI) {
	// ── read_web_page ──────────────────────────────────────────────────
	pi.registerTool({
		name: "read_web_page",
		label: "Read Web Page",
		description:
			"Fetch a URL and return its text content. Good for reading documentation, articles, and web pages. " +
			`Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
		promptGuidelines: [
			"Use read_web_page to fetch documentation, articles, or any web content when you need information from a URL.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "URL to fetch" }),
		}),

		async execute(_toolCallId, params, signal) {
			const { url } = params;

			// Use Node built-in fetch
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 30_000);

			// Forward parent signal
			if (signal) {
				signal.addEventListener("abort", () => controller.abort(), { once: true });
			}

			let response: Response;
			try {
				response = await fetch(url, {
					signal: controller.signal,
					headers: {
						"User-Agent":
							"Mozilla/5.0 (compatible; PiCodingAgent/1.0; +https://shittycodingagent.ai)",
						Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
					},
					redirect: "follow",
				});
			} catch (err: any) {
				throw new Error(`Failed to fetch ${url}: ${err.message}`);
			} finally {
				clearTimeout(timeout);
			}

			if (!response.ok) {
				throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
			}

			const contentType = response.headers.get("content-type") || "";
			const body = await response.text();

			// Convert HTML to plain text, pass through text/plain
			const text = contentType.includes("text/html") ? htmlToText(body) : body;

			// Truncate
			const truncation = truncateHead(text, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});

			let result = truncation.content;
			if (truncation.truncated) {
				result += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
			}

			return {
				content: [{ type: "text", text: result }],
				details: { url, truncated: truncation.truncated },
			};
		},
	});

	// ── web_search ─────────────────────────────────────────────────────
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web using DuckDuckGo and return results. Returns titles, URLs, and snippets.",
		promptGuidelines: [
			"Use web_search to find information on the internet when you don't know a specific URL.",
			"After searching, use read_web_page to get full content from relevant results.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			count: Type.Optional(
				Type.Number({
					description: "Number of results to return (default: 8, max: 20)",
				}),
			),
		}),

		async execute(_toolCallId, params, signal) {
			const { query, count = 8 } = params;
			const maxResults = Math.min(count, 20);

			// Use DuckDuckGo HTML search (no API key required)
			const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 15_000);
			if (signal) {
				signal.addEventListener("abort", () => controller.abort(), { once: true });
			}

			let html: string;
			try {
				const response = await fetch(searchUrl, {
					signal: controller.signal,
					headers: {
						"User-Agent":
							"Mozilla/5.0 (compatible; PiCodingAgent/1.0; +https://shittycodingagent.ai)",
						Accept: "text/html",
					},
				});
				html = await response.text();
			} catch (err: any) {
				throw new Error(`Search failed: ${err.message}`);
			} finally {
				clearTimeout(timeout);
			}

			// Parse DuckDuckGo HTML results
			const results: { title: string; url: string; snippet: string }[] = [];
			const resultPattern =
				/<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

			let match;
			while ((match = resultPattern.exec(html)) !== null && results.length < maxResults) {
				const rawUrl = match[1];
				const title = match[2].replace(/<[^>]+>/g, "").trim();
				const snippet = match[3].replace(/<[^>]+>/g, "").trim();

				// DuckDuckGo wraps URLs in a redirect; extract the actual URL
				let url = rawUrl;
				const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/);
				if (uddgMatch) {
					url = decodeURIComponent(uddgMatch[1]);
				}

				if (title && url) {
					results.push({ title, url, snippet });
				}
			}

			if (results.length === 0) {
				return {
					content: [{ type: "text", text: `No results found for: ${query}` }],
					details: { query, resultCount: 0 },
				};
			}

			const formatted = results
				.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
				.join("\n\n");

			return {
				content: [
					{
						type: "text",
						text: `Search results for "${query}":\n\n${formatted}`,
					},
				],
				details: { query, resultCount: results.length },
			};
		},
	});
}
