import { afterEach, expect, test, vi } from "vitest";
import { BrowserUseBrowserProvider } from "./browser-use.js";

afterEach(() => {
	vi.unstubAllGlobals();
});

test("releases a Browser Use session when its CDP URL is invalid", async () => {
	const fetchMock = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(
			new Response(
				JSON.stringify({ id: "browser-use-1", cdpUrl: "not a URL" }),
				{ status: 200 },
			),
		)
		.mockResolvedValueOnce(new Response(null, { status: 200 }));
	vi.stubGlobal("fetch", fetchMock);
	const provider = new BrowserUseBrowserProvider({
		apiKey: "test-key",
		endpoint: "https://browser-use.test",
	});

	await expect(provider.createSession()).rejects.toBeInstanceOf(TypeError);

	expect(fetchMock).toHaveBeenLastCalledWith(
		"https://browser-use.test/browsers/browser-use-1",
		expect.objectContaining({
			method: "PATCH",
			body: JSON.stringify({ action: "stop" }),
		}),
	);
});

test.skipIf(!process.env.BROWSER_USE_API_KEY?.trim())(
	"creates, connects to, and closes a Browser Use browser",
	async () => {
		const provider = new BrowserUseBrowserProvider();
		const session = await provider.createSession();

		expect(session.page.context().browser()?.isConnected()).toBe(true);

		await provider.closeSession(session.sessionId);
	},
);
