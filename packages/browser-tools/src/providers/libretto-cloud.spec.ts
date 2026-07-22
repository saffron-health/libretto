import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { expect, test as base } from "vitest";
import { LibrettoCloudBrowserProvider } from "./libretto-cloud.js";

type RecordedRequest = {
	path: string;
	body: unknown;
}

const test = base.extend<{
	apiServer: { origin: string; requests: RecordedRequest[] };
}>({
	apiServer: async ({}, use) => {
		const requests: RecordedRequest[] = [];
		const server = createServer(async (request, response) => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) {
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			}
			const body = JSON.parse(Buffer.concat(chunks).toString()) as unknown;
			const path = request.url ?? "/";
			requests.push({ path, body });

			response.writeHead(200, { "content-type": "application/json" });
			if (path === "/v1/sessions/create") {
				response.end(
					JSON.stringify({
						json: {
							session_id: "cloud-session",
							status: "running",
							cdp_url: "ws://127.0.0.1:1234",
							live_view_url: null,
						},
					}),
				);
				return;
			}
			if (path === "/v1/recordings/get") {
				response.end(JSON.stringify({ json: { recording_url: null } }));
				return;
			}
			response.end("{}");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address() as AddressInfo;
		await use({
			origin: `http://127.0.0.1:${address.port}`,
			requests,
		});
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	},
});

test("creates a Libretto Cloud session with a persistent named profile", async ({
	apiServer,
}) => {
	const provider = new LibrettoCloudBrowserProvider({
		apiKey: "test-key",
		apiUrl: apiServer.origin,
	});

	const session = await provider.createSession({ authProfile: "work" });
	const closed = await provider.closeSession(session.sessionId);
	if (closed instanceof Error) throw closed;

	expect(provider.supportsAuthProfiles).toBe(true);
	expect(apiServer.requests).toEqual([
		{
			path: "/v1/sessions/create",
			body: {
				json: {
					timeout_seconds: 3_600,
					headless: true,
					profile_name: "work",
					profile_persist: true,
				},
			},
		},
		{
			path: "/v1/sessions/close",
			body: { json: { session_id: "cloud-session" } },
		},
		{
			path: "/v1/recordings/get",
			body: { json: { session_id: "cloud-session" } },
		},
	]);
});

test("creates an unprofiled Libretto Cloud session without profile fields", async ({
	apiServer,
}) => {
	const provider = new LibrettoCloudBrowserProvider({
		apiKey: "test-key",
		apiUrl: apiServer.origin,
	});

	const session = await provider.createSession();
	const closed = await provider.closeSession(session.sessionId);
	if (closed instanceof Error) throw closed;

	expect(apiServer.requests[0]).toEqual({
		path: "/v1/sessions/create",
		body: {
			json: {
				timeout_seconds: 3_600,
				headless: true,
			},
		},
	});
});

test.skipIf(!process.env.LIBRETTO_API_KEY?.trim())(
	"creates, connects to, and closes a Libretto Cloud browser",
	async () => {
		const provider = new LibrettoCloudBrowserProvider();
		const session = await provider.createSession();
		const browser = await chromium.connectOverCDP(session.cdpEndpoint);

		expect(browser.isConnected()).toBe(true);

		const closed = await provider.closeSession(session.sessionId);
		if (closed instanceof Error) throw closed;
	},
);
