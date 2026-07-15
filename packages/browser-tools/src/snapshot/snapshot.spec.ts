import { chromium, type Page } from "playwright";
import outdent from "outdent";
import { describe, expect, test as base } from "vitest";
import { snapshot } from "./capture-snapshot.js";
import type { Snapshot, SnapshotNode, SnapshotPrimitive } from "./capture-snapshot.js";
import { diffSnapshots, renderSnapshotDiff } from "./diff-snapshots.js";
import { renderSnapshot } from "./render-snapshot.js";

type SnapshotRenderFixtures = {
	page: Page;
	expectSnapshot: (html: string, expected: string) => Promise<void>;
	expectScopedSnapshot: (
		html: string,
		refId: string,
		expected: string,
	) => Promise<void>;
	expectSnapshotDiff: (
		beforeHtml: string,
		afterHtml: string,
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
			await page.setContent(html);
			const raw = await snapshot(page);
			expect(renderSnapshot(raw)).toBe(expected);
		});
	},

	expectScopedSnapshot: async ({ page }, use) => {
		await use(async (html: string, refId: string, expected: string) => {
			await page.setContent(html);
			const raw = await snapshot(page);
			expect(renderSnapshot(raw, refId)).toBe(expected);
		});
	},

	expectSnapshotDiff: async ({ page }, use) => {
		await use(async (beforeHtml: string, afterHtml: string, expected: string) => {
			await page.setContent(beforeHtml);
			const before = await snapshot(page);
			await page.setContent(afterHtml);
			const after = await snapshot(page);
			expect(renderSnapshotDiff(diffSnapshots(before, after))).toBe(expected);
		});
	},
});

describe("renderSnapshot", () => {
	test("renders page, frame, semantic roles, heading text, refs, and no command hint", async ({
		expectSnapshot,
	}) => {
		await expectSnapshot(
			outdent`
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
			outdent`
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
			outdent`
				<!doctype html>
				<title>Scoped Snapshot</title>
				<main>
					<button>Sibling</button>
					<button>Target</button>
				</main>
			`,
			"e4",
			outdent`
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
			outdent`
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
			outdent`
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

type SnapshotNodeInput = {
	nodeId: string;
	role: string;
	name?: string | null;
	ref?: string | null;
	value?: SnapshotPrimitive;
	description?: string | null;
	properties?: Record<string, SnapshotPrimitive>;
	attributes?: Record<string, string>;
	children?: SnapshotNode[];
	ignored?: boolean;
};

function makeNode(input: SnapshotNodeInput): SnapshotNode {
	const node: SnapshotNode = {
		nodeId: input.nodeId,
		ignored: input.ignored ?? false,
		role: input.role,
		name: input.name ?? null,
		value: input.value ?? null,
		description: input.description ?? null,
		properties: input.properties ?? {},
		attributes: input.attributes ?? {},
		children: input.children ?? [],
		ref: input.ref ?? null,
		subtreeSize: 1,
	};
	node.subtreeSize = countSubtree(node);
	return node;
}

function countSubtree(node: SnapshotNode): number {
	return 1 + node.children.reduce((sum, child) => sum + countSubtree(child), 0);
}

function makeSnapshot(
	roots: SnapshotNode[],
	options: { title?: string; url?: string } = {},
): Snapshot {
	const url = options.url ?? "about:blank";
	return {
		title: options.title ?? "Demo Page",
		url,
		frames: [
			{
				status: "ok",
				id: "main",
				index: 0,
				url,
				name: null,
				parentId: null,
				roots,
			},
		],
	};
}

describe("diffSnapshots", () => {
	test("returns no rendered diff for unchanged browser-rendered snapshots", async ({
		expectSnapshotDiff,
	}) => {
		const html = outdent`
			<!doctype html>
			<title>Stable Demo</title>
			<main><button>Stable</button></main>
		`;
		await expectSnapshotDiff(html, html, "");
	});

	test("tracks added, removed, and modified nodes under context ancestors", async ({
		expectSnapshotDiff,
	}) => {
		await expectSnapshotDiff(
			outdent`
				<!doctype html>
				<title>Diff Demo</title>
				<main>
					<h1>Tasks</h1>
					<button id="stable">Stable</button>
					<button id="save">Save</button>
					<button id="delete">Delete</button>
				</main>
			`,
			outdent`
				<!doctype html>
				<title>Diff Demo</title>
				<main>
					<h1>Tasks</h1>
					<button id="stable">Stable</button>
					<button id="save">Saved</button>
					<a id="docs" href="https://example.test/docs">Docs</a>
				</main>
			`,
			outdent`
				<page title="Diff Demo" url="about:blank">
					<frame index="0" url="about:blank">
						<document ref="l1">
							...
							<main ref="l2">
								...
				~ 				<button ref="l5">Saved</button>
				+ 				<link ref="l6" href="https://example.test/docs">Docs</link>
				- 				<button ref="l6">...</button>
							</main>
						</document>
					</frame>
				</page>
			`,
		);
	});

	test("suppresses href query and hash changes from browser-rendered links", async ({
		expectSnapshotDiff,
	}) => {
		await expectSnapshotDiff(
			outdent`
				<!doctype html>
				<title>Href Demo</title>
				<main><a id="docs" href="https://example.test/docs?utm=old#intro">Docs</a></main>
			`,
			outdent`
				<!doctype html>
				<title>Href Demo</title>
				<main><a id="docs" href="https://example.test/docs?utm=new#api">Docs</a></main>
			`,
			"",
		);
	});

	test("suppresses ref-only changes that browser HTML cannot express directly", () => {
		const before = makeSnapshot([
			makeNode({
				nodeId: "root",
				role: "RootWebArea",
				ref: "l1",
				children: [
					makeNode({
						nodeId: "docs",
						role: "link",
						name: "Docs",
						ref: "l2",
						attributes: { href: "https://example.test/docs" },
					}),
				],
			}),
		]);
		const after = makeSnapshot([
			makeNode({
				nodeId: "root",
				role: "RootWebArea",
				ref: "l10",
				children: [
					makeNode({
						nodeId: "docs",
						role: "link",
						name: "Docs",
						ref: "l20",
						attributes: { href: "https://example.test/docs" },
					}),
				],
			}),
		]);

		expect(renderSnapshotDiff(diffSnapshots(before, after))).toBe("");
	});
});
