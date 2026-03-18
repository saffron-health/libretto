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

## Security Preflight

Run this preflight before replaying captured requests. The goal is to separate what looks safe from what merely looks possible.

### Probe 1: Bot Protection and Challenge Signals

- Check cookies for bot-protection, telemetry, fingerprint, or signed security tokens.
- Check early-loading scripts and globals for third-party protection services or custom telemetry.
- Check whether the page is showing a challenge, interstitial, CAPTCHA, or other pre-app state.

### Probe 2: Fetch and XHR Interception

- Check whether `window.fetch` looks native or patched.
- Check whether `XMLHttpRequest.prototype.open` looks native or patched.
- Treat any sign of wrapping, proxying, or instrumentation as a reason to avoid direct browser `fetch` unless you have no safer option.

### Probe 3: Behavioral Monitoring

- Look for signs that the page is collecting interaction telemetry such as mouse movement, scroll, or keystroke patterns.
- If direct inspection is limited, infer behavioral monitoring from security scripts, challenge flows, or heavy bot-protection signals.
- If monitoring appears heavy, prefer passive capture and normal UI interaction over request replay.

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

## Decision Guide

| Site profile | Prefer | Why |
| --- | --- | --- |
| No clear bot protection and `fetch` looks native | Direct browser `fetch` | Fastest way to replay stable endpoints |
| `fetch` or XHR appears patched | Passive capture plus UI automation | Avoids suspicious call stacks and wrapped APIs |
| Bot protection or challenge flow is present | Passive capture plus UI automation | Lowest-risk way to learn the real request path |
| Responses are opaque, signed, or highly dynamic | Passive capture plus UI automation | Captures what the site actually sends |
| No usable API surface | DOM extraction | Browser automation is the only reliable path |

## Workflow

- Open the page in headed mode.
- Let the user perform the relevant workflow manually.
- Read the action log to understand the user-visible transition points.
- Read the network log after the relevant step.
- Run the security preflight before deciding whether to replay a request directly.
- Identify the smallest set of requests that actually carries the data or performs the action.
- Produce a short site assessment that distinguishes the safe approaches from the likely working approaches.
- Confirm with the user before replaying any request that could mutate data.
- If direct browser `fetch` looks safe, recreate a key request with `page.evaluate(() => fetch(...))`.
- If direct browser `fetch` is unsafe or does not work, keep using captured responses and UI automation for the triggering steps.
- Recreate the working request path in code outside Libretto.
- Verify the resulting workflow with `npx libretto run ...`.

## Commands

```bash
npx libretto open https://target.example.com --headed
npx libretto actions --source user --last 20
npx libretto network --last 20
npx libretto network --method POST --last 20
npx libretto network --filter 'referral|patient|search'
npx libretto exec "return await networkLog({ method: 'POST', last: 10 })"
npx libretto exec "return await actionLog({ source: 'user', last: 10 })"
npx libretto exec "return await page.evaluate(() => ({
  cookies: document.cookie.split(';').map((value) => value.trim()).filter(Boolean),
  scripts: [...document.scripts].slice(0, 20).map((script) => script.src || 'inline'),
  globals: {
    pxAppId: globalThis._pxAppId ?? null,
    bmak: globalThis.bmak ? 'present' : null,
    ddjskey: globalThis.ddjskey ?? null,
  },
}))"
npx libretto exec "return await page.evaluate(() => ({
  fetchSource: window.fetch.toString(),
  fetchDescriptor: (() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
    return descriptor
      ? {
          writable: descriptor.writable ?? null,
          enumerable: descriptor.enumerable ?? null,
          configurable: descriptor.configurable ?? null,
          hasGetter: typeof descriptor.get === 'function',
          hasSetter: typeof descriptor.set === 'function',
        }
      : null;
  })(),
  fetchHasPrototype: Object.prototype.hasOwnProperty.call(window.fetch, 'prototype'),
  xhrOpenSource: XMLHttpRequest.prototype.open.toString(),
}))"
npx libretto exec "
  return await page.evaluate(async () => {
    const resp = await fetch('/api/example', { method: 'GET' });
    return await resp.text();
  });
"
```

## Site Assessment Summary

Write the assessment before choosing a replay strategy. Keep it short and concrete.

```text
## Site Assessment: https://target.example.com

### Bot Detection Profile
- Enterprise bot protection: none detected | detected with evidence
- Fetch/XHR interception: native | patched with evidence
- Behavioral monitoring: none detected | light | heavy with evidence
- Challenge pages: none | present with evidence
- Overall security posture: none | low | moderate | high | very high

### API Surface
- API calls observed: key endpoints or "none observed"
- Data format: JSON | GraphQL | HTML fragments | other
- Pagination or sequencing: how the site advances through results or actions

### Safe Approaches
- page.evaluate(fetch(...)): safe | unsafe with rationale
- Passive capture from network logs: viable | not viable with rationale
- DOM extraction: fallback | primary path with rationale
- Interaction notes: any precautions for login, paging, or side effects
```

- Do not treat this assessment as the final strategy recommendation.
- Use it to narrow the safe options, then choose the working path with the user.

## Notes

- Start with the request that returns the data you need, not every request on the page.
- Prefer captured requests over guessing payload shape.
- Treat every replayed request, including `GET`, as potentially side-effectful until proven otherwise.
- `page.evaluate(() => fetch(...))` can recreate either fetch-based or XHR-based endpoints because you are issuing a new browser-context request.
- If a captured endpoint depends on signatures, rotating tokens, or opaque response formats, use Playwright to trigger it and capture the result instead of forcing direct replay.
- If the request format is opaque, highly dynamic, or heavily defended, fall back to UI automation for that part.
