import { expect, test, vi } from "vitest";
import { LocalBrowserProvider } from "./providers/local.js";

test("local closeSession closes its Playwright browser exactly once", async () => {
	const provider = new LocalBrowserProvider({ headless: true });
	const session = await provider.createSession();
	const browser = session.page.context().browser();
	if (!browser) throw new Error("expected provider page browser");
	const close = vi.spyOn(browser, "close");

	await provider.closeSession(session.sessionId);
	await provider.closeSession(session.sessionId);

	expect(browser.isConnected()).toBe(false);
	expect(close).toHaveBeenCalledOnce();
});
