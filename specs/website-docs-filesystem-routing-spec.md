## Problem overview

The docs site currently keeps its content inside the website app at `apps/website/src/docs/content/pages` and hard-codes the docs hierarchy in `apps/website/src/docs/content/index.ts`. Every new page requires a manual import, a manual manifest entry, and a manual placement in the sidebar order.

That setup makes docs authoring fragile and blocks a simpler content model where the filesystem defines the docs hierarchy. We want a repo-root `docs/` directory, folder-driven top-level docs pages, lightweight frontmatter for overrides, and build-time docs loading so the app no longer parses structure from a hand-written manifest.

## Solution overview

Move docs content to a repo-root `docs/` directory where each top-level folder becomes one docs route, such as `docs/getting-started/` becoming `/docs/getting-started`. Within each folder, `.mdx` files remain stitched into a single long-form page for that route, preserving the current hash-fragment navigation model.

Replace the hard-coded manifest with a Vite-generated virtual module that scans the docs filesystem, reads lightweight frontmatter, parses MDX to `mdast` at build time, and exports a typed docs tree to the app. Keep `safe-mdx` for rendering, but stop doing per-page `mdxParse(...)` work in the browser. Do not adopt `comptime.ts` in v1; Vite's plugin and virtual-module model is a better fit for filesystem scanning, watch mode, and generated content metadata in this app.

## Goals

- Store docs content under repo-root `docs/` instead of `apps/website/src/docs/content/pages`.
- Make top-level folders under `docs/` define top-level docs routes and sidebar groups.
- Remove the hard-coded docs manifest and derive docs hierarchy from the filesystem.
- Preserve the current grouped-page UX where one folder maps to one `/docs/<group>` route.
- Preserve current hash-fragment navigation behavior so existing `/docs/<group>#<heading>` links continue to work.
- Support lightweight frontmatter overrides for `title`, `order`, `draft`, and `devOnly`.
- Parse MDX structure at build time so the client consumes generated docs data instead of calling `mdxParse(...)` on startup.
- Keep the current docs rendering model based on `safe-mdx`, TOC generation, and section grouping.
- Make `/docs` resolve to the first visible docs group without a hard-coded default group id.

## Non-goals

- No migrations or backfills.
- No switch to page-per-file routes like `/docs/getting-started/quickstart` in v1.
- No redesign of docs styling, editorial layout, or MDX components.
- No replacement of `safe-mdx` with a different MDX runtime.
- No adoption of `comptime.ts` in v1.
- No SSR or static prerendering work for the docs site.
- No new metadata manifest format checked into the repo.

## Future work

- None yet. Add follow-up items here during implementation if new non-blocking work appears.

## Important files/docs/websites for implementation

- `apps/website/src/docs/content/index.ts` - current hard-coded docs manifest and docs-path helpers that should disappear or shrink to generated-data helpers.
- `apps/website/src/docs/DocsPage.tsx` - current docs bootstrap, runtime `mdxParse(...)` calls, heading-id generation, and grouped-page rendering.
- `apps/website/src/docs/components/toc-tree.ts` - TOC tree builder that currently assumes manifest groups and pages.
- `apps/website/src/docs/components/markdown.tsx` - docs layout and link behavior that must keep working with generated hrefs and hash navigation.
- `apps/website/src/App.tsx` - top-level route gate for `/docs/**`.
- `apps/website/src/routing.tsx` - SPA navigation rules for docs URLs and same-document hash behavior.
- `apps/website/vite.config.ts` - Vite entrypoint config; add the docs virtual module/plugin here.
- `apps/website/package.json` - website build and type-check commands used for verification.
- `apps/website/docs/index.html` - current docs HTML entrypoint; must keep working alongside the new repo-root `docs/` content directory.
- `apps/website/src/docs/content/pages/*.mdx` - current docs source files that will move to repo-root `docs/`.
- `docs/` - new repo-root docs content source directory introduced by this spec.
- `apps/website/node_modules/safe-mdx/README.md` - renderer and parser reference; relevant because the site already uses `SafeMdxRenderer` and `mdxParse`.
- `https://vite.dev/guide/features` - Vite glob/virtual-module behavior reference for filesystem-derived content.
- `https://comptime.js.org/` - compile-time evaluation reference considered for this change; useful for documenting why it is not the chosen v1 mechanism.

## Implementation

### Phase 1: Add a generated docs-content pipeline with frontmatter and build-time MDX parsing

Create a Vite-owned docs loader that can scan docs files, normalize folder/file metadata, and export a typed docs tree. Keep this phase focused on build-time content discovery and validation so the rendering layer can switch over cleanly in the next phase.

```ts
type DocsPageData = {
  id: string;
  label: string;
  content: string;
  mdast: Root;
  order: number | null;
};

type DocsGroupData = {
  id: string;
  label: string;
  path: `/docs/${string}`;
  order: number | null;
  pages: DocsPageData[];
};

export function buildDocsTree(files: DocsSourceFile[]): DocsGroupData[] {
  const grouped = groupFilesByTopLevelFolder(files);
  return sortGroupsAndPages(normalizeFrontmatter(grouped));
}
```

