---
name: studio
description: >
    Receives CSS and HTML changes made in CSS Studio via MCP and applies them to source code.
argument-hint: "[wait for edits from CSS Studio]"
---

## Overview

CSS Studio is a visual editor that lets users edit CSS properties, HTML attributes, text content, and CSS variables on a live page. When connected via MCP, edits made in the panel are sent as structured data describing the change. You, the agent, implement these changes as you best see fit based on the existing document and project structure.

## Connect

The first time the `css-studio` tool is called, the MCP server will connect to the editor.

After the initial call, check whether your environment supports channel events (development channels). If it does:

-   **Channel events (preferred)**: Changes arrive as `notifications/claude/channel` events containing a JSON object with a `changes` array. Apply these changes immediately when received. Do NOT poll — just wait for events after the initial connection call.

If your environment does not support channel events:

-   **Polling (fallback)**: Call `css-studio` repeatedly to poll for the next batch of changes. **Always use a timeout of 60 seconds per call.** The tool will return empty when there are no pending changes — this is normal. **Never stop polling due to timeouts or empty responses, and never reduce the timeout duration.** Keep calling `css-studio` with a 60-second timeout indefinitely until the user explicitly ends the session. Blocking the chat is the success case for polling. By explicitly running this skill, users are opting this agent in to blocking input apart from returns from the MCP tool. DO NOT stop early just to update the user, NEVER stop early for any reason except the user manually interrupting. If the environment stops the run after N polls or T minutes, say so and tell the user to send /studio again to resume — though if it is in your capability, resume the poll in this instance.

## Changes

Changes made in the editor are received in an event-ordered array.

**Response format:**

```json
{
    "url": "http://localhost:3000/page",
    "viewport": { "width": 1440, "height": 900 },
    "changes": [
        {
            "type": "style",
            "path": "main > section.hero",
            "element": "div.card:nth-of-type(2)",
            "name": "background-color",
            "value": "#fff → #f0f0f0"
        }
    ]
}
```

`url` and `viewport` are included on the first response and whenever they change. Omitted otherwise — assume the same values for subsequent responses.

The response may also include a `messages` array — free-text messages sent by the user from the chat panel:

```json
{
    "changes": [],
    "messages": [
        { "text": "Can you make the header sticky?", "attachments": [{ "nodeId": 42, "label": "header.main" }] }
    ]
}
```

When `messages` is present, treat each message as a direct instruction. Use the `label` field of any attachments to identify the target element. Always respond to user messages by calling `css-studio({ action: "message", text: "..." })` so the user sees your reply in the chat panel.

### Change types

| type          | element      | name              | value       |
| ------------- | ------------ | ----------------- | ----------- |
| `style`       | CSS selector | CSS property name | `old → new` |
| `text`        | CSS selector | —                 | `old → new` |
| `attr`        | CSS selector | attribute name    | `old → new` |
| `attr-delete` | CSS selector | attribute name    | —           |
| `delete`      | CSS selector | —                 | —           |
| `tag`         | CSS selector | —                 | `old → new` |
| `add-child`   | CSS selector | —                 | tag name    |
| `add-sibling` | CSS selector | —                 | tag name    |
| `duplicate`   | CSS selector | —                 | —           |
| `token`       | —            | CSS variable name | `old → new` |
| `keyframe`    | —            | @keyframes name   | full CSS    |

The `element` field uses the most specific identifier available: `tag#id`, `tag[data-testid="x"]`, or `tag.class1.class2`.

## Workflow

1. Call `css-studio` once to establish the connection
2. If channels are supported, wait for channel events. If not, poll by calling `css-studio` again.
3. Apply received changes to the matching source files
4. If polling, repeat from step 2.

## Editing

### Element identification

Each change includes an `element` field and optionally a `path` field to help locate the right element in source code.

**`element`** — the target element, using the most specific identifier available:

-   `tag#id` — when the element has an id
-   `tag[data-testid="x"]` or `tag[data-id="x"]` — when a data attribute is present
-   `tag.class1.class2` — fallback to class names

When the element has same-tag siblings, `:nth-of-type(n)` is appended (e.g. `li.item:nth-of-type(3)`).

