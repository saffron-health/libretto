---
name: glimpse-changes
description: Create a visual explanation of the current session diff as a single HTML page and show it in a native Glimpse window. Use when the user wants a visual walkthrough of local code changes instead of a plain text diff.
metadata:
  author: tanishqkancharla
  version: "1.4.0"
---

# Glimpse Changes

Render a Markdown document in a native Glimpse window with syntax-highlighted code and rich diff rendering.

## Usage

Pipe markdown or pass it as an argument:

```bash
cat report.md | npx glimpse-changes
npx glimpse-changes "# Title\n\nContent"
```

The CLI opens a Glimpse window and exits immediately.

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

## Code blocks

Fenced code blocks with a language tag get syntax highlighting via `@pierre/diffs`:

````
```js
const x = 1;
```
````

## Typical workflow

1. Inspect changes with `git diff`, `git status`, etc.
2. Write a markdown explanation of the changes.
3. Pipe it to `npx glimpse-changes`.

Prefer command diffs (`!`git diff ...``) over pasting raw diff content — they always reflect the current working tree.
