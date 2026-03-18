---
name: glimpse-diff
description: Create a visual explanation of the current session diff as a single HTML page and show it in a native Glimpse window. Use when the user wants a visual walkthrough of local code changes instead of a plain text diff.
---

# Glimpse Diff

Use this skill when the user wants a visual explanation of the changes made in the current session.

## Workflow

1. Inspect the current session changes with `git status --short`, `git diff --stat`, `git diff --cached --stat`, and focused `git diff --unified=1 -- <files>` calls.
2. Write a Markdown explanation of the diff, usually in `/tmp/session-diff-report.md`.
3. Render that Markdown with `scripts/render-md.mjs`.
4. Open the generated page with Glimpse.

## Page Content

Include:

- A short title and summary of the session.
- File-level sections that explain what changed and why it matters.
- Short representative snippets instead of full patches.
- Risks, follow-up work, or open questions when they are relevant.

## CLI

The bundled CLI accepts a Markdown file path or stdin:

```bash
node scripts/render-md.mjs /tmp/session-diff-report.md \
  --diff-style split \
  --glimpse-repo /path/to/glimpse \
  --critique-repo /path/to/critique

cat /tmp/session-diff-report.md | node scripts/render-md.mjs \
  --title "Session diff" \
  --diff-style unified \
  --glimpse-repo /path/to/glimpse \
  --critique-repo /path/to/critique
```

Use `--no-open` when you only need the HTML file.

## Rendering

- `scripts/render-md.mjs` uses Critique's GitHub theme tokens when `--critique-repo` is available.
- `assets/critique-base.css` is copied from Critique's web renderer defaults in `cli/src/ansi-html.ts`.
- `assets/critique-markdown.css` provides the Markdown layout and host-level styling for the embedded diff renderer.
- Fenced `diff` blocks are rendered with `@pierre/diffs` from Diffs.com.
- Use `--diff-style split` for side-by-side panels capped at roughly `70ch` per side with wrapped lines.
- Use `--diff-style unified` for a single wrapped diff column capped at `70ch`.
- Diff blocks are capped to about `60%` of the viewport and scroll inside the page when they exceed that size.
- Without a Critique checkout, it falls back to an embedded copy of the same light theme values.
- Prefer Markdown sections with fenced `diff` blocks so the renderer can mount the real diff component.
- The default diff renderer is loaded from a versioned browser module URL. Use `--diffs-module-url` if you need to pin or replace that URL.

## Rules

- Do not use `pnpm cli` or `libretto open` for this workflow.
- Prefer the bundled `scripts/render-md.mjs` CLI for display and Git for diff inspection.
- If the diff is large, summarize repeated edits and show only the most informative snippets.
