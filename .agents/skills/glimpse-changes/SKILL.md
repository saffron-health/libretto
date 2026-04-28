---
name: glimpse-changes
description: Create a visual explanation of the current session diff as a single HTML page and show it in a native Glimpse window. Use when the user wants a visual walkthrough of local code changes instead of a plain text diff.
metadata:
  author: tanishqkancharla
  version: "1.9.3"
---

# Glimpse Changes

Render a Markdown document in a native Glimpse window with syntax-highlighted code and rich diff rendering.

## Usage

Pipe markdown or pass it as an argument:

```bash
cat report.md | npx glimpse-changes
npx glimpse-changes "# Title\n\nContent"
```

Use `-` to force reading from stdin:

```bash
npx glimpse-changes -
```

### Options

- `--dry-run` — Render to file only, don't open Glimpse. Prints `{ dryRun: true, htmlPath, title }` as JSON.
- `--background` — Open the window in the background, print the output file path, and exit immediately. The output file contains `__PENDING__` until the user closes the window, then it contains the review output.

By default the CLI blocks until the window is closed and prints review output to stdout.

## Diff blocks

**Command diffs** — executed at render time, must start with `git diff`:

```
!`git diff -- path/to/file`
```

**Full unified diffs** — paste standard `git diff` output in a `diff` fenced block:

````
```diff
diff --git a/foo.txt b/foo.txt
--- a/foo.txt
+++ b/foo.txt
@@ -1,3 +1,3 @@
 context
-old
+new
```
````

**Inline diffs** — bare `+`/`-`/` ` prefixed lines in a `diff` fenced block:

````
```diff
-removed line
+added line
 context line
```
````

Every non-empty line must start with `+`, `-`, or a space. Invalid lines cause an error.

For added-file snippets, you can start with `+++ path/to/file.ext` and keep the remaining lines prefixed with `+`. The renderer will synthesize a proper new-file diff so the filename and syntax highlighting are preserved.

## Changes blocks

Use a `changes` fenced block to show expandable file-level diffs with full syntax highlighting. Each line is a file path, optionally with a line range to focus on:

````
```changes
src/cli/run.ts
src/utils/parse.ts:10-50
```
````

The renderer reads the file from the working tree and compares it against `HEAD` via `git show`, producing a rich interactive diff with collapsible hunks, add/remove stats, and syntax highlighting inferred from the file extension.

## Code blocks

Fenced code blocks with a language tag get syntax highlighting via `@pierre/diffs`:

````
```js
const x = 1;
```
````

## Markdown support

Beyond code and diff blocks, the renderer supports:

- Headings (`# H1` through `###### H6`) — H1–H3 appear in a table of contents
- Bold (`**text**`), italic (`*text*`), inline code (`` `code` ``), links (`[label](url)`)
- Blockquotes (`> text`)
- Unordered lists (`- item`)
- Ordered lists (`1. item`)
- Tables (GFM pipe syntax with alignment)
- Horizontal rules (`---`)
- Bare URLs are auto-linked

## Annotations (user review)

When the window is open, the user can select text and leave inline comments. On close, the CLI outputs all annotations in a structured format:

```
User review:

> selected text (file:line)

User's comment here
```

If the user closes without annotating, the output is:
`Window closed. User marked done without review.`

## Typical workflow

1. Inspect changes with `git diff`, `git status`, etc.
2. Write a markdown explanation of the changes.
3. Pipe it to `npx glimpse-changes`.

Prefer command diffs (`` !`git diff ...` ``) over pasting raw diff content — they always reflect the current working tree. Use `changes` blocks for interactive file-level diffs with expand/collapse.
