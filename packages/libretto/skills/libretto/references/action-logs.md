# Action Logs

- Stored at `.libretto/sessions/<session>/actions.jsonl`.
- One JSON object per line.
- Query the file directly with `jq`, for example `tail -n 20 .libretto/sessions/<session>/actions.jsonl | jq .`.
- This is an orientation log, not a replay trace.

## User vs Agent

- `agent` entries log the Playwright action Libretto observed, usually as `action` plus `selector`, and sometimes `value`, `url`, `duration`, or `error`.
- `user` entries log the browser DOM event Libretto captured, so they can include `bestSemanticSelector`, `targetSelector`, `ancestorSelectors`, `nearbyText`, `composedPath`, and `coordinates`.
- This is why agent entries usually describe what Playwright tried to do, while user entries can describe what element was actually interacted with in the page.

## Fields

- `ts`
  ISO timestamp.

- `pageId`
  Playwright target id for the page that produced the entry.

- `action`
  Logged action name, such as `click`, `dblclick`, `fill`, `goto`, or `reload`.

- `source`
  `user` for captured DOM events, `agent` for logged Playwright calls.

- `success`
  `true` if the action completed, `false` if Libretto logged a failure.

- `selector`
  Selector or locator hint for agent entries.

- `bestSemanticSelector`
  Canonical selector for user DOM events.

- `targetSelector`
  Selector for the raw DOM event target. Usually only present for user DOM events.

- `ancestorSelectors`
  Meaningful ancestor selector candidates for a user DOM event. Ordered from closest meaningful ancestor to farthest meaningful ancestor.

- `nearbyText`
  Short visible text near the event target, used as human context.

- `composedPath`
  Compact event-path summaries. Ordered from the raw event target to farthest ancestor.

- `coordinates`
  Rounded `clientX` and `clientY` for pointer-style events:

```json
{ "x": 42, "y": 24 }
```

- `value`
  Typed, selected, or submitted value when the action had one.

- `url`
  Navigation target or recorded page URL for navigation-style actions.

- `duration`
  Elapsed time in milliseconds when Libretto recorded it.

- `error`
  Error message when the action failed.

## User Example

```json
{
  "ts": "2026-03-20T22:34:56.123Z",
  "pageId": "A1B2C3D4E5F6",
  "action": "dblclick",
  "source": "user",
  "bestSemanticSelector": "button#saveBtn",
  "targetSelector": "span",
  "ancestorSelectors": ["button#saveBtn", "form[action=\"/save\"]"],
  "nearbyText": "Save",
  "composedPath": ["span [text=\"Save\"]", "button#saveBtn [text=\"Save\"]"],
  "coordinates": {
    "x": 42,
    "y": 24
  },
  "success": true
}
```

## Agent Example

```json
{
  "ts": "2026-03-20T22:35:10.456Z",
  "pageId": "A1B2C3D4E5F6",
  "action": "click",
  "source": "agent",
  "selector": "page.getByRole(\"button\", {\"name\":\"Save\"})",
  "duration": 187,
  "success": true
}
```
