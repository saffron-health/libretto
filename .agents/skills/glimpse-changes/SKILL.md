---
name: glimpse-changes
description: Create a visual explanation of the current session diff as a single HTML page and show it in a native Glimpse window. Use when the user wants a visual walkthrough of local code changes instead of a plain text diff.
metadata:
  author: tanishqkancharla
  version: "1.9.3"
---

# Glimpse Changes

Render a Markdown document in a native Glimpse window with syntax-highlighted code and rich diff rendering.

## Setup

cd ./  && npm install

## Default change-doc format

When creating a change-doc for Glimpse, use this structure by default:

1. A short, specific title.
2. A `## Summary` section with a concise bulleted list of the main changes.
3. One section per logical change, each with:
   - a clear section title
   - a short explanation of what changed and why
   - a `changes` block referencing the relevant files

Prefer grouping by logical concern instead of by file whenever possible.
Lead with rationale, then show the diff that supports it.

Template:

````md
# <Title>

## Summary

- Change 1
- Change 2
- Change 3

## <Section title>

What changed and why it matters.

```changes
path/to/file
```

## <Another section title>

More rationale for this group of changes.

```changes
path/to/other-file
path/to/related-file
```
````

Example:

````bash
cat <<'EOF' | node ./bin/glimpse-changes.js -
# Improve review flow messaging

## Summary
- clarify the default blocking review flow
- document when to use background mode
- add stronger guidance for user-driven review sessions

## Clarify the default review flow
Explain that agents should usually open the review, ask the user to inspect it,
and wait until the user says they are done.

```changes
packages/glimpse-changes/skills/glimpse-changes/SKILL.md
````

EOF

`````

Example with an ad-hoc fenced diff block:

````bash
cat <<'EOF' | node ./bin/glimpse-changes.js -
# New utility module

## Summary
- Added a helper for computing hashes

## Hash helper

```diff
+++ src/utils/hash.ts
+import { createHash } from "node:crypto";
+
+export function shortHash(input: string): string {
+  return createHash("sha256")
+    .update("example:" + input)
+    .digest("hex")
+    .slice(0, 12);
+}
`````

EOF

````

## Usage

Prefer piping markdown over stdin. This avoids shell-quoting issues.

```bash
cat report.md | node ./bin/glimpse-changes.js
cat report.md | node ./bin/glimpse-changes.js -

cat <<'EOF' | node ./bin/glimpse-changes.js -
# Title

Content
EOF
```

**Important: Do NOT escape backticks or dollar signs inside `<<'EOF'` heredocs.**
The single-quoted delimiter already prevents all shell expansion. Escaping
backticks (e.g. writing `\`` instead of `` ` ``) will break fence detection and
produce garbled output instead of rendered diffs.

You can still pass a single inline markdown argument for simple content:

```bash
node ./bin/glimpse-changes.js "# Title\n\nContent"
```

The CLI opens a Glimpse window and blocks until closed.

## Review workflow

This skill is not just for rendering a nice diff view — it can also collect
user review feedback.

- Use the default blocking mode when you only need to show the content and wait.
- In an interactive agent session, prefer a user-driven workflow: open the
  review, ask the user to review it, and wait for them to tell you when they
  are done.
- Use `--background` only when you specifically want an asynchronous workflow.
- In background mode, the CLI prints a review file path.
- That file contains `__PENDING__` until the window is closed.
- Once the user is done, the file contains either their review text or a
  no-review completion message.

Default interactive agent flow:

1. Render the report for the user.
2. Tell the user to review it in Glimpse.
3. Wait for the user to say they are finished.
4. Then continue the task.

Asynchronous/background flow (only when explicitly useful):

1. Render the report with `node ./bin/glimpse-changes.js --background -`.
2. Capture the printed review file path.
3. Poll that file until it is no longer `__PENDING__`.
4. Read the review text and continue the task.

### Background mode

Use `--background` to open the window without blocking:

```bash
node ./bin/glimpse-changes.js --background "# Title\n\nContent"
# prints: Glimpse window opened. Read /tmp/glimpse-review-<id>.txt for user feedback.
```

The output file contains `__PENDING__` until the user closes the window, then it contains the review text. Poll by reading the file and checking whether it still says `__PENDING__`. If the user closes the window without adding review comments, the file will contain a no-review completion message.

## Changes blocks

Use `changes` fenced code blocks to show file diffs. List file paths (relative
to the working directory) and the renderer resolves old/new contents from git
automatically. Diffs are expandable — users can click to reveal collapsed
context between hunks.

**Show full file diffs:**

````

```changes
src/db/queries.ts
src/db/schema.ts
```

```

**Focus on a line range** (still expandable, but scrolled to the range):

```

```changes
src/config.ts:42-50
```

`````

**Group related files** in one block for a stacked view, or **separate them**
with prose for a guided walkthrough:

````md
The query layer now batches reads:

```changes
src/db/queries.ts
```

I also updated the schema to match:

```changes
src/db/schema.ts
```
`````

The renderer handles new files (untracked), deleted files, and modified files.
If a file cannot be resolved, it shows an error inline.

## Inline diffs

For ad-hoc illustrations not tied to real files, use `diff` fenced blocks with
literal `+`/`-`/` ` prefixed lines:

````
```diff
-removed line
+added line
 context line
```
````

Every non-empty line must start with `+`, `-`, or a space.

## Code blocks

Fenced code blocks with a language tag get syntax highlighting via `@pierre/diffs`:

````
```js
const x = 1;
```
````