- [ ] Add a small docs-loader module under `apps/website/src/docs/content/` or `apps/website/src/docs/build/` that scans MDX files and groups them by top-level folder.
- [ ] Add a Vite virtual module such as `virtual:docs-content` in `apps/website/vite.config.ts` that exports the generated docs tree.
- [ ] Parse each MDX file at build time with the existing `safe-mdx/parse` parser and export both raw markdown and serialized `mdast`.
- [ ] Support lightweight frontmatter fields: `title?: string`, `order?: number`, `draft?: boolean`, `devOnly?: boolean`.
- [ ] Define folder conventions:
- [ ] each top-level folder under `docs/` becomes one docs route,
- [ ] `index.mdx` is optional and renders first when present,
- [ ] non-`index.mdx` files render after `index.mdx`, ordered by `order` then filename,
- [ ] folder label defaults to `index.mdx` frontmatter `title` when present, otherwise title-cased folder slug.
- [ ] Filter `draft` pages out in all builds and `devOnly` pages out in production builds.
- [ ] Add build-time validation for missing top-level folder names, duplicate group ids, duplicate page ids within a group, invalid frontmatter types, and pages missing an initial heading.
- [ ] Add temporary support for reading the current in-app docs directory when repo-root `docs/` is still empty so the app can switch incrementally.
- [ ] Verify `pnpm --filter libretto-website type-check` passes after the generated module types are wired in.
- [ ] Verify `pnpm --filter libretto-website build` succeeds with generated docs data and fails with a clear error when a docs file has invalid frontmatter or no heading.

### Phase 2: Switch the docs app to generated groups and preserve hash-link behavior

Replace the hard-coded manifest with the generated docs tree and remove browser-side `mdxParse(...)` work. Keep the existing route shape and anchor semantics so current `/docs/<group>#<heading>` links remain valid.

```ts
import { docsGroups, getDocsGroupByPath } from "virtual:docs-content";

export function DocsPage({ pathname }: { pathname?: string }) {
  const currentGroup = getDocsGroupByPath(pathname ?? window.location.pathname);
  const currentHeadingIds = buildHeadingIdMap(currentGroup.pages.map((page) => page.mdast));
  const tocItems = flattenTocTree({
    roots: buildDocsTocTree({ groups: docsGroups, currentGroupId: currentGroup.id }),
  });
  return <EditorialPage toc={tocItems} sections={buildSections(currentGroup)} />;
}
```

- [ ] Update `apps/website/src/docs/DocsPage.tsx` to consume generated groups/pages from the virtual module instead of `docsManifest`.
- [ ] Remove runtime `mdxParse(...)` calls from `DocsPage.tsx` and rely on build-generated `mdast`.
- [ ] Replace `defaultDocsGroupId` logic with "first visible group by sort order" logic exported from the generated module.
- [ ] Keep the current grouped-page rendering model where all files in a folder are stitched into one editorial page.
- [ ] Keep the current heading slug algorithm and duplicate-heading suffix behavior so existing hash links remain stable.
- [ ] Update `apps/website/src/docs/components/toc-tree.ts` types to accept generated group/page data without assuming a hand-written manifest module.
- [ ] Update docs link resolution so `#fragment` and `/docs/#fragment` still resolve within the current group when possible, and fall back to the generated cross-group heading lookup otherwise.
- [ ] Remove unused exports such as `docsManifest`, `docsPages`, and `docsMdxContent` from the current content module.
- [ ] Verify `pnpm --filter libretto-website type-check` passes after the docs app consumes generated content.
- [ ] Run `pnpm --filter libretto-website dev`, open `/docs/get-started#quick-start` and `/docs/library-api#workflow`, and confirm the correct group loads and scrolls to the requested section.
- [ ] Run `pnpm --filter libretto-website build` and confirm the built docs app still serves `/docs`, `/docs/<group>`, and hash-fragment links without route changes.

### Phase 3: Move docs content to repo-root `docs/` and delete the old in-app content source

Rehome the actual MDX content into the new folder-based docs source now that the app can read generated docs data. This phase makes the filesystem the source of truth and removes the last hard-coded content coupling from the website app.

```mdx
---
title: Getting Started
order: 1
---

## Introduction

Libretto is the AI toolkit for building and maintaining browser automations.
```

- [ ] Create a repo-root `docs/` directory and move existing docs groups into top-level folders such as `docs/get-started/`, `docs/cli-reference/`, and `docs/library-api/`.
- [ ] Add `index.mdx` where a folder needs explicit group-level `title` or `order` metadata; otherwise rely on the folder slug.
- [ ] Add lightweight frontmatter to migrated files where explicit `title`, `order`, `draft`, or `devOnly` behavior is needed.
- [ ] Move the dev-only UI kit page into the new structure and mark it with `devOnly: true` instead of keeping a runtime-only manifest special case.
- [ ] Remove `apps/website/src/docs/content/pages/` once the generated loader reads from repo-root `docs/`.
- [ ] Remove the temporary fallback to the old in-app docs directory from the loader.
- [ ] Keep page headings and file ordering aligned with current hash ids so existing deep links continue to work.
- [ ] Verify `pnpm --filter libretto-website build` succeeds with repo-root `docs/` as the only content source.
- [ ] Run `pnpm --filter libretto-website dev` and manually verify the sidebar order, page labels, and `devOnly` behavior in local development versus production build output.
