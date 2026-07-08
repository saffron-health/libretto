import { chromium, type Page } from "playwright";
import outdent from "outdent";
import { describe, expect, test as base } from "vitest";
import { snapshot } from "./capture-snapshot.js";
import { renderSnapshot } from "./render-snapshot.js";

type SnapshotRenderFixtures = {
	page: Page;
	expectSnapshot: (html: string, expected: string) => Promise<void>;
	expectScopedSnapshot: (
		html: string,
		refId: string,
		expected: string,
	) => Promise<void>;
};

const test = base.extend<SnapshotRenderFixtures>({
	page: async ({}, use) => {
		const browser = await chromium.launch({ headless: true });
		const page = await browser.newPage();
		await use(page);
		await page.close();
		await browser.close();
	},

	expectSnapshot: async ({ page }, use) => {
		await use(async (html: string, expected: string) => {
			await page.setContent(outdent.string(html));
			const raw = await snapshot(page);
			expect(renderSnapshot(raw)).toBe(outdent.string(expected));
		});
	},

	expectScopedSnapshot: async ({ page }, use) => {
		await use(async (html: string, refId: string, expected: string) => {
			await page.setContent(outdent.string(html));
			const raw = await snapshot(page);
			expect(renderSnapshot(raw, refId)).toBe(outdent.string(expected));
		});
	},
});

describe("renderSnapshot", () => {
	test("renders page, frame, semantic roles, heading text, refs, and no command hint", async ({
		expectSnapshot,
	}) => {
		await expectSnapshot(
			`
      <!doctype html>
      <html>
        <head><title>Product Docs</title></head>
        <body>
          <header>
            <nav aria-label="Primary">
              <a href="/docs">Docs</a>
            </nav>
          </header>
          <main>
            <h1>Welcome</h1>
            <button>Save</button>
            <input placeholder="Search docs" value="query" />
          </main>
        </body>
      </html>
    `,
			`
      <page title="Product Docs" url="about:blank">
      	<frame index="0" url="about:blank">
      		<document ref="l1">
      			Product Docs
      			<banner ref="l2">
      				...
      				Primary
      				<link ref="l4" href="/docs">Docs</link>
      			</banner>
      			<main ref="l5">
      				# Welcome
      				<button ref="l7">Save</button>
      				<textbox ref="l8" value="query" placeholder="Search docs">
      					Search docs
      					query
      				</textbox>
      			</main>
      		</document>
      	</frame>
      </page>
    `,
		);
	});

	test("scopes an already-captured tree by ref with numeric-suffix fallback", async ({
		expectScopedSnapshot,
	}) => {
		await expectScopedSnapshot(
			`
      <!doctype html>
      <title>Scoped Snapshot</title>
      <main>
        <button>Sibling</button>
        <button>Target</button>
      </main>
    `,
			"e4",
			`
      <page title="Scoped Snapshot" url="about:blank">
      	<frame index="0" url="about:blank">
      		<button ref="l4">Target</button>
      	</frame>
      </page>
    `,
		);
	});

	test("compacts low-value wrappers, clickable generics, single-child chains, and long child lists", async ({
		expectSnapshot,
	}) => {
		await expectSnapshot(
			`
      <!doctype html>
      <title>Compact Demo</title>
      <style>.card { cursor: pointer; }</style>
      <main>
        <div><section><p>Flattened wrapper text</p></section></div>
        <div class="card" onclick="void 0">Open card</div>
        <main aria-label="Outer">
          <nav aria-label="Navigation">
            <form aria-label="Lookup"><button>Submit chain</button></form>
          </nav>
        </main>
        <ul>
          <li><button>One</button></li>
          <li><button>Two</button></li>
          <li><button>Three</button></li>
          <li><button>Four</button></li>
          <li><button>Five</button></li>
          <li><button>Six</button></li>
        </ul>
      </main>
    `,
			`
      <page title="Compact Demo" url="about:blank">
      	<frame index="0" url="about:blank">
      		<document ref="l1">
      			Compact Demo
      			<main ref="l2">
      				Flattened wrapper text
      				<button ref="l3">Open card</button>
      				<main ref="l4">
      					Outer
      					...
      					Lookup
      					<button ref="l7">Submit chain</button>
      				</main>
      				<list>
      					<listitem>
      						<button ref="l9">One</button>
      					</listitem>
      					<listitem>
      						<button ref="l11">Two</button>
      					</listitem>
      					<listitem>
      						<button ref="l13">Three</button>
      					</listitem>
      					<listitem>
      						<button ref="l15">Four</button>
      					</listitem>
      					[Truncated 2 more elements. Interactive elements: <button ref="l17">Five</button>, <button ref="l19">Six</button>]
      				</list>
      			</main>
      		</document>
      	</frame>
      </page>
    `,
		);
	});
});
