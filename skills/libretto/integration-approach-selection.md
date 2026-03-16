# Integration Approach Selection Guide

**Purpose:** You are connected to a live Chrome session on a target website. Your job is to probe the site for bot detection measures, assess its security posture, and determine the best integration strategy for data extraction. All strategies use Playwright for browser control — the question is what to **prioritize** for data capture: in-browser fetch calls, passive network interception, or DOM extraction.

After completing the probes below, produce a **Site Assessment Summary** (see the output format at the end of this document).

---

## Probing the Site

Run these probes to build a picture of the site's detection posture. The examples below are starting points — use your judgment to investigate further based on what you find. Sites may use detection methods not listed here.

### Probe 1: Bot Protection Services & Security Signals

Look for signs that the site uses bot protection — either a third-party service or custom detection. There is no complete list of indicators; these are common examples.

**Cookies to look for (examples, not exhaustive):**

| Cookie Pattern | Associated Service |
|---|---|
| `_abck` | Akamai Bot Manager |
| `_px*` | PerimeterX (HUMAN) |
| `datadome` | DataDome |
| `cf_clearance` | Cloudflare |
| `_imp_apg_r_*` | Shape Security (F5) |
| `x-kpsdk-*` | Kasada |

But don't just check this list. Examine **all** cookies on the page — look for any cookies with obfuscated names, telemetry-related prefixes, or values that look like fingerprint hashes or encrypted tokens. Unknown security cookies are still security cookies.

**Global variables to check (examples):**

```js
// Known telemetry globals — but probe broadly, not just these
window._pxAppId   // PerimeterX
window.bmak       // Akamai
window.ddjskey    // DataDome
```

Also examine the page's scripts: look at the first `<script>` tags in the document source, check what external domains scripts load from (e.g., `*.akamaized.net`, `*.perimeterx.net`, `*.datadome.co`, `*.kasada.io`). Bot protection scripts are typically injected before any application code.

**Challenge pages:**

Check if the page is showing a challenge or interstitial instead of real content — "Checking your browser...", CAPTCHA iframes, blank pages with only a spinner. These indicate active bot protection that has already been triggered.

**General guidance:** The goal is to determine whether the site has bot protection and roughly how aggressive it is. Don't limit yourself to known signatures — look at the overall page behavior, unusual scripts, and anything that seems like security telemetry.

### Probe 2: Fetch / XHR Interception

Check whether the site has monkey-patched `window.fetch` or `XMLHttpRequest`. If it has, making your own fetch calls from `page.evaluate()` is risky because the site can inspect call stacks and detect calls that don't originate from its own code.

```js
// Check if fetch has been wrapped
window.fetch.toString()
// Native: "function fetch() { [native code] }"
// Patched: shows actual JavaScript source

// Check XMLHttpRequest
XMLHttpRequest.prototype.open.toString()

// Check property descriptors for tampering
Object.getOwnPropertyDescriptor(window, 'fetch')
// Normal: { value: ƒ, writable: true, enumerable: true, configurable: true }

// Proxy-based wrapping is harder to detect — native fetch has no prototype
window.fetch.hasOwnProperty('prototype')  // true may indicate a Proxy wrapper
```

**Important:** Some sites use `Proxy` to wrap fetch, which makes `toString()` still return `"[native code]"`. The prototype check is a heuristic, not definitive. If you see any sign of fetch interception, treat it as patched.

### Probe 3: Behavioral Monitoring

Look for signs that the site collects behavioral telemetry (mouse movements, keystrokes, scroll patterns). Heavy monitoring means you should use natural, human-like interaction patterns when driving the UI.

Things to check:
- Unusually large numbers of event listeners on `document` or `body` for `mousemove`, `keydown`, `scroll`, `touchstart`, `click`
- Known telemetry collection scripts
- `MutationObserver` instances watching the DOM for injected elements
- `requestAnimationFrame` loops that aren't tied to visible animations

If you're in a DevTools context, `getEventListeners(document)` is the quickest way to assess this. Otherwise, use heuristics — heavy behavioral monitoring usually correlates with enterprise bot protection from Probe 1.

---

## Choosing a Data Capture Strategy

Every integration uses Playwright to control the browser. The question is what to **prioritize** for getting data out. In practice, most integrations use a mix — you'll always need some Playwright interaction for navigation, login flows, cookie consent, etc. The strategies below describe what to lean on for the core data extraction.

### Strategy A: Prioritize `page.evaluate(fetch(...))`

Make fetch calls directly from within the browser's JavaScript context. The requests share the browser's TLS fingerprint, cookies, and origin — they look identical to requests the site's own JS would make.

