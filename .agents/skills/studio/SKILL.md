---
name: studio
description: >
    Receives CSS and HTML changes made in CSS Studio via MCP and applies them to source code.
argument-hint: "[wait for edits from CSS Studio]"
---

## Overview

CSS Studio is a visual editor that lets users edit CSS properties, HTML attributes, text content, and CSS variables on a live page. When connected via MCP, edits made in the panel are sent as structured data describing the change.

## On connect

Your **first** `css-studio` call must be `announce`:

```
css-studio({ action: "announce", capabilities: { subagent: true, backgroundSubagents: true, channelEvents: true, ask: true } })
```

- `subagent` — `true` if you can spawn subagents via a Task/Agent tool.
- `backgroundSubagents` — `true` **only** if your host's subagent spawn is *detached* so your turn continues immediately while the subagent runs (e.g. a `run_in_background: true` flag or equivalent capability). This is what enables parallel tasks. If you have such a capability, announce `true` and use it; if your spawn primitive blocks the parent, announce `false` or omit — tasks then route in **linear mode** and the hub queues them FIFO on this thread. That's correct behaviour — just no parallelism.
- `channelEvents` — `true` if your environment delivers `notifications/claude/channel` notifications.
- `ask` — `true` if you can block on a user answer.

Before entering the main loop, tell the user: *"Starting CSS Studio in parallel mode."* (you announced `backgroundSubagents: true`) or *"Starting CSS Studio in linear mode."* — then immediately make the first `get` call in the same turn.

## Main loop

**Immediately after `announce` (and the one-line status message), call `css-studio({ action: "get", timeout: 60000 })`.** Do not end the turn on a status message alone — the status line is not a tool call and the server cannot wake you without a pending `get`.

Then keep calling `get` in a loop forever:

- Empty responses are normal; just call `get` again.
- Never reduce the timeout below 60000.
- Never exit the loop except on user interrupt.
- Channel notifications (`notifications/claude/channel`) may arrive while a `get` is in flight — they unblock it early so the task is delivered without waiting out the poll. They do **not** replace the poll loop; the loop is mandatory.

## Tasks

Every task arrives with a `mode`. The task carries a `payload` object — the canonical, deduped data the subagent needs (or you need, in linear mode).

### `mode: "orchestrator"`

**Spawn one subagent per task — immediately, detached, with the shortest possible prompt.** When a task arrives, your very next action is the sub-agent spawn call. Do not write preamble, commentary, or a status line first — any delay is user-visible.

The task carries **`subagentPromptPath`**: an absolute path to a file the hub has already written containing the full subagent instructions + payload. Your Task prompt is a single short directive pointing at that path — **do not inline the header or the payload.** Inlining them costs 25–60 seconds of token generation per task (measured); the file-based form takes ~1–2 seconds.

**You MUST spawn in background mode.** You only get `mode: "orchestrator"` tasks because you announced `backgroundSubagents: true`. Spawning blocking would serialise every incoming task behind this one and defeat the independent-chat architecture.

**Spawn call shape:**

```
Task({
  subagent_type: "general-purpose",
  description: "CSS Studio task",
  prompt: "Read the file at " + task.subagentPromptPath + " and follow the instructions within. Do not narrate, summarise, or ask me questions — act on the instructions directly.",
  run_in_background: true,
})
```

Use your host's detached/background spawn capability (`run_in_background` or equivalent) — if it's available, use it. The prompt shape stays the same. The hub already marks the task as responding on dispatch; you don't need to emit `set-task-responding` yourself.

After the spawn call returns (it returns immediately — the subagent runs in parallel), **loop straight back to `css-studio({ action: "get" })`**. When the backgrounded subagent eventually finishes you'll see a completion notification — **ignore it.** All progress, accept/revert, and final status were delivered directly to the server by the subagent's curl POSTs; the hub needs nothing from you.

### `mode: "linear"`

Handle the task inline. The `payload` has everything:

1. Call `css-studio({ action: "claim-request", requestId: task.id })`.
2. Set a name: `css-studio({ action: "set-task-name", taskId: task.id, name: "…" })`.
3. Set the initial verb: `css-studio({ action: "set-task-responding", taskId: task.id, active: true, verb: "Reading source" })`.
4. Apply `payload.edits` in order, then implement `payload.prompt`. Target elements via `payload.attachments[edit.attachment]`. Read any images in `payload.imageAttachments[]` with your Read tool.
   - **Re-dispatched tasks:** if `payload.messages` already contains `role: "agent"` replies, the user sent follow-ups while you were working on an earlier turn. Respond to the newest user message(s) that came after your last agent reply — don't re-implement `payload.prompt` and don't re-apply edits you already applied.
5. **Every progress message must include `nextVerb`** describing what you're about to do next. Use fresh verbs — "Searching files", "Editing src/foo.tsx", "Running tests". **Format `text` as markdown** — backticks around filenames, selectors, CSS properties; `**bold**`; `-` lists.
   `css-studio({ action: "send-task-message", taskId: task.id, text: "Located the CTA in `src/cta.tsx`", nextVerb: "Editing styles" })`
   **Post at least once per minute.** The server reaps silent tasks as failed after ~15 minutes; if you're about to start a single long step (big grep, multi-file edit, test run), post a progress message first — the `nextVerb` alone keeps the task alive.
