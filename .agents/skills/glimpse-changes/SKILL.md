---
name: glimpse-changes
description: Create a visual explanation of the current session diff as a single HTML page and show it in a native Glimpse window. Use when the user wants a visual walkthrough of local code changes instead of a plain text diff.
metadata:
  author: tanishqkancharla
  version: "1.9.3"
---

# Glimpse Changes

Render a Markdown walkthrough in a native Glimpse window with syntax-highlighted code and rich diff rendering.

## Setup

```bash
cd ./ && npm install
```

## How to write a useful walkthrough

Use Glimpse to walk another developer through the code in the clearest order, not necessarily the order files appear in the diff.

Aim for a short, reviewable document:

1. Start with a specific title.
2. Add a brief summary of what changed.
3. Choose the walkthrough order that best explains the work.
4. Use prose between focused `changes` or `diff` blocks to explain intent, tradeoffs, and review risks.

Prefer a narrative that follows the user or developer flow: what someone sees or does, how the request/state/data moves through the system, then any supporting helpers, tests, docs, or cleanup. If another order is clearer, use that instead.

Write like a developer walking another developer through the change. Be direct and specific. Avoid dumping one large diff with a generic explanation. Prefer smaller, focused sections when they help the reader understand the code.

Good explanation style:

- "To keep the review focused on selected files, pass the filter through the renderer."
- "Add a fallback label so empty reviews still have a useful title."
- "The parser now keeps deleted files in the walkthrough so reviewers can see removals in context."

Template:

````md
# <Title>

## Summary

- <User-visible or developer-visible effect>
- <Main code path changed>
- <Important review note, risk, or edge case>

## <First thing a reviewer should understand>

Explain the intent and what to look for.

```changes
path/to/relevant-file.ts:20-70
```

## <Next part of the flow>

Explain how this connects to the previous step.

```changes
path/to/another-file.ts:80-130
```

## <Supporting detail, test, or edge case>

Explain why this support code matters.

```changes
path/to/test-file.test.ts:50-100
```
````

Example:

````bash
cat <<'EOF' | node ./bin/glimpse-changes.js -
# Improve review flow messaging

## Summary
- make the default review flow easier for agents to follow
- document when to wait for the user versus using background mode
- keep the walkthrough focused on the interaction reviewers care about

## Open the review and wait for the user

To make review sessions easier to follow, tell agents to open Glimpse, ask the
user to inspect it, and wait until the user says they are done.

```changes
packages/glimpse-changes/skills/glimpse-changes/SKILL.md:120-145
```
EOF
````

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
```

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
The single-quoted delimiter already prevents shell expansion. Escaping backticks
will break fence detection and produce garbled output instead of rendered diffs.

You can still pass a single inline markdown argument for simple content:

```bash
node ./bin/glimpse-changes.js "# Title\n\nContent"
```

The CLI opens a Glimpse window and blocks until closed.

## User review workflow

Glimpse can also collect review feedback from the user.

Default interactive flow:

1. Render the walkthrough for the user.
2. Tell the user to review it in Glimpse.
3. Wait for the user to say they are finished.
4. Then continue the task.

Use `--background` only when an asynchronous workflow is useful. In background
mode, the CLI prints a review file path. That file contains `__PENDING__` until
the window is closed, then contains either the user's review text or a no-review
completion message.

```bash
node ./bin/glimpse-changes.js --background "# Title\n\nContent"
# prints: Glimpse window opened. Read /tmp/glimpse-review-<id>.txt for user feedback.
```

## Changes blocks

Use `changes` fenced code blocks to show diffs for real files. List paths
relative to the working directory. The renderer resolves old and new contents
from git automatically.

Show full file diffs:

````md
```changes
src/db/queries.ts
src/db/schema.ts
```
````

Focus on a line range:

````md
```changes
src/config.ts:42-50
```
````

Use one block for related files, or separate blocks with prose for a guided
walkthrough:

````md
The query layer now batches reads before returning results:

```changes
src/db/queries.ts:30-95
```

The schema adds the index that makes those batched reads efficient:

```changes
src/db/schema.ts:12-28
```
````

The renderer handles new files, deleted files, and modified files. If a file
cannot be resolved, it shows an error inline.

## Inline diffs

For ad-hoc illustrations not tied to real files, use `diff` fenced blocks with
literal `+`/`-`/` ` prefixed lines:

````md
```diff
-removed line
+added line
 context line
```
````

You can also paste full unified diff output:

````md
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

## Code blocks

Fenced code blocks with a language tag are syntax highlighted:

````md
```js
const x = 1;
```
````
