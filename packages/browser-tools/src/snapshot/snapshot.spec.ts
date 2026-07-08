import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { snapshot } from "./capture-snapshot.js";
import { renderSnapshot } from "./render-snapshot.js";

describe("snapshot capture and render", () => {
	it("renders interactive elements with ref handles", async () => {
		const browser = await chromium.launch({ headless: true });
		const page = await browser.newPage();
		await page.setContent(
			"<main><h1>Welcome</h1><a href='/docs'>Docs</a><button>Save</button></main>",
		);

		const raw = await snapshot(page);
		const rendered = renderSnapshot(raw);

		expect(rendered).toMatch(/link ref="/);
		expect(rendered).toContain("Docs");
		expect(rendered).toMatch(/button ref="/);
		expect(rendered).toContain("Save");

		await browser.close();
	});
});
