import {
	chmod,
	mkdir,
	mkdtemp,
	rm,
	stat,
	symlink,
} from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test as base } from "vitest";
import { createBrowserTools } from "../create-browser-tools.js";
import { AuthProfileError } from "../provider.js";
import { LocalBrowserProvider } from "./local.js";

const test = base.extend<{
	authServer: { origin: string };
	tempDirectory: string;
}>({
	authServer: async ({}, use) => {
		const server = createServer((request, response) => {
			if (request.url === "/login") {
				response.writeHead(302, {
					location: "/dashboard",
					"set-cookie": "session=valid; HttpOnly; Path=/; SameSite=Lax",
				});
				response.end();
				return;
			}

			const authenticated = request.headers.cookie?.includes("session=valid");
			response.writeHead(200, { "content-type": "text/html" });
			response.end(
				authenticated
					? "<main>Authenticated dashboard</main>"
					: "<main>Sign in required</main>",
			);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address() as AddressInfo;
		await use({ origin: `http://127.0.0.1:${address.port}` });
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	},
	tempDirectory: async ({}, use) => {
		const tempDirectory = await mkdtemp(join(tmpdir(), "browser-tools-local-"));
		await use(tempDirectory);
		await rm(tempDirectory, { recursive: true, force: true });
	},
});

test("local auth profiles use owner-only directories", async ({
	tempDirectory,
}) => {
	const authProfileDirectory = join(tempDirectory, "profiles");
	const profileDirectory = join(authProfileDirectory, "work");
	await mkdir(profileDirectory, { recursive: true, mode: 0o777 });
	await chmod(authProfileDirectory, 0o777);
	await chmod(profileDirectory, 0o777);
	const provider = new LocalBrowserProvider({
		authProfileDirectory,
		headless: true,
	});

	const session = await provider.createSession({ authProfile: "work" });
	if (session instanceof Error) throw session;

	expect((await stat(authProfileDirectory)).mode & 0o777).toBe(0o700);
	expect((await stat(profileDirectory)).mode & 0o777).toBe(0o700);
	const closed = await provider.closeSession(session.sessionId);
	if (closed instanceof Error) throw closed;
});

test("local auth profiles reject unsafe names without launching", async ({
	tempDirectory,
}) => {
	const provider = new LocalBrowserProvider({
		authProfileDirectory: join(tempDirectory, "profiles"),
		headless: true,
	});

	for (const authProfile of ["", ".", "..", "../work", "team/work"]) {
		const result = await provider.createSession({ authProfile });
		expect(result).toBeInstanceOf(AuthProfileError);
	}
});

test("local auth profiles reject symbolic links", async ({ tempDirectory }) => {
	const authProfileDirectory = join(tempDirectory, "profiles");
	const targetDirectory = join(tempDirectory, "target");
	await mkdir(authProfileDirectory, { recursive: true });
	await mkdir(targetDirectory);
	await symlink(targetDirectory, join(authProfileDirectory, "work"));
	const provider = new LocalBrowserProvider({
		authProfileDirectory,
		headless: true,
	});

	const result = await provider.createSession({ authProfile: "work" });

	expect(result).toBeInstanceOf(AuthProfileError);
});

test("unprofiled local sessions remain ephemeral", async ({ tempDirectory }) => {
	const authProfileDirectory = join(tempDirectory, "profiles");
	const provider = new LocalBrowserProvider({
		authProfileDirectory,
		headless: true,
	});

	const session = await provider.createSession();
	if (session instanceof Error) throw session;
	const closed = await provider.closeSession(session.sessionId);
	if (closed instanceof Error) throw closed;

	await expect(stat(authProfileDirectory)).rejects.toMatchObject({
		code: "ENOENT",
	});
});

test("local auth profiles restore login state after browser_close", async ({
	authServer,
	tempDirectory,
}) => {
	const toolkit = createBrowserTools(
		new LocalBrowserProvider({
			authProfileDirectory: join(tempDirectory, "profiles"),
			headless: true,
		}),
	);

	const loginSession = await toolkit.tools.browser_open.execute({
		authProfile: "work",
		url: `${authServer.origin}/login`,
	});
	if (!loginSession.ok) throw new Error(loginSession.error);
	const changed = await toolkit.tools.browser_exec.execute({
		sessionId: loginSession.sessionId,
		code:
			"localStorage.setItem('workspace', 'saved'); " +
			"return document.querySelector('main')?.textContent;",
	});
	expect(changed).toMatchObject({
		ok: true,
		result: "Authenticated dashboard",
	});
	expect(
		await toolkit.tools.browser_close.execute({
			sessionId: loginSession.sessionId,
		}),
	).toEqual({ ok: true });

	const restoredSession = await toolkit.tools.browser_open.execute({
		authProfile: "work",
		url: `${authServer.origin}/dashboard`,
	});
	if (!restoredSession.ok) throw new Error(restoredSession.error);
	const restored = await toolkit.tools.browser_exec.execute({
		sessionId: restoredSession.sessionId,
		code:
			"return { dashboard: document.querySelector('main')?.textContent, " +
			"workspace: localStorage.getItem('workspace') };",
	});
	expect(restored).toMatchObject({
		ok: true,
		result: {
			dashboard: "Authenticated dashboard",
			workspace: "saved",
		},
	});
	expect(
		await toolkit.tools.browser_close.execute({
			sessionId: restoredSession.sessionId,
		}),
	).toEqual({ ok: true });
	const disposed = await toolkit.dispose();
	if (disposed instanceof Error) throw disposed;
});

test("local auth profiles isolate login state by name", async ({
	authServer,
	tempDirectory,
}) => {
	const toolkit = createBrowserTools(
		new LocalBrowserProvider({
			authProfileDirectory: join(tempDirectory, "profiles"),
			headless: true,
		}),
	);

	const workSession = await toolkit.tools.browser_open.execute({
		authProfile: "work",
		url: `${authServer.origin}/login`,
	});
	if (!workSession.ok) throw new Error(workSession.error);
	const changed = await toolkit.tools.browser_exec.execute({
		sessionId: workSession.sessionId,
		code: "localStorage.setItem('workspace', 'work'); return true;",
	});
	expect(changed).toMatchObject({ ok: true, result: true });
	expect(
		await toolkit.tools.browser_close.execute({
			sessionId: workSession.sessionId,
		}),
	).toEqual({ ok: true });

	const personalSession = await toolkit.tools.browser_open.execute({
		authProfile: "personal",
		url: `${authServer.origin}/dashboard`,
	});
	if (!personalSession.ok) throw new Error(personalSession.error);
	const isolated = await toolkit.tools.browser_exec.execute({
		sessionId: personalSession.sessionId,
		code:
			"return { dashboard: document.querySelector('main')?.textContent, " +
			"workspace: localStorage.getItem('workspace') };",
	});
	expect(isolated).toMatchObject({
		ok: true,
		result: {
			dashboard: "Sign in required",
			workspace: null,
		},
	});
	expect(
		await toolkit.tools.browser_close.execute({
			sessionId: personalSession.sessionId,
		}),
	).toEqual({ ok: true });
	const disposed = await toolkit.dispose();
	if (disposed instanceof Error) throw disposed;
});
