import type { Page } from "playwright";
import type { ZodType, infer as ZodInfer } from "zod";
import type { LoggerApi } from "../logger/logger.js";

export type RequestConfig = {
	url: string;
	method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
	headers?: Record<string, string>;
	body?: Record<string, any> | string;
	/** How to serialize the body. Defaults to "json". */
	bodyType?: "json" | "form";
	/** How to parse the response. Defaults to "json". */
	responseType?: "json" | "text" | "xml";
};

export type PageRequestOptions<T extends ZodType | undefined = undefined> = {
	logger?: LoggerApi;
	/** Optional Zod schema to validate the response body. */
	schema?: T;
};

type PageRequestResult<T extends ZodType | undefined> = T extends ZodType
	? ZodInfer<T>
	: any;

/**
 * Executes a fetch() call inside the browser context via page.evaluate().
 * Provides typed request config, automatic response parsing, optional Zod
 * validation, and logging.
 */
export async function pageRequest<T extends ZodType | undefined = undefined>(
	page: Page,
	config: RequestConfig,
	options?: PageRequestOptions<T>,
): Promise<PageRequestResult<T>> {
	const { url, method = "GET", headers = {}, body, bodyType = "json", responseType = "json" } = config;
	const { logger, schema } = options ?? {};

	const startTime = Date.now();

	// Build fetch options to pass into page.evaluate
	const fetchHeaders: Record<string, string> = { ...headers };
	let fetchBody: string | undefined;

	if (body !== undefined) {
		if (bodyType === "form") {
			fetchHeaders["Content-Type"] = "application/x-www-form-urlencoded";
			if (typeof body === "string") {
				fetchBody = body;
			} else {
				fetchBody = new URLSearchParams(
					Object.entries(body).map(([k, v]) => [k, String(v)]),
				).toString();
			}
		} else {
			fetchHeaders["Content-Type"] = "application/json";
			fetchBody = typeof body === "string" ? body : JSON.stringify(body);
		}
	}

	const result = await page.evaluate(
		async ({ url, method, headers, body, responseType }) => {
			const res = await fetch(url, {
				method,
				headers,
				body: body ?? undefined,
			});

			const status = res.status;
			const ok = res.ok;
			let data: any;

			if (responseType === "json") {
				data = await res.json();
			} else {
				data = await res.text();
			}

			return { status, ok, data };
		},
		{ url, method, headers: fetchHeaders, body: fetchBody, responseType },
	);

	const duration = Date.now() - startTime;

	if (!result.ok) {
		logger?.warn("network:request:error", {
			method,
			url,
			status: result.status,
			duration,
			body: typeof result.data === "string"
				? result.data.slice(0, 500)
				: undefined,
		});
		throw new Error(
			`pageRequest failed: ${method} ${url} returned ${result.status}`,
		);
	}

	logger?.info("network:request", {
		method,
		url,
		status: result.status,
		duration,
	});

	if (schema) {
		return schema.parse(result.data) as PageRequestResult<T>;
	}

	return result.data as PageRequestResult<T>;
}
