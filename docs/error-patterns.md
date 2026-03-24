# Libretto Error Patterns and Solutions

This cookbook catalogs common errors encountered when building browser automations with Libretto, along with diagnosis steps and proven solutions.

## Table of Contents

1. [Selector Errors](#selector-errors)
2. [Session Management](#session-management)
3. [Authentication Issues](#authentication-issues)
4. [Network and Timing](#network-and-timing)
5. [Bot Detection](#bot-detection)
6. [Healthcare-Specific](#healthcare-specific)
7. [Performance Issues](#performance-issues)

---

## Selector Errors

### Error: "Selector not found" / "locator.click: Target closed"

**Symptoms:**
- `exec` fails with "selector not found"
- Page loaded but element missing
- Selector worked before, now fails

**Common Causes:**
1. Element hasn't loaded yet (timing)
2. Element is in an iframe
3. Multiple pages/popups opened
4. Selector is wrong or page changed

**Diagnosis:**

```bash
# Step 1: Capture current page state
npx libretto snapshot \
  --objective "Find the submit button that's failing" \
  --context "I'm trying to click '.submit-btn' but getting selector not found"

# Step 2: Check if multiple pages exist
npx libretto pages
```

**Solutions:**

```bash
# Solution 1: Add explicit wait
npx libretto exec "await page.waitForSelector('.submit-btn', { timeout: 10000 })"

# Solution 2: Use snapshot analysis for correct selector
# (snapshot will provide the actual selector from page)

# Solution 3: Check for iframes
npx libretto exec "
const frame = page.frameLocator('iframe[title=\"Form\"]');
await frame.locator('.submit-btn').click();
"

# Solution 4: Target specific page (if multiple)
npx libretto pages  # Get page ID
npx libretto exec --page <page-id> "await page.locator('.submit-btn').click()"
```

**Prevention:**
- Always use `page.waitForSelector()` before interacting
- Use `snapshot` to verify selectors before automation
- Check `pages` command at workflow start

---

### Error: "Element is not visible / not actionable"

**Symptoms:**
- Selector found but click/type fails
- "Element is outside viewport"
- "Element is covered by another element"

**Diagnosis:**

```bash
# Visualize where the element is
npx libretto exec --visualize "await page.locator('.hidden-btn').click()"

# Take screenshot to see actual state
npx libretto snapshot \
  --objective "Show the hidden button location" \
  --context "Button exists but claims it's not visible"
```

**Solutions:**

```bash
# Solution 1: Scroll into view
npx libretto exec "
await page.locator('.hidden-btn').scrollIntoViewIfNeeded();
await page.locator('.hidden-btn').click();
"

# Solution 2: Force click (when covered)
npx libretto exec "await page.locator('.hidden-btn').click({ force: true })"

# Solution 3: Wait for animation/transition
npx libretto exec "
await page.waitForFunction(() => {
  const el = document.querySelector('.hidden-btn');
  return el && getComputedStyle(el).opacity === '1';
});
await page.locator('.hidden-btn').click();
"
```

**Prevention:**
- Use `scrollIntoViewIfNeeded()` before interactions
- Wait for animations to complete
- Verify element is actually interactive (not disabled/hidden)

---

## Session Management

### Error: "Session does not exist" / "Cannot connect to browser"

**Symptoms:**
- `exec` or `snapshot` fails with "session does not exist"
- Browser crashed or was manually closed
- Stale session after system restart

**Diagnosis:**

```bash
# Check session state
cat .libretto/sessions/<session-name>/state.json

# Look for errors in logs
cat .libretto/sessions/<session-name>/logs.jsonl | tail -20
```

**Solutions:**

```bash
# Solution 1: Close stale session
npx libretto close --session <name>

# Solution 2: Start fresh
npx libretto open <url> --session <name>

# Solution 3: Clean up all sessions
rm -rf .libretto/sessions/*
```

**Prevention:**
- Always close sessions explicitly after workflows
- Use `try/finally` to ensure cleanup
- Monitor session health before commands

---

### Error: "Session already exists"

**Symptoms:**
- `open` fails because session name is in use
- Leftover session from previous run
- Multiple workflows trying to use same session

**Diagnosis:**

```bash
# List active sessions
ls .libretto/sessions/

# Check if session is actually active
npx libretto pages --session <name>
```

**Solutions:**

```bash
# Solution 1: Close existing session
npx libretto close --session <name>

# Solution 2: Use unique session names
npx libretto open <url> --session "workflow-$(date +%s)"

# Solution 3: Resume existing session
npx libretto resume --session <name>
```

**Prevention:**
- Use unique session names per workflow
- Clean up sessions in error handlers
- Check session state before opening

---

## Authentication Issues

### Error: "Login required" / "Unauthorized"

**Symptoms:**
- Redirected to login page unexpectedly
- API calls return 401/403
- Session expired mid-workflow

**Diagnosis:**

```bash
# Check if login page is showing
npx libretto snapshot \
  --objective "Is this a login page?" \
  --context "Expected dashboard but might have been logged out"

# Check saved profile
ls .libretto/profiles/<domain>.json
```

**Solutions:**

```bash
# Solution 1: Save auth profile after manual login
npx libretto open <url> --headed --session auth-setup
# (manually login in the browser)
npx libretto save <domain> --session auth-setup

# Solution 2: Re-authenticate programmatically
npx libretto exec "
if (await page.locator('#login-form').isVisible()) {
  await page.locator('#username').fill('${USER}');
  await page.locator('#password').fill('${PASS}');
  await page.locator('button[type=submit]').click();
  await page.waitForURL('**/dashboard');
}
"

# Solution 3: Use profile in new sessions
# (profiles are auto-loaded for matching domains)
```

**Prevention:**
- Save auth profiles for frequent sites
- Check for login redirects before operations
- Refresh auth proactively (e.g., every 30 min)

---

### Error: "Two-factor authentication required"

**Symptoms:**
- Login flow stops at 2FA prompt
- SMS/email code required
- Authenticator app prompt

**Diagnosis:**

```bash
# Open in headed mode to see 2FA prompt
npx libretto open <url> --headed --session 2fa-setup
```

**Solutions:**

```bash
# Solution 1: Use headed mode for interactive 2FA
npx libretto open <url> --headed --session auth
# (complete 2FA manually, then save profile)
npx libretto save <domain> --session auth

# Solution 2: Automate 2FA with TOTP
# (requires 2FA secret key)
npx libretto exec "
const totp = require('totp-generator');
const code = totp('${TOTP_SECRET}');
await page.locator('#2fa-code').fill(code);
await page.locator('button:has-text(\"Verify\")').click();
"

# Solution 3: Use backup codes
# (store backup codes securely)
```

**Prevention:**
- Save profiles AFTER 2FA completion
- Use "trust this device" options when available
- Keep TOTP secrets in secure env vars

---

## Network and Timing

### Error: "Navigation timeout" / "Page did not load"

**Symptoms:**
- `open` or navigation commands timeout
- Page loads partially then hangs
- Slow network or server

**Diagnosis:**

```bash
# Check network activity
npx libretto network --session <name>

# Look for hanging requests
npx libretto network --session <name> | grep "pending"
```

**Solutions:**

```bash
# Solution 1: Increase timeout
npx libretto open <url> --timeout 60000  # 60 seconds

# Solution 2: Wait for specific load state
npx libretto exec "
await page.goto('<url>', { waitUntil: 'domcontentloaded' });
"

# Solution 3: Ignore specific resources
npx libretto exec "
await page.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2}', route => route.abort());
await page.goto('<url>');
"
```

**Prevention:**
- Set reasonable timeouts (30-60s)
- Use `domcontentloaded` instead of `load` when possible
- Block unnecessary resources (images, fonts)

---

### Error: "Race condition" / "Element changed after snapshot"

**Symptoms:**
- Selector worked in snapshot but fails in execution
- Dynamic content replaced element
- React/Vue re-rendered component

**Diagnosis:**

```bash
# Compare snapshots before/after
npx libretto snapshot --objective "Current state" --context "Before action"
npx libretto exec "<action>"
npx libretto snapshot --objective "After action" --context "What changed"
```

**Solutions:**

```bash
# Solution 1: Wait for element stability
npx libretto exec "
const locator = page.locator('.dynamic-element');
await locator.waitFor({ state: 'attached' });
await page.waitForTimeout(500);  # Let re-renders settle
await locator.click();
"

# Solution 2: Use data attributes (more stable)
npx libretto exec "await page.locator('[data-testid=\"submit\"]').click()"

# Solution 3: Retry with backoff
# (see robust wrapper pattern in examples/openclaw-integration.md)
```

**Prevention:**
- Prefer data-* attributes over classes
- Wait for network idle before interactions
- Add small delays after navigation

---

## Bot Detection

### Error: "Access denied" / "Challenge page"

**Symptoms:**
- Cloudflare/reCAPTCHA challenge appears
- Site blocks headless browsers
- IP rate-limited

**Diagnosis:**

```bash
# Check if it's a challenge page
npx libretto snapshot \
  --objective "Is this a bot detection page?" \
  --context "Seeing challenge or access denied"

# Review security analysis
# (see docs/browser-automation-approaches.md for details)
```

**Solutions:**

```bash
# Solution 1: Use headed mode (reduces detection)
npx libretto open <url> --headed

# Solution 2: Human solve CAPTCHA in headed mode
npx libretto open <url> --headed --session captcha-solve
# (solve CAPTCHA manually)
npx libretto save <domain> --session captcha-solve

# Solution 3: Convert to API calls
# (see docs/browser-automation-approaches.md for network-first approach)
npx libretto network --session <name>
# Extract API endpoints and use direct HTTP
```

**Prevention:**
- Review site security before automation (see `skills/libretto/references/site-security-review.md`)
- Prefer network/API approach over UI automation
- Use realistic delays between actions
- Rotate sessions/profiles if needed

---

## Healthcare-Specific

### Error: "Patient not found" / "Invalid insurance ID"

**Symptoms:**
- Healthcare portal returns "patient not found"
- Insurance ID format rejected
- DOB validation fails

**Diagnosis:**

```bash
# Capture the error message
npx libretto snapshot \
  --objective "Extract the error message" \
  --context "Patient lookup failed"

# Verify input format
npx libretto exec "
return {
  dobFormat: await page.locator('#dob').getAttribute('placeholder'),
  insuranceFormat: await page.locator('#insurance-id').getAttribute('pattern')
}
"
```

**Solutions:**

```bash
# Solution 1: Match expected format
# DOB: Portal may expect MM/DD/YYYY, YYYY-MM-DD, or MM-DD-YYYY
npx libretto exec "
const dob = '1990-01-15';  // Your format
const formatted = new Date(dob).toLocaleDateString('en-US');
await page.locator('#dob').fill(formatted);
"

# Solution 2: Clear field before filling
# (prevents concatenation with placeholder)
npx libretto exec "
await page.locator('#insurance-id').clear();
await page.locator('#insurance-id').fill('${ID}');
"

# Solution 3: Use tab to trigger validation
npx libretto exec "
await page.locator('#insurance-id').fill('${ID}');
await page.keyboard.press('Tab');  # Trigger validation
await page.waitForTimeout(500);     # Wait for validation
"
```

**Prevention:**
- Validate input formats before automation
- Use portals' preferred date formats
- Clear fields before filling
- Trigger validation after input

---

### Error: "Session timeout" / "Portal locked"

**Symptoms:**
- Healthcare portal times out during automation
- "Session expired" message appears
- Portal locks account after failed attempts

**Diagnosis:**

```bash
# Check session timeout settings
npx libretto exec "
return {
  cookies: await page.context().cookies(),
  storage: await page.evaluate(() => ({
    local: {...localStorage},
    session: {...sessionStorage}
  }))
}
"
```

**Solutions:**

```bash
# Solution 1: Increase activity to prevent timeout
npx libretto exec "
setInterval(async () => {
  await page.evaluate(() => {
    // Keep session alive
    fetch('/api/heartbeat', { method: 'POST' });
  });
}, 60000);  // Every minute
"

# Solution 2: Save session mid-workflow
# (if timeout occurs, resume from saved state)
npx libretto save <domain> --session <name>

# Solution 3: Batch operations within timeout window
# (don't let workflow run longer than portal allows)
```

**Prevention:**
- Know portal timeout limits (usually 5-15 min)
- Batch operations within safe window
- Save progress periodically
- Test workflow timing before production

---

## Performance Issues

### Error: "Memory leak" / "Browser consuming too much RAM"

**Symptoms:**
- Browser memory grows over time
- System slows down
- Out of memory errors

**Diagnosis:**

```bash
# Check session size
du -sh .libretto/sessions/<name>/

# Monitor logs for large payloads
cat .libretto/sessions/<name>/logs.jsonl | grep "large"
```

**Solutions:**

```bash
# Solution 1: Close sessions after workflows
npx libretto close --session <name>

# Solution 2: Disable unnecessary features
npx libretto open <url> --session <name> --headless
# (headless uses less memory than headed)

# Solution 3: Limit network logging
# (if capturing huge responses)
npx libretto network --clear --session <name>
```

**Prevention:**
- Close sessions after each workflow
- Use headless mode in production
- Clear network/action logs periodically
- Don't keep sessions open indefinitely

---

### Error: "Automation too slow" / "Workflow takes too long"

**Symptoms:**
- Automation takes 10x longer than manual
- Workflow times out
- Users complaining about wait times

**Diagnosis:**

```bash
# Profile the workflow
time npx libretto run workflow.ts export_name

# Check for unnecessary waits
cat workflow.ts | grep "waitForTimeout"
```

**Solutions:**

```bash
# Solution 1: Convert to API calls (10-100x faster)
# (see docs/browser-automation-approaches.md)
npx libretto network --session <name>
# Extract API and use direct HTTP

# Solution 2: Remove unnecessary waits
# Replace arbitrary waits with event-based waiting
npx libretto exec "
// Bad: await page.waitForTimeout(5000);
// Good: await page.waitForLoadState('networkidle');
"

# Solution 3: Parallelize independent steps
# (run multiple sessions concurrently if needed)
```

**Prevention:**
- Profile workflows before production
- Prefer API calls over UI automation
- Use event-based waits, not timeouts
- Batch operations when possible

---

## General Debugging Strategy

When encountering any error:

1. **Capture state with `snapshot`**
   ```bash
   npx libretto snapshot \
     --objective "What's wrong here?" \
     --context "Expected X but got error Y"
   ```

2. **Check session health**
   ```bash
   npx libretto pages --session <name>
   cat .libretto/sessions/<name>/state.json
   ```

3. **Review logs**
   ```bash
   cat .libretto/sessions/<name>/logs.jsonl | tail -50
   ```

4. **Test in headed mode**
   ```bash
   npx libretto open <url> --headed --session debug
   # Watch what actually happens
   ```

5. **Simplify to MRE**
   - Remove non-essential steps
   - Test each operation independently
   - Isolate the failing command

6. **Ask the community**
   - [Libretto Discussions](https://github.com/saffron-health/libretto/discussions/categories/q-a)
   - Include: error message, MRE, logs, snapshot

---

## Contributing

Found a new error pattern? Please contribute:

1. Open discussion in [Q&A category](https://github.com/saffron-health/libretto/discussions/categories/q-a)
2. Share: error, diagnosis, solution that worked
3. We'll add it to this cookbook

---

**Maintained by:** Saffron Health team + community  
**Last updated:** 2026-03-23  
**License:** MIT
