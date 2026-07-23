import { describe, expect, it } from "vitest";
import { runExecCode, type ExecScope } from "./exec-engine.js";

const stubPage = { url: () => "https://example.com" };
const scope = {
	page: stubPage,
	context: {},
	browser: {},
} as unknown as ExecScope;

describe("runExecCode", () => {
	it("returns a value produced by a top-level return", async () => {
		const result = await runExecCode("return 1 + 2;", scope);
		expect(result).toEqual({ ok: true, result: 3, stdout: "", stderr: "" });
	});

	it("exposes the page object to the agent code", async () => {
		const result = await runExecCode("return page.url();", scope);
		expect(result).toMatchObject({ ok: true, result: "https://example.com" });
	});

	it("handles TypeScript annotations", async () => {
		const result = await runExecCode(
			"const x: number = 1; return x + 1;",
			scope,
		);
		expect(result).toMatchObject({ ok: true, result: 2 });
	});

	it("returns ok: false for invalid syntax", async () => {
		const result = await runExecCode("return (;", scope);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBeTruthy();
		}
	});

	it("returns ok: false with console output when the code throws", async () => {
		const result = await runExecCode(
			'console.log("before"); throw new Error("boom");',
			scope,
		);
		expect(result).toMatchObject({
			ok: false,
			error: "boom",
			stdout: "before",
		});
	});

	it("routes console.log to stdout and console.error to stderr", async () => {
		const result = await runExecCode(
			'console.log("hello", { a: 1 }); console.error("bad thing"); return null;',
			scope,
		);
		expect(result).toMatchObject({
			ok: true,
			stdout: 'hello {"a":1}',
			stderr: "bad thing",
		});
	});

	it("does not crash on non-serializable return values", async () => {
		const cyclic = await runExecCode(
			"const a = {}; a.self = a; return a;",
			scope,
		);
		expect(cyclic).toMatchObject({ ok: true, result: "[object Object]" });

		const pageResult = await runExecCode("return page;", scope);
		expect(pageResult.ok).toBe(true);
	});

	it("does not persist state between calls", async () => {
		await runExecCode("var y = 1; return y;", scope);
		const result = await runExecCode("return typeof y;", scope);
		expect(result).toMatchObject({ ok: true, result: "undefined" });
	});
});
