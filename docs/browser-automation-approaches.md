# Browser Automation Approaches: Bot Detection, Data Capture, and Integration Strategies

This guide covers the different approaches to capturing data during browser automation, how bot detection works, how to identify what detection a site uses, and the trade-offs of each approach.

---

## Table of Contents

1. [How Bot Detection Works](#how-bot-detection-works)
2. [Identifying Bot Detection on a Target Site](#identifying-bot-detection-on-a-target-site)
3. [Integration Approaches](#integration-approaches)
   - [Approach 1: Regular Playwright Automation](#approach-1-regular-playwright-automation)
   - [Approach 2: Passive Network Interception (`page.onResponse`)](#approach-2-passive-network-interception-pageonresponse)
   - [Approach 3: In-Browser Fetch (`page.evaluate(() => fetch(...))`)](#approach-3-in-browser-fetch-pageevaluate--fetch)
   - [Approach 4: Direct HTTP from Node.js](#approach-4-direct-http-from-nodejs)
4. [Comparison Matrix](#comparison-matrix)
5. [Decision Guide](#decision-guide)
6. [Infrastructure and Operational Considerations](#infrastructure-and-operational-considerations)

---

## How Bot Detection Works

Bot detection systems operate at multiple layers. Understanding each layer helps you choose the right automation approach.

### Layer 1: Browser Fingerprinting

When a browser connects to a site, the site can inspect dozens of signals to determine if the browser is real or automated:

- **Navigator properties**: `navigator.webdriver` is set to `true` in automated browsers. Detection scripts check this immediately. Playwright sets this by default.
- **Browser plugin/extension footprint**: Real browsers have plugins like PDF viewers, font lists, and media codecs. Automated browsers often have none.
- **WebGL and Canvas fingerprinting**: The site renders invisible graphics and hashes the output. Headless browsers produce distinct rendering artifacts.
- **Screen and window dimensions**: Headless browsers often report unusual viewport sizes or have `window.outerWidth === 0`.
- **User-Agent consistency**: The User-Agent string must match the actual browser behavior. Claiming to be Chrome 120 but having Firefox-like JS engine behavior is a red flag.
- **CDP (Chrome DevTools Protocol) detection**: Some sites detect whether a CDP session is attached, which is how Playwright controls the browser.
- **Headless-specific object detection**: Automated browsers are missing objects and properties that exist in real headed Chrome. Detection scripts check for missing `chrome.runtime`, absent `Notification.permission` prompts, `navigator.permissions.query()` behaving differently, `window.chrome` being undefined or incomplete, and `navigator.plugins` being empty. In headless mode, `navigator.plugins.length === 0` and `navigator.languages` may be empty or contain only `"en"`, which are strong signals.
- **Iframe and sandbox detection**: Some sites check if their code is running inside an iframe or a sandboxed context by comparing `window.self !== window.top`, inspecting `window.frameElement`, or checking for restricted capabilities that sandboxing removes (e.g., `allow-scripts`, `allow-same-origin`). Bot protection scripts may also test for the presence of `document.hasFocus()` returning `false` (common in headless or background contexts) and whether `document.visibilityState` is `"visible"`.

### Layer 2: Behavioral Analysis

Beyond the browser itself, detection systems analyze how the user behaves:

- **Mouse movement patterns**: Real users have natural mouse trajectories with acceleration curves. Automated clicks happen without preceding mouse movement.
- **Typing cadence**: Real typing has variable delays between keystrokes. `page.fill()` inserts text instantly. `page.type()` with default settings uses uniform delays.
- **Scroll behavior**: Real users scroll with momentum and variable speed. Programmatic scrolling is instant or perfectly uniform.
- **Navigation timing**: Real users take time to read content before clicking. Bots navigate instantly between actions.
- **Interaction sequence**: Clicking a submit button without first clicking/focusing the input fields is suspicious.

### Layer 3: Network-Level Detection

The network request itself carries signals:

- **TLS fingerprint (JA3/JA4)**: Every HTTP client has a unique TLS handshake fingerprint based on the cipher suites, extensions, and elliptic curves it offers. Node.js `fetch`/`axios` have a completely different TLS fingerprint than Chrome. This is one of the strongest detection signals and is very hard to fake from outside a browser.
- **HTTP/2 fingerprint**: The SETTINGS frame, WINDOW_UPDATE behavior, and header ordering in HTTP/2 differ between browsers and HTTP libraries.
- **Header ordering and values**: Browsers send headers in a specific order (e.g., Chrome always sends `sec-ch-ua` headers). Node.js HTTP clients send headers in a different order or omit browser-specific headers entirely.
- **Cookie state**: Requests from a real browser session carry the full cookie jar. External HTTP requests must manually replicate cookies and may miss HttpOnly cookies or cookies set by JavaScript.
- **Referer and Origin**: Browser requests automatically include the correct `Referer` and `Origin` headers based on navigation state. External requests must fabricate these.

### Layer 4: API-Level Monitoring

Some sophisticated sites monitor the behavior of their own frontend code:

- **Fetch/XHR monkey-patching**: The site overrides `window.fetch` and/or `XMLHttpRequest.prototype.open` with wrapper functions that log every request, including its call stack. If a `fetch()` call originates from code that isn't part of the site's own bundle, it can be flagged.
  ```js
  // What the site does (runs very early, before your code):
  const _fetch = window.fetch;
  window.fetch = function(...args) {
    const stack = new Error().stack;
    if (!isExpectedCallSite(stack)) {
      reportAnomaly({ url: args[0], stack });
    }
    return _fetch.apply(this, args);
  };
  ```
- **Proxy-based interception**: Instead of replacing `fetch`, some sites use `Proxy` objects to wrap it. This is harder to detect because `fetch.toString()` still returns `"function fetch() { [native code] }"`.
- **Timing correlation**: The site knows which API calls its own code makes and when. If an endpoint is called at a time when the UI flow wouldn't trigger it, that's anomalous.
- **Request frequency and patterns**: The site's own code calls APIs in predictable patterns (e.g., pagination calls come in sequence, search calls follow debounce timings). Automation that deviates from these patterns can be flagged.

### Layer 5: Enterprise Bot Protection Services

Many sites don't build their own detection — they use third-party services:

| Service | Common Indicators |
|---|---|
| **Akamai Bot Manager** | Scripts from `*.akamaized.net`, `_abck` cookie, `sensor_data` payloads |
| **PerimeterX (HUMAN)** | Scripts loading from `*.perimeterx.net` or `*.px-cdn.net`, `_px` cookies |
| **DataDome** | Scripts from `*.datadome.co`, `datadome` cookie, interstitial challenge pages |
| **Cloudflare Bot Management** | `cf_clearance` cookie, challenge pages with "Checking your browser" message |
| **Shape Security (F5)** | Obfuscated inline scripts that collect telemetry, `_imp_apg_r_` style cookies |
| **Kasada** | Scripts from `*.kasada.io`, `x-kpsdk-*` headers |

These services combine many of the detection layers above into a single product. They are continuously updated to catch new automation techniques.

---

## Identifying Bot Detection on a Target Site

Before building your automation, audit the target site to understand what you're up against.

### Step 1: Check for Enterprise Bot Protection

Open the site in a normal browser with DevTools open (Network tab):

1. **Look at initial script loads**: Filter by JS in the Network tab. Look for domains associated with known bot protection services (listed in the table above).
2. **Check cookies**: In DevTools Application > Cookies, look for telltale cookies like `_abck`, `_px`, `datadome`, `cf_clearance`, etc.
3. **Watch for challenge pages**: Navigate around the site. If you ever see a "Checking your browser..." interstitial, the site uses active bot protection.
4. **Inspect the page source**: View source and look at the first `<script>` tags. Enterprise bot protection scripts are typically injected before any application code.

### Step 2: Check if Fetch/XHR is Patched

Open the browser console and run:

```js
// Check if fetch has been wrapped
window.fetch.toString()
// Native (safe):     "function fetch() { [native code] }"
// Patched (flagged): will show actual JavaScript source

// Check XMLHttpRequest
XMLHttpRequest.prototype.open.toString()
// Native: "function open() { [native code] }"

// Check for property descriptor tampering
Object.getOwnPropertyDescriptor(window, 'fetch')
// Native: { value: ƒ, writable: true, enumerable: true, configurable: true }
// Tampered: may have getters/setters or different configurability
```

**Important caveat**: If the site uses `Proxy` to wrap `fetch`, the `toString()` check will still return `"[native code]"`. To catch this:

```js
// Attempt to detect Proxy-based wrapping
try {
  // Proxied functions sometimes behave differently with certain operations
  const desc = Object.getOwnPropertyDescriptor(window, 'fetch');
  console.log('configurable:', desc.configurable);
  console.log('writable:', desc.writable);

  // Compare prototype chain
  console.log(window.fetch instanceof Function); // should be true
  console.log(window.fetch.prototype); // native fetch has no prototype
} catch (e) {
  console.log('fetch access is trapped');
}
```

### Step 3: Check for Behavioral Monitoring

Look for signs that the site collects behavioral telemetry:

```js
// Check if common event listeners are heavily registered
getEventListeners(document)
// In Chrome DevTools, this shows all listeners. An unusually large number
// of mousemove, keydown, scroll, and touchstart listeners suggests telemetry.

// Check for known telemetry globals
// PerimeterX:
typeof window._pxAppId !== 'undefined'
// Akamai:
typeof window.bmak !== 'undefined'
// DataDome:
typeof window.ddjskey !== 'undefined'
```

### Step 4: Test with Plain Playwright

The simplest test: run a basic Playwright script against the site and see what happens.

```typescript
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto('https://target-site.com');
// If you get a challenge page, CAPTCHA, or block — bot detection is active.
```

If plain Playwright gets blocked, you know the site has browser-level detection. If it works fine, the site likely only has basic or no detection.

---

## Integration Approaches

### Approach 1: Regular Playwright Automation

Standard Playwright usage — navigate pages, click elements, fill forms, read DOM content using selectors and `page.evaluate()`.

```typescript
// Navigate and interact
await page.goto('https://example.com/search');
await page.fill('#query', 'search term');
await page.click('#submit');
await page.waitForSelector('.results');

// Extract data from the DOM
const results = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.result-item')).map(el => ({
    title: el.querySelector('h2')?.textContent,
    price: el.querySelector('.price')?.textContent,
  }));
});
```

**Pros:**
- Simplest approach — uses Playwright as intended
- No need to understand the site's API structure
- Works with any site regardless of how data is rendered (server-side, client-side, or hybrid)
- Data extraction is visual/DOM-based, which maps naturally to what a user sees
- Easy to debug with `headless: false` and Playwright's trace viewer
- Integrates directly with Libretto's step-based workflow, recovery, and extraction features

**Cons:**
- **Moderate bot detection risk**: Playwright sets `navigator.webdriver = true` and has other detectable fingerprints out of the box
- Slower than API-based approaches — requires full page rendering
- Fragile against DOM changes — selectors break when the site updates its markup
- Harder to get structured data — you're scraping rendered HTML rather than clean API responses
- Cannot access data that isn't rendered in the DOM (e.g., API responses with fields the UI doesn't display)

**Bot detection risk: MODERATE**
Plain Playwright is detectable by browser fingerprinting (Layer 1). Sites with any enterprise bot protection will likely flag it. Sites without active detection won't notice.

**Mitigation:** Use `playwright-extra` with the stealth plugin to patch common fingerprint leaks, or use Playwright with a persistent browser context that looks more like a real browser profile.

---

### Approach 2: Passive Network Interception (`page.onResponse`)

Listen to network responses that the browser naturally makes as you navigate. You don't make any extra requests — you just capture the data flowing through.

```typescript
const capturedData: any[] = [];

page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('/api/search/results')) {
    const json = await response.json();
    capturedData.push(json);
  }
});

// Trigger the data load by interacting with the UI normally
await page.goto('https://example.com/search?q=term');
await page.waitForSelector('.results');
// capturedData now has the raw API response
```

**Pros:**
- **Zero additional bot detection risk from network requests** — you're not making any extra calls. The requests that happen are the ones the site's own code triggers.
- Gets clean, structured API data (JSON) rather than scraped DOM content
- API responses often contain more data than the UI displays (hidden fields, IDs, metadata)
- Not fragile against DOM changes — the API contract tends to be more stable than CSS selectors
- Works with Playwright's existing page context — no additional setup

**Cons:**
- **You only get data that the page naturally loads** — you must trigger the right UI flow to cause the requests you need. If the data requires clicking through 5 pages, you must automate all 5 page navigations.
- Still requires Playwright browser automation to drive the page, so you still have the browser fingerprinting risk from Approach 1 for the navigation itself
- Timing can be tricky — you must set up the listener before the navigation that triggers the request
- Responses may be paginated or partial — the site's UI might lazy-load data, requiring you to trigger scrolling or "load more" interactions
- If the site uses GraphQL or batched API calls, parsing the right data out of responses requires understanding the API structure
- Some responses may be encrypted or obfuscated by bot protection services

**Bot detection risk: LOW**
The network requests themselves carry zero additional risk since they originate from the site's own JavaScript. The only risk is from the browser automation layer needed to drive the UI (same as Approach 1). No extra fetch calls means no anomalous network patterns for API-level monitoring to flag.

---

### Approach 3: In-Browser Fetch (`page.evaluate(() => fetch(...))`)

Execute fetch calls from within the browser page's JavaScript context. The requests originate from the browser process itself with all the right credentials and fingerprints.

```typescript
const data = await page.evaluate(async () => {
  const res = await fetch('/api/search/results?q=term&page=2', {
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  return res.json();
});
```

**Pros:**
- **Requests come from the real browser** — same TLS fingerprint, same cookies, same origin, same HTTP/2 settings. From the server's perspective, it looks identical to a request the site's own JS would make.
- Full control over which endpoints you call and with what parameters — no need to trigger UI flows
- Can call endpoints the UI doesn't naturally hit (e.g., fetch page 50 of results without clicking "next" 49 times)
- Gets clean, structured API data (JSON)
- Faster than driving the UI — skip page rendering and go straight to the data
- No need to understand DOM structure or deal with selector fragility

**Cons:**
- **Requires understanding the site's API** — you need to know the endpoint URLs, required headers, authentication tokens, request body format, etc. This requires reverse-engineering the site's network traffic first.
- **Vulnerable to fetch/XHR monkey-patching** (Layer 4) — if the site wraps `window.fetch`, your calls will be intercepted and may be flagged because the call stack won't match the site's expected code paths
- Still requires a Playwright browser to be running (for the execution context), so you have the browser fingerprinting overhead from Approach 1
- API endpoints can change without notice (no public contract)
- Must handle authentication tokens/CSRF tokens that the site's own code normally manages
- If the site uses dynamic or signed request parameters, you may need to reverse-engineer the signing logic

**Bot detection risk: LOW to MODERATE**
The network-level risk is very low — the requests are genuine browser requests. The risk comes from:
1. Browser fingerprinting (same as Approach 1)
2. Fetch/XHR monkey-patching detecting unexpected call stacks (Layer 4)
3. Timing and pattern analysis if your requests don't match normal UI flow patterns

Most sites do **not** implement Layer 4 monitoring. This approach is effectively undetectable on the vast majority of sites. Only sites with enterprise-grade bot protection from services like PerimeterX or Shape Security are likely to catch this.

---

### Approach 4: Direct HTTP from Node.js

Make HTTP requests directly from Node.js using `fetch`, `axios`, `got`, or similar libraries. No browser involved.

```typescript
import axios from 'axios';

const response = await axios.get('https://example.com/api/search/results', {
  params: { q: 'term', page: 1 },
  headers: {
    'User-Agent': 'Mozilla/5.0 ...',
    'Cookie': 'session=abc123; ...',
  },
});
const data = response.data;
```

**Pros:**
- **Fastest approach** — no browser overhead, no page rendering, minimal memory usage
- Simple code — just HTTP requests, no browser lifecycle management
- Easy to parallelize — make many concurrent requests without launching multiple browser instances
- Lowest resource consumption — suitable for high-volume data collection

**Cons:**
- **Highest bot detection risk by far** — this is what bot detection systems are primarily designed to catch
- **TLS fingerprint is completely wrong** — Node.js has a fundamentally different TLS fingerprint than any browser. This is the #1 detection signal and is extremely difficult to fake. Even with libraries like `got` or custom TLS settings, matching Chrome's exact fingerprint is a cat-and-mouse game.
- **No cookies unless manually managed** — you must extract cookies from a browser session and replicate them, including HttpOnly cookies you can't access from JS
- **No browser-specific headers** — `sec-ch-ua`, `sec-fetch-*`, and other headers that browsers add automatically must be manually fabricated and kept up to date
- **No JavaScript execution** — if the site requires JS to set cookies, generate tokens, or solve challenges, you can't do it
- **CSRF/auth tokens** — must be manually extracted and refreshed
- **Breaks easily** — API changes, new security headers, or updated bot protection will break your requests with no fallback

**Bot detection risk: VERY HIGH**
Detectable at nearly every layer. TLS fingerprinting alone will catch this on any site with even basic bot protection. This approach only works reliably against sites with no bot detection whatsoever.

---

## Comparison Matrix

| Criteria | Regular Playwright | `page.onResponse` | `page.evaluate(fetch)` | Direct Node.js HTTP |
|---|---|---|---|---|
| **Bot detection risk** | Moderate | Low | Low-Moderate | Very High |
| **Browser fingerprint risk** | Yes | Yes | Yes | N/A (worse: wrong fingerprint) |
| **Network fingerprint risk** | None (browser requests) | None (browser requests) | None (browser requests) | Very High |
| **API monitoring risk** | None | None | Low (fetch patching) | N/A |
| **Data quality** | DOM-dependent | Structured JSON | Structured JSON | Structured JSON |
| **Setup complexity** | Low | Medium | Medium-High | Low-Medium |
| **API reverse-engineering needed** | No | Partial (identify endpoints) | Yes (full) | Yes (full) |
| **Control over data fetching** | Low | Low | High | High |
| **Speed** | Slow | Medium | Medium-Fast | Fast |
| **Resource usage** | High | High | High | Low |
| **Resilience to DOM changes** | Low | High | High | High |
| **Resilience to API changes** | Medium | Low | Low | Low |

---

## Decision Guide

**Use Regular Playwright (Approach 1) when:**
- The data you need is visible in the DOM and straightforward to extract with selectors
- The site doesn't have aggressive bot protection, or you're using stealth plugins
- You want the simplest implementation that integrates with Libretto's recovery and extraction features
- The data is rendered server-side and doesn't come from a separate API call

**Use `page.onResponse` (Approach 2) when:**
- The site loads data via API calls during normal navigation (most modern SPAs)
- You want structured JSON data without reverse-engineering the full API
- Minimizing detection risk is important
- You're already navigating through the UI and want to passively capture data along the way

**Use `page.evaluate(fetch)` (Approach 3) when:**
- You need data from API endpoints that the UI doesn't naturally trigger (e.g., deep pagination, bulk exports)
- You've verified the site doesn't monkey-patch `fetch` (or you can work around it)
- You want maximum control over which data you fetch and when
- You've already reverse-engineered the relevant API endpoints

**Use Direct Node.js HTTP (Approach 4) when:**
- The target site has zero bot detection
- Speed and resource efficiency are the primary concerns
- You're hitting a public/documented API (not scraping a website)
- You need to make thousands of concurrent requests

**Hybrid approach (recommended for most cases):**
Combine Approach 1 + Approach 2. Use regular Playwright to navigate and interact with the site (handling popups, login flows, etc. with Libretto's recovery features), and passively intercept API responses with `page.onResponse` to capture structured data. This gives you the reliability of browser-based navigation with the data quality of API responses, at minimal detection risk.

---

## Infrastructure and Operational Considerations

The sections above cover the front-end detection and integration strategies for automating within a browser. The following are infrastructure-level concerns that affect reliability and longevity of automations at scale. These are secondary to the core approach but become important in production.

### IP Reputation and Rate Limiting

Bot detection doesn't stop at the browser — the IP address you connect from is one of the first things evaluated:

- **Datacenter vs. residential IPs**: Cloud provider IP ranges (AWS, GCP, Azure) are well-known and flagged by most bot protection services. Requests from these ranges face higher scrutiny or outright blocking regardless of how good the browser fingerprint is.
- **Rate limiting**: Even without bot detection, sites enforce per-IP request limits. Hitting the same site too frequently from one IP triggers throttling or temporary bans.
- **Geo-mismatch**: If your IP geolocates to Virginia but your browser reports `America/Los_Angeles` timezone and `en-US` locale consistent with California, that inconsistency is a signal.
- **Proxy rotation**: Residential proxy services provide IP addresses from real ISPs, making requests appear to originate from normal households. Rotating proxies distribute requests across many IPs to avoid rate limits. This is the standard production approach for high-volume automation.

### CAPTCHA and Challenge Handling

When bot detection triggers, sites typically respond with a challenge rather than an outright block:

- **reCAPTCHA v2**: The checkbox or image-selection challenge. Can sometimes be bypassed in automated browsers if the risk score is low enough (it evaluates browser fingerprint and behavior before showing the challenge).
- **reCAPTCHA v3**: Invisible — returns a score (0.0 to 1.0) with no user interaction. The site decides what to do with the score. A well-fingerprinted browser with natural behavior scores higher.
- **hCaptcha**: Similar to reCAPTCHA v2 but used by sites that want an alternative to Google. Cloudflare uses it as a fallback.
- **Cloudflare Turnstile**: Non-interactive challenge that evaluates browser signals. Replaces traditional CAPTCHAs on many Cloudflare-protected sites.
- In practice, if a CAPTCHA is triggered during an automation, it usually means the browser fingerprint or behavior failed earlier checks. Fixing the root cause (better stealth, slower interaction patterns) is more effective than trying to solve CAPTCHAs programmatically.

### Detection and Recovery Patterns

Understanding how blocks manifest helps you build resilient automations:

- **Soft blocks**: The site returns degraded results (fewer items, missing data, slower responses) without an explicit error. These are hard to detect — you may not realize you're getting incomplete data.
- **Hard blocks**: HTTP 403, CAPTCHA pages, "Access Denied" responses, or redirects to a challenge page. These are obvious but require recovery logic.
- **Cookie consent and GDPR banners**: Not bot detection per se, but a common obstacle. These overlays block interactions with the underlying page. Automations need to detect and dismiss them before proceeding.
- **Fingerprint testing**: Before deploying an automation, test your browser's fingerprint against public detection test sites (e.g., `bot.sannysoft.com`, `browserleaks.com`) to identify what signals you're leaking.

### Anti-Detection Maintenance

Bot detection is adversarial — both sides are continuously updating:

- Enterprise bot protection services (Akamai, PerimeterX, etc.) push updates frequently. An automation that works today may break next week with no changes on your end.
- Browser updates change fingerprints. When Chrome updates, your automation's User-Agent, feature set, and expected behavior profile all change.
- Stealth patches need to keep pace with detection updates. Relying on community-maintained stealth plugins means you're dependent on their update cadence.
- Budget time for ongoing maintenance of any automation that targets a site with active bot protection.