**When to prioritize this:**
- No enterprise bot protection detected
- `fetch` is NOT monkey-patched
- You've identified API endpoints that return the data you need
- You need data that requires many API calls (deep pagination, bulk queries) where driving the UI would be slow

**Why:** Maximum control and efficiency. You call exactly the endpoints you want with the parameters you want, skip UI rendering, and get structured JSON back. On sites without aggressive detection, this is the fastest and cleanest approach.

**Risk:** If the site monitors fetch call stacks (Layer 4 detection), your calls will be flagged because they don't originate from the site's bundled code. This is uncommon but exists on high-security sites.

**You'll still use Playwright for:** Initial navigation, login/auth flows, cookie consent, and any UI interactions needed to establish session state before making fetch calls.

### Strategy B: Prioritize `page.on('response', ...)` (Passive Interception)

Listen to network responses that the browser naturally makes as you navigate. You don't make any extra requests — you capture data flowing through the site's own API calls.

**When to prioritize this:**
- Enterprise bot protection is detected
- `fetch` IS monkey-patched
- The site's normal UI flow triggers API calls that return the data you need
- You want to minimize detection risk as much as possible

**Why:** Zero additional network risk. The requests that happen are the ones the site's own code triggers. You're just listening. No anomalous call stacks, no unexpected request patterns, no extra fetch calls for monitoring to flag.

**Trade-off:** You only get data the page naturally loads. If you need page 50 of results, you have to click "next" 49 times via Playwright. You must set up listeners before the navigation that triggers the requests.

**You'll still use Playwright for:** All navigation and interaction to trigger the data-bearing API calls, plus any data that isn't available via intercepted responses (DOM-only content).

### Strategy C: Prioritize Playwright DOM Extraction

Extract data directly from the rendered page using selectors and `page.evaluate()` to read DOM content.

**When to prioritize this:**
- Data is server-rendered (no JSON API calls observed)
- The site doesn't expose the data you need via any API
- You need visual/layout information that only exists in the DOM
- As a fallback when Strategies A and B can't get specific pieces of data

**Why:** Works regardless of the site's API architecture. If the data is visible on the page, you can extract it.

**Trade-off:** Slower, fragile against DOM changes, and you only get data the UI renders (which may be less than what API responses contain).

---

## Decision Summary

| Site Profile | Primary Strategy | Supplement With |
|---|---|---|
| No bot protection, fetch not patched | **A** (`page.evaluate(fetch)`) | Playwright for navigation/auth |
| No bot protection, fetch IS patched | **B** (`page.on('response', ...)`) | Playwright for navigation; DOM extraction as fallback |
| Bot protection detected, fetch not patched | **B** (`page.on('response', ...)`) | Playwright for all navigation; cautious use of `page.evaluate(fetch)` only if needed |
| Bot protection detected, fetch IS patched | **B** (`page.on('response', ...)`) | Playwright for all navigation; DOM extraction as fallback |
| Server-rendered content (no API calls) | **C** (DOM extraction) | Playwright for all interaction |

---

## Output: Site Assessment Summary

After running the probes, produce a summary in this format. **Do NOT include a final strategy recommendation.** The security assessment determines what's *safe to use*, not what will *work*. Present this to the user for input, then use the safe approaches as you build the integration — adapting if specific endpoints don't work as expected (see "Handling Approach Mismatches" in SKILL.md).

```
## Site Assessment: [site URL]

### Bot Detection Profile
- **Enterprise bot protection:** [None detected / Detected — describe what you found (service name if identifiable, cookies, scripts, telemetry globals)]
- **Fetch/XHR interception:** [Native (not patched) / Patched — describe what you found]
- **Behavioral monitoring:** [None detected / Light / Heavy — describe indicators]
- **Challenge pages:** [None / Present — describe type (CAPTCHA, interstitial, etc.)]
- **Overall security posture:** [None / Low / Moderate / High / Very High]

### API Surface
- **API calls observed:** [List key endpoints discovered, or "None — content appears server-rendered"]
- **Data format:** [JSON / GraphQL / HTML fragments / Other — note if any responses use proprietary/binary formats]
- **Pagination:** [Describe how pagination works if applicable]

### Safe Approaches
- **`page.evaluate(fetch(...))`:** [Safe / Unsafe — brief rationale based on fetch patching, bot detection, etc.]
- **`page.on('response', ...)`:** [Viable / Not viable — note if response formats are parseable or proprietary]
- **DOM extraction:** [Always available as fallback]
- **Interaction notes:** [any behavioral precautions — natural mouse movements, typing delays, etc.]
```

**Important:** This assessment tells you which tools are in your toolbox. Present it to the user, get their input, then start building the integration using the safe approaches.