**`path`** — up to 3 ancestor selectors (excluding `html`/`body`) joined with `>`, providing structural context.

### Component information (React)

When the page uses React in development mode, changes include additional fields:

-   `component` — the React component name (e.g. `"Card"`, `"Header"`)
-   `source` — the source file and line number (e.g. `"src/components/Card.tsx:42"`)

When these fields are present, use them to locate the element in source code directly instead of searching by CSS selector. The `source` field points to the component definition, which is usually the file you need to edit.

#### Keyframe changes

A `keyframe` change contains the full updated CSS for a `@keyframes` rule. The `name` field is the rule name (e.g. `"pulse"`) and the `value` field contains the complete `@keyframes` block. Find the existing `@keyframes` rule in source code and replace it entirely with the provided CSS.

#### Tag changes

A `tag` change means the user changed an element's HTML tag (e.g. `div → section`). Find the element in source code and change its opening and closing tags. Preserve all attributes, classes, and children.

#### Adding elements

`add-child` and `add-sibling` changes mean the user added a new empty `<div>` as a child or sibling of the identified element.

#### Duplicating elements

A `duplicate` change means the user cloned an element. If the element is rendered from a data structure (e.g. an array passed to `.map()`), duplicate the corresponding entry in the data structure rather than duplicating markup.

#### Error reporting

If you cannot find an element in source code:

```
css-studio({ action: "panic", reason: "element_not_found", element: "div.card:nth-of-type(2)" })
```

Once resolved, clear the error:

```
css-studio({ action: "calm" })
```

#### Asking the user

When you need the user to disambiguate between options (e.g. which element is the one they edited, which file to apply changes to), use the `ask` action instead of panicking:

```
css-studio({ action: "ask", question: "Which element is the site header?", options: ["header.main-header", "div.nav-wrapper", "nav#primary-nav"] })
```

The call blocks until the user selects an option. The response contains their choice:

```json
{ "answer": "nav#primary-nav" }
```

Prefer `ask` over `panic` when the situation is resolvable by user input. Reserve `panic` for hard failures only.

#### Chat

CSS Studio has a chat panel where users can send you free-text messages (optionally with element attachments). You can also send messages back.

**Sending a message to the user:**

```
css-studio({ action: "message", text: "Done — I've updated the card layout." })
```

The message appears in the chat panel immediately.

**Indicating you're working:**

```
css-studio({ action: "responding" })
```

This shows a "responding" indicator in the chat panel. It clears automatically when you send a message. You can also clear it explicitly with `css-studio({ action: "responding", active: false })`.

**Waiting for a user message:**

```
css-studio({ action: "chat", timeout: 60000 })
```

This blocks until the user sends a message in the chat panel. The response contains:

```json
{ "text": "Can you make the header sticky?", "attachments": [{ "nodeId": 42, "label": "header.main" }] }
```

`attachments` is present when the user attached elements to their message (via the element prompt icon). Treat `text` as a direct instruction, using the attached element labels for context.

**Recommended pattern:** After applying changes, send a brief confirmation message. When waiting between poll cycles, you can optionally call `chat` alongside `get` to handle both style edits and chat messages. However, you cannot call both simultaneously — prefer `get` for the primary poll loop and check chat messages between edit batches.

### Implementing

Always implement based on the existing codebase styles. For instance, if an element is styled with Tailwind classes, don't add changes via the `style` tag. Add, remove or change existing Tailwind classes. Likewise if we have a CSS stylesheet and the convention is to make all styles there, this is where edits should be.

### Responsive styles

The `viewport` field tells you the screen size the user is editing at. Consider this when deciding where to apply style changes.

## Rules

-   **Every change is intentional.** Never skip, deduplicate, or second-guess a change — apply it as received.
-   Prefer minimal changes. Don't refactor surrounding code.
-   Don't add comments explaining the changes.
-   Preserve existing code patterns (CSS modules, Tailwind, styled-components, inline styles, etc).

## If MCP tools aren't available

If the `css-studio` tool is not found, tell the user:

> The CSS Studio MCP server is not installed. Install it by running:
>
> ```
> npx cssstudio install
> ```
