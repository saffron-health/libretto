# Reverse Engineering Network Requests

Use this reference when the user wants to turn a browser workflow into direct network requests or decide whether direct request replay is the right extraction path.

This is the default approach for new integrations when the site exposes a clear and stable HTTP request path.

## When to Use This

- The page clearly loads or submits data through HTTP requests.
- The user can perform the workflow manually in a headed browser.
- Replaying the request is likely faster or more stable than reproducing every UI action.
- You need to decide whether direct browser `fetch` is safe enough to try.
- Fall back to browser automation when the request path is unclear, too dynamic, or blocked by anti-bot systems.

## Choosing the Capture Path

- Prefer direct browser `fetch` when the site exposes a stable endpoint, `window.fetch` appears unpatched, and the response returns the data or action result you need.
- Prefer passive capture plus UI automation when the site appears to wrap `fetch`, shows challenge pages or other bot-protection signals, or only exposes useful requests through normal page interaction.
- Fall back to DOM extraction when the page is server-rendered or the captured responses are not usable.

## Common Bot-Protection Signals

These are examples, not a complete checklist.

| Cookie Pattern | Common Association |
| --- | --- |
| `_abck` | Akamai Bot Manager |
| `_px*` | PerimeterX / HUMAN |
| `datadome` | DataDome |
| `cf_clearance` | Cloudflare |
| `_imp_apg_r_*` | Shape Security / F5 |
| `x-kpsdk-*` | Kasada |

- Unknown cookies can still be relevant if they look like telemetry, fingerprint, or signed security tokens.
- If cookies suggest bot protection, also check for challenge pages, early-loading security scripts, and wrapped `fetch` or XHR APIs before trying direct request replay.

## Workflow

- Open the page in headed mode.
- Let the user perform the relevant workflow manually.
- Read the network log after the relevant step.
- Identify the smallest set of requests that actually carries the data or performs the action.
- Before replaying a request, check whether direct browser `fetch` looks safe to try.
- Look for challenge pages, obvious bot-protection signals, or wrapped `fetch` and XHR APIs.
- Confirm with the user before replaying any request that could mutate data.
- If direct browser `fetch` looks safe, recreate a key request with `page.evaluate(() => fetch(...))`.
- If direct browser `fetch` is unsafe or does not work, keep using captured responses and UI automation for the triggering steps.
- Recreate the working request path in code outside Libretto.
- Verify the resulting workflow with `npx libretto run ...`.

## Commands

```bash
npx libretto open https://target.example.com --headed
npx libretto network --last 20
npx libretto network --method POST --last 20
npx libretto network --filter 'referral|patient|search'
npx libretto exec "return await networkLog({ method: 'POST', last: 10 })"
npx libretto exec "return await page.evaluate(() => ({ fetch: window.fetch.toString(), xhrOpen: XMLHttpRequest.prototype.open.toString() }))"
npx libretto exec "
  return await page.evaluate(async () => {
    const resp = await fetch('/api/example', { method: 'GET' });
    return await resp.text();
  });
"
```

## Notes

- Start with the request that returns the data you need, not every request on the page.
- Prefer captured requests over guessing payload shape.
- Treat every replayed request, including `GET`, as potentially side-effectful until proven otherwise.
- `page.evaluate(() => fetch(...))` can recreate either fetch-based or XHR-based endpoints because you are issuing a new browser-context request.
- If a captured endpoint depends on signatures, rotating tokens, or opaque response formats, use Playwright to trigger it and capture the result instead of forcing direct replay.
- If the request format is opaque, highly dynamic, or heavily defended, fall back to UI automation for that part.
