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

Check whether the site has monkey-patched `window.fetch` or `XMLHttpRequest`. Patching is a caution signal, not an automatic blocker. Browser-context network requests are usually fine when the target endpoint is already called by the site with fetch/XHR and there is no strong bot-protection evidence.

```js
window.fetch.toString()
XMLHttpRequest.prototype.open.toString()
Object.getOwnPropertyDescriptor(window, 'fetch')
window.fetch.hasOwnProperty('prototype')
```

Important: ordinary app instrumentation and Libretto's own page-stability tracking can also wrap fetch/XHR. Treat browser fetch as risky only when the wrapper appears security-related, obfuscated, tied to bot-protection scripts, or likely to inspect call stacks. Some `Proxy` wrappers still stringify as `"[native code]"`, so these checks are only heuristics.

## Choosing a Data Capture Strategy

Use the review above to decide what is safe to prioritize. Every integration uses Playwright to control the browser. The question is what to lean on for data capture: direct browser fetch calls, passive network interception, or DOM extraction. In practice, many integrations mix approaches, but the site-security review should tell you which approach is safest to try first.

### Strategy A: Prioritize `page.evaluate(fetch(...))`

Make fetch calls directly from within the browser's JavaScript context. Use this only for endpoints the site already calls with fetch/XHR, not for page navigation or asset loads.

When to prioritize this:

- The target endpoint is normally called by the site with fetch/XHR
- No enterprise bot protection is detected
- No security-related fetch/XHR interception is detected, or the observed wrapper appears to be ordinary app instrumentation
- The API responses are parseable and useful
- You need data that requires many API calls (deep pagination, bulk queries) where driving the UI would be slow

Why: maximum control and efficiency. You call exactly the endpoints you want with the parameters you want, skip UI rendering, and get structured JSON back. On sites without aggressive detection, this is the fastest and cleanest approach.

Risk: fetch is the wrong primitive for page HTML and asset URLs; use Playwright navigation or DOM-driven loads for those. Sites can also monitor fetch call stacks and flag calls that do not originate from the site's bundled code.

You will still use Playwright for initial navigation, login/auth flows, cookie consent, and any UI interactions needed to establish session state before making fetch calls.

### Strategy B: Prioritize `page.on('response', ...)`

Listen to network responses that the browser naturally makes as you navigate. You do not make any extra requests. You capture data flowing through the site's own API calls.

When to prioritize this:

- Enterprise bot protection is detected
- Security-related fetch/XHR interception is detected
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
| No bot protection, fetch/XHR endpoint, no security-related interception | A (`page.evaluate(fetch)`) | Playwright for navigation/auth |
| No bot protection, harmless app instrumentation, fetch/XHR endpoint | A (`page.evaluate(fetch)`) | B (`page.on('response', ...)`) if requests fail |
| No bot protection, security-related interception or endpoint is not fetch/XHR | B (`page.on('response', ...)`) | Playwright for navigation; DOM extraction as fallback |
| Bot protection detected | B (`page.on('response', ...)`) | Playwright for navigation; cautious use of `page.evaluate(fetch)` only if needed |
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
