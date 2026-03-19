# Site Security Review

Purpose: You are connected to a live Chrome session on a target website. Your job is to review the site's bot-detection and security posture before committing to an integration strategy. Probe for bot protection, fetch interception, and challenge flows, then use that review to decide which integration approaches are safe and which one to try first for this site.

After completing the probes below, produce a Site Assessment Summary (see the output format at the end of this document).

## Probing the Site

Run these probes to build a picture of the site's detection posture. The examples below are starting points. Use your judgment to investigate further based on what you find. Sites may use detection methods not listed here.

### Probe 1: Bot Protection Services and Security Signals

Look for signs that the site uses bot protection, either a third-party service or custom detection. There is no complete list of indicators. These are common examples.

Cookies to look for (examples, not exhaustive):

| Cookie Pattern | Associated Service |
| --- | --- |
| `_abck` | Akamai Bot Manager |
| `_px*` | PerimeterX (HUMAN) |
| `datadome` | DataDome |
| `cf_clearance` | Cloudflare |
| `_imp_apg_r_*` | Shape Security (F5) |
| `x-kpsdk-*` | Kasada |

But do not just check this list. Examine all cookies on the page. Look for cookies with obfuscated names, telemetry-related prefixes, or values that look like fingerprint hashes or encrypted tokens. Unknown security cookies are still security cookies.

Global variables to check (examples):

```js
window._pxAppId
window.bmak
window.ddjskey
```

Also examine the page's scripts. Look at the first `<script>` tags in the document source, and check what external domains scripts load from (for example `*.akamaized.net`, `*.perimeterx.net`, `*.datadome.co`, `*.kasada.io`). Bot protection scripts are typically injected before application code.

Challenge pages:

Check if the page is showing a challenge or interstitial instead of real content: "Checking your browser...", CAPTCHA iframes, or blank pages with only a spinner. These indicate active bot protection that has already been triggered.

General guidance: determine whether the site has bot protection and roughly how aggressive it is. Do not limit yourself to known signatures. Look at overall page behavior, unusual scripts, and anything that seems like security telemetry.

### Probe 2: Fetch and XHR Interception

Check whether the site has monkey-patched `window.fetch` or `XMLHttpRequest`. If it has, making your own fetch calls from `page.evaluate()` is risky because the site can inspect call stacks and detect calls that do not originate from its own code.

```js
window.fetch.toString()
XMLHttpRequest.prototype.open.toString()
Object.getOwnPropertyDescriptor(window, 'fetch')
window.fetch.hasOwnProperty('prototype')
```

Important: some sites use `Proxy` to wrap fetch, which makes `toString()` still return `"[native code]"`. The prototype check is a heuristic, not definitive. If you see any sign of fetch interception, treat it as patched.

## Choosing a Data Capture Strategy

Use the review above to decide what is safe to prioritize. Every integration uses Playwright to control the browser. The question is what to lean on for data capture: direct browser fetch calls, passive network interception, or DOM extraction. In practice, many integrations mix approaches, but the site-security review should tell you which approach is safest to try first.

### Strategy A: Prioritize `page.evaluate(fetch(...))`

Make fetch calls directly from within the browser's JavaScript context. The requests share the browser's TLS fingerprint, cookies, and origin. They look identical to requests the site's own JS would make.

When to prioritize this:

- No enterprise bot protection is detected
- `fetch` is not monkey-patched
- The API responses are parseable and useful
- You need data that requires many API calls (deep pagination, bulk queries) where driving the UI would be slow

Why: maximum control and efficiency. You call exactly the endpoints you want with the parameters you want, skip UI rendering, and get structured JSON back. On sites without aggressive detection, this is the fastest and cleanest approach.

Risk: if the site monitors fetch call stacks, your calls may be flagged because they do not originate from the site's bundled code. This is uncommon but exists on high-security sites.

You will still use Playwright for initial navigation, login/auth flows, cookie consent, and any UI interactions needed to establish session state before making fetch calls.

### Strategy B: Prioritize `page.on('response', ...)`

Listen to network responses that the browser naturally makes as you navigate. You do not make any extra requests. You capture data flowing through the site's own API calls.

When to prioritize this:

- Enterprise bot protection is detected
- `fetch` is monkey-patched
- The site's normal UI flow triggers API calls that return the data you need
- You want to minimize detection risk as much as possible

Why: zero additional network risk. The requests that happen are the ones the site's own code triggers. You are just listening. No anomalous call stacks, no unexpected request patterns, no extra fetch calls for monitoring to flag.

Trade-off: you only get data the page naturally loads. If you need page 50 of results, you have to click "next" 49 times via Playwright. You must set up listeners before the navigation that triggers the requests.

You will still use Playwright for all navigation and interaction to trigger the data-bearing API calls, plus any data that is not available via intercepted responses.

### Strategy C: Prioritize Playwright DOM Extraction

Extract data directly from the rendered page using selectors and `page.evaluate()` to read DOM content.

When to prioritize this:

- Data is server-rendered and no useful JSON API calls are observed
- The site does not expose the data you need via any API
- You need visual or layout information that only exists in the DOM
- As a fallback when Strategies A and B cannot get specific pieces of data

Why: it works regardless of the site's API architecture. If the data is visible on the page, you can extract it.

Trade-off: it is slower, more fragile against DOM changes, and you only get data the UI renders.

## Decision Summary

| Site Profile | Primary Strategy | Supplement With |
| --- | --- | --- |
| No bot protection, fetch not patched | A (`page.evaluate(fetch)`) | Playwright for navigation/auth |
| No bot protection, fetch is patched | B (`page.on('response', ...)`) | Playwright for navigation; DOM extraction as fallback |
| Bot protection detected, fetch not patched | B (`page.on('response', ...)`) | Playwright for navigation; cautious use of `page.evaluate(fetch)` only if needed |
| Bot protection detected, fetch is patched | B (`page.on('response', ...)`) | Playwright for navigation; DOM extraction as fallback |
| Server-rendered content (no API calls) | C (DOM extraction) | Playwright for all interaction |

## Output: Site Assessment Summary

After running the probes, produce a summary in this format. This assessment tells you what is safe to try first, not what will definitely work for every endpoint.

```text
## Site Assessment: [site URL]

### Bot Detection Profile
- Enterprise bot protection: [None detected / Detected — describe what you found]
- Fetch/XHR interception: [Native (not patched) / Patched — describe what you found]
- Challenge pages: [None / Present — describe type]
- Overall security posture: [None / Low / Moderate / High / Very High]

### API Surface
- API calls observed: [List key endpoints discovered, or "None — content appears server-rendered"]
- Data format: [JSON / GraphQL / HTML fragments / Other]
- Pagination: [Describe how pagination works if applicable]

### Safe Approaches
- `page.evaluate(fetch(...))`: [Safe / Unsafe — brief rationale]
- `page.on('response', ...)`: [Viable / Not viable — note if response formats are parseable]
- DOM extraction: [Always available as fallback]
- Interaction notes: [any behavioral precautions]
```
