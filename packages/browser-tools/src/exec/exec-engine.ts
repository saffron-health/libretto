import { transform } from "sucrase";
import type { Browser, BrowserContext, Page } from "playwright";
import { errorMessage } from "../errors.js";
import type { ToolResult } from "../tool.js";

export interface ExecScope {
	page: Page;
	context: BrowserContext;
	browser: Browser;
}

export type ExecResult = ToolResult<{
	result: unknown;
	stdout: string;
	stderr: string;
}>;

type AsyncFunctionConstructor = new (
	...args: string[]
) => (...fnArgs: unknown[]) => Promise<unknown>;

const AsyncFunction = (
	Object.getPrototypeOf(async function () {}) as {
		constructor: AsyncFunctionConstructor;
	}
).constructor;

function formatConsoleArg(value: unknown): string {
	if (typeof value === "string") return value;
	if (value instanceof Error) return String(value);
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

function stripTypeScript(code: string): string {
	return transform(code, {
		transforms: ["typescript"],
		disableESTransforms: true,
		keepUnusedImports: true,
	}).code;
}

function toJsonSafe(result: unknown): unknown {
	if (result === undefined) return undefined;
	try {
		return JSON.parse(JSON.stringify(result)) as unknown;
	} catch {
		return String(result);
	}
}

/**
 * Runs agent-written code as the body of a fresh async function — stateless,
 * nothing persists between calls. A top-level `return` produces the result.
 * Code-level failures (parse errors, throws) come back as `ok: false`; this
 * function never throws for them.
 */
export async function runExecCode(
	code: string,
	scope: ExecScope,
): Promise<ExecResult> {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	const writeTo =
		(lines: string[]) =>
		(...args: unknown[]): void => {
			lines.push(args.map(formatConsoleArg).join(" "));
		};
	const consoleProxy = {
		log: writeTo(stdoutLines),
		info: writeTo(stdoutLines),
		debug: writeTo(stdoutLines),
		warn: writeTo(stderrLines),
		error: writeTo(stderrLines),
	};

	let stripped: string;
	try {
		stripped = stripTypeScript(code);
	} catch (err) {
		return { ok: false, error: errorMessage(err), stdout: "", stderr: "" };
	}

	try {
		const fn = new AsyncFunction(
			"page",
			"context",
			"browser",
			"console",
			stripped,
		);
		const result = await fn(scope.page, scope.context, scope.browser, consoleProxy);
		return {
			ok: true,
			result: toJsonSafe(result),
			stdout: stdoutLines.join("\n"),
			stderr: stderrLines.join("\n"),
		};
	} catch (err) {
		return {
			ok: false,
			error: errorMessage(err),
			stdout: stdoutLines.join("\n"),
			stderr: stderrLines.join("\n"),
		};
	}
}
