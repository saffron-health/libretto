import { transform } from "sucrase";
import type { Browser, BrowserContext, Page } from "playwright";
import { errorMessage } from "../errors.js";
import type { ToolResult } from "../tool.js";

/** Default wall-clock budget for agent-written exec code. */
export const DEFAULT_EXEC_TIMEOUT_MS = 10_000;

export type ExecScope = {
	page: Page;
	context: BrowserContext;
	browser: Browser;
}

export type ExecResult = ToolResult<{
	result: unknown;
	stdout: string;
	stderr: string;
}>;

export type RunExecCodeOptions = {
	/** Max wall-clock time for the exec in milliseconds. Defaults to 10000. */
	timeoutMs?: number;
}

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

function timeoutErrorMessage(timeoutMs: number): string {
	return (
		`Exec timed out after ${timeoutMs}ms. Pass a larger timeoutMs on browser_exec ` +
		"for slow work, or simplify the code so it finishes sooner."
	);
}

/**
 * Runs agent-written code as the body of a fresh async function — stateless,
 * nothing persists between calls. A top-level `return` produces the result.
 * Code-level failures (parse errors, throws, timeouts) come back as `ok: false`;
 * this function never throws for them.
 */
export async function runExecCode(
	code: string,
	scope: ExecScope,
	options: RunExecCodeOptions = {},
): Promise<ExecResult> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
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
		const execution = Promise.resolve(
			fn(scope.page, scope.context, scope.browser, consoleProxy),
		);

		let timerId: ReturnType<typeof setTimeout> | undefined;
		const timedOut = new Promise<never>((_resolve, reject) => {
			timerId = setTimeout(() => {
				reject(new Error(timeoutErrorMessage(timeoutMs)));
			}, timeoutMs);
		});

		try {
			const result = await Promise.race([execution, timedOut]);
			return {
				ok: true,
				result: toJsonSafe(result),
				stdout: stdoutLines.join("\n"),
				stderr: stderrLines.join("\n"),
			};
		} finally {
			if (timerId !== undefined) clearTimeout(timerId);
			// Losing the race must not leave an unhandled rejection.
			void execution.catch(() => {});
		}
	} catch (err) {
		return {
			ok: false,
			error: errorMessage(err),
			stdout: stdoutLines.join("\n"),
			stderr: stderrLines.join("\n"),
		};
	}
}