6. If you need the user to disambiguate: `css-studio({ action: "ask", taskId: task.id, question: "…", options: ["…"] })`. Blocks until they answer.
7. On success: `css-studio({ action: "complete-request", requestId: task.id, text: "summary" })`. For `kind: "variant"`, include `result: { html: "<css-studio-variants>…" }`.
8. If your source-code search for the target element fails, **before panicking** call `css-studio({ action: "describe-element", taskId: task.id })` to fetch live DOM info and retry.
9. Still unresolved? `css-studio({ action: "panic", taskId: task.id, reason: "element_not_found", element: "…" })`; clear with `calm` once fixed.
10. On failure: `css-studio({ action: "fail-request", requestId: task.id, error: "…" })`.

## Kinds

- `prompt` — free-form instruction. Interpret and implement on the target element(s).
- `variant` — generate 3-5 design variants. Return a `<css-studio-variants>` wrapper in `result.html` — DO NOT edit source.
  - Variant follow-ups (`Apply variant "X" to …`, `Generate more variants based on "X"`, `Retry applying variant "X" …`) arrive as plain prompt tasks with **no HTML in the text** — the chosen variant's name is the only reference. Fetch the variant bundle HTML with `css-studio({ action: "get", type: "variant", element: "<selector>" })` and pass it into the subagent's prompt so it can locate the chosen variant by `data-name`.
- `responsive` — add responsive styles (breakpoints / fluid values) for the element. The latest message's `viewport` is the current context.

## Change types (legacy `changes` array — panel edits not wrapped in a task)

Diff-style edits carry `from` and `to` as separate fields so the values can contain any characters (including arrows). Non-diff edits use `value`.

```json
{ "changes": [ { "type": "style", "path": "main > section.hero", "element": "div.card:nth-of-type(2)", "name": "background-color", "from": "#fff", "to": "#f0f0f0" } ] }
```

| type | element | name | payload |
| --- | --- | --- | --- |
| `style` | CSS selector | CSS property | `from`, `to` |
| `text` | CSS selector | — | `from`, `to` |
| `attr` | CSS selector | attribute name | `from`, `to` |
| `attr-delete` | CSS selector | attribute name | — |
| `attr-rename` | CSS selector | old attribute name | `value` = new name |
| `delete` | CSS selector | — | — |
| `tag` | CSS selector | — | `from`, `to` |
| `add-child` / `add-sibling` | CSS selector | — | `value` = new tag |
| `duplicate` | CSS selector | — | — |
| `token` | — | CSS variable | `from`, `to` |
| `token-rename` | — | old variable name | `value` = new name |
| `keyframe` | — | @keyframes name | `value` = full CSS |

For `text` edits, each Change targets **one block** — a single `<p>`, heading (`<h1>`–`<h6>`), `<li>`, `<blockquote>`, `<pre>`, etc. The `element` selector (with `:nth-of-type` when needed) is the block itself, NOT a container like `<article>` or wrapping `<div>`. `from` and `to` carry the **complete prior and new markdown of that block** — inline formatting appears as `**bold**`, `*italic*`, `\`code\``, `[label](url)`, `~~strike~~`; blocks as `# heading`, `- list`. The strings are NOT stripped to a slice, so the full surrounding text is available as context.

To apply: locate the source element matching `element` (use `from` to disambiguate if multiple match within the scope) and replace its inner text with `to`, **converting markdown formatting into whatever syntax the source uses** — HTML tags for .html/.jsx/.tsx, literal markdown for .md/.mdx, etc. Do NOT touch sibling blocks; they emit their own Changes if they changed.

A single inline-edit can produce **multiple `text` Changes** (one per modified block). Apply each independently in order. Special cases: `from: ""` means **insert** `to` as new text/block inside `element` (added paragraph, or loose text typed into a container). `to: ""` means **remove** the `from` text from `element` (deleted block) — `element` falls back to the editing root in this case, so use `from` as the find anchor. `precedingText` (when present on an insert or delete) carries the last few words of the preceding block in the original layout. Use it to locate the position in source: for inserts, place the new block immediately after the source block ending with those words; for deletes, remove the source block immediately after the one ending with those words (use `from` to confirm it's the right block).

Loose `changes` (no task wrapper) are keystroke edits. Apply them to source; don't claim a task.

## Rules

- **Every change is intentional.** Never skip or second-guess.
- Prefer minimal changes. Don't refactor. Don't add explanatory comments.
- Preserve existing code patterns (CSS modules, Tailwind, styled-components, inline styles).
- **If the `css-studio` tool returns an error**, tell the user what failed — don't leave them waiting silently.
- **Always complete or fail a linear task you've claimed** — never leave one `in-progress`, or the element stays visually locked in the panel.
- **You are the implementer. Speak in first person about your own work.** When the user accepts a variant or sends a follow-up, you apply it yourself — there is no separate "apply flow" or other agent to hand off to. Don't refer to yourself as "CSS Studio" and don't describe the work as being handed off to some other system. Just say what you're doing: "Applying to `src/foo.css`…".

## If MCP tools aren't available

> The CSS Studio MCP server is not installed. Install it with:
>
> ```
> npx cssstudio install
> ```
