import { expect, test as base } from "vitest";
import { LocalBrowserProvider } from "../src/providers/local.js";
import { SessionRegistry } from "../src/session-registry.js";
import { createExecTool } from "../src/tools/exec.js";
import { createOpenTool } from "../src/tools/open.js";

const test = base.extend<{
	registry: SessionRegistry;
	open: ReturnType<typeof createOpenTool>;
	exec: ReturnType<typeof createExecTool>;
}>({
	registry: async ({}, use) => {
		const registry = new SessionRegistry(
			new LocalBrowserProvider({ headless: true }),
		);
		await use(registry);
		await registry.dispose();
	},
	open: async ({ registry }, use) => {
		await use(createOpenTool(registry));
	},
	exec: async ({ registry }, use) => {
		await use(createExecTool(registry));
	},
});

test("browser_open navigates to a url and returns a session ID", async ({
	open,
}) => {
	const result = await open.execute({
		url: "data:text/html,<title>hello</title>",
	});
	expect(result).toEqual({ ok: true, sessionId: expect.any(String) });
});

test("browser_exec runs Playwright code against an open session", async ({
	open,
	exec,
}) => {
	const opened = await open.execute({
		url: "data:text/html,<title>hello</title>",
	});
	if (!opened.ok) throw new Error(opened.error);

	const result = await exec.execute({
		sessionId: opened.sessionId,
		code: "return page.title()",
	});
	expect(result).toEqual({
		ok: true,
		result: "hello",
		stdout: "",
		stderr: "",
	});
});

test("browser_exec returns ok false for an unknown session ID", async ({
	exec,
}) => {
	const result = await exec.execute({
		sessionId: "ses-nope",
		code: "return page.title()",
	});
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.error).toMatch(/ses-nope/);
});
