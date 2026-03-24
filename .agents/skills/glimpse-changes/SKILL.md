---
name: glimpse-changes
description: Create a visual explanation of the current session diff as a single HTML page and show it in a native Glimpse window. Use when the user wants a visual walkthrough of local code changes instead of a plain text diff.
metadata:
  author: tanishqkancharla
  version: "1.2.0"
---

# Glimpse Changes

Use this skill when the user wants a visual explanation of the changes made in the current session.

## Workflow

1. Inspect the current session changes with `git status --short`, `git diff --stat`, `git diff --cached --stat`, and focused `git diff --unified=5 -- <files>` calls.
2. Write a Markdown explanation of the diff, usually in `/tmp/session-diff-report.md`.
3. Run `npx glimpse-changes` to render and open the Glimpse window.

## Page Content

Include:

- A short title and summary of the session.
- File-level sections that explain what changed and why it matters.
- Command diffs using `!\`git diff -- path/to/file\`` to show changes inline.
- Short representative snippets instead of full patches. Diff hunks don't need to be full files.
- Order sections and hunks in the sequence that best explains the changes, not necessarily file order.
- Risks, follow-up work, or open questions when they are relevant.

## CLI

The CLI accepts either a single inline Markdown argument or stdin:

```bash
npx glimpse-changes "# Session diff\n\n- Summary"

cat /tmp/session-diff-report.md | npx glimpse-changes
```

The CLI detaches the Glimpse window into a background process and exits immediately.

## Rendering

- The renderer opens the page in Glimpse automatically with the `glimpseui` package.
- The renderer always uses Diffs.com's `@pierre/diffs` browser module for fenced `diff` blocks.
- The renderer defaults to split layout for fenced `diff` blocks.
- Fenced `diff` blocks are rendered with `@pierre/diffs` from Diffs.com.
- Diff blocks are capped to about `60%` of the viewport and scroll inside the page when they exceed that size.
- Prefer command diffs (`!\`git diff ...\``) over pasting raw diff content into fenced blocks.
- Command diffs execute at render time and always reflect the current state of the working tree.
- Command diffs **must** start with `git diff`; any other command will be rejected.
- Command diff output **must** contain valid unified diff hunks (with `diff --git` headers or `@@ ... @@` hunk headers); otherwise the renderer will throw an error.
- Fenced `diff` blocks with literal patch content are still supported as a fallback.

## Rules

- Do not use `pnpm cli` or `libretto open` for this workflow.
- Prefer `npx glimpse-changes` for display and Git for diff inspection.
- If the diff is large, summarize repeated edits and show only the most informative snippets.
- The CLI exits immediately after launching the Glimpse window in the background.
