# Website Authentication

Use this reference for workflows that need a logged-in website session: how to build and verify sign-in logic with `librettoAuthenticate`, and how auth profiles save signed-in state for later runs.

Build and verify working sign-in logic first. The sign-in code takes priority; an auth profile is added only after the sign-in logic is verified, never as a substitute for it.

## Generating Sign-In Logic

Workflows that need a logged-in session must contain working sign-in logic.

1. Open the site in headed mode and have the user log in manually so the selectors they use to sign in are recorded in the action logs.
2. Build the sign-in logic with `librettoAuthenticate`, driven by declared credentials such as `portal_username`, `portal_password`, and `portal_totp_secret`.
3. Tell the user to add those credential values to `.env`. You are blocked from validating until they do, because you cannot sign in without them.
4. Validate from a clean, signed-out browser with no auth profile present, so the `librettoAuthenticate` sign-in step actually runs. Validation that passes against an already-signed-in session or a warm profile does not prove the sign-in logic works; it is a false positive.

```typescript
import { librettoAuthenticate, workflow } from "libretto";

export default workflow("accountWorkflow", {
  credentials: ["portal_username", "portal_password"],
  async handler(ctx, input) {
    const { page } = ctx;

    await page.goto("https://app.example.com/dashboard");

    // Sign in when the session is not already authenticated.
    await librettoAuthenticate(ctx, {
      credentials: input.credentials,
      isSignedIn: async ({ page }) =>
        await page
          .getByRole("heading", { name: "Dashboard" })
          .isVisible()
          .catch(() => false),
      signIn: async ({ page }, credentials) => {
        await page.goto("https://app.example.com/login");
        await page.getByLabel("Email").fill(credentials.portal_username);
        await page.getByLabel("Password").fill(credentials.portal_password);
        await page.getByRole("button", { name: "Sign in" }).click();
        await page.getByRole("heading", { name: "Dashboard" }).waitFor();
      },
    });

    // Continue with the signed-in workflow steps.
  },
});
```

## Auth Profiles

Auth profiles save the signed-in browser state (cookies, localStorage, IndexedDB) so later runs can reuse a logged-in session instead of signing in from scratch. Implement an auth profile as part of the workflow, but the sign-in logic takes priority: do not add a profile until the `librettoAuthenticate` sign-in step has been verified from a signed-out browser with no profile present. If you add a profile first, validation passes on the saved session while the untested sign-in logic fails the first time that session expires.

Add an auth profile only after standalone sign-in is verified:

1. Save the current signed-in session as a named, site-scoped profile.
2. Reference it from the workflow with `authProfile`.

## Commands

```bash
# Save scoped auth state from the current Libretto session.
npx libretto save example-app --session login --sites app.example.com,auth.example.com

# List or delete hosted auth profile names.
npx libretto cloud profiles list
npx libretto cloud profiles delete example-app
```

## Workflow Definition

Use `authProfile` to reuse a named login profile: local runs load
`.libretto/profiles/<name>.json`, while hosted runs use provider-native profiles
that `libretto cloud deploy` registers by name without uploading local files.
Use `{ name, refresh: true }` when successful runs should persist updated
browser state back to the profile. Always pair profile use with
`librettoAuthenticate` so a stale or missing session signs in again before the
workflow continues.

### Example workflow

```typescript
import { librettoAuthenticate, workflow } from "libretto";

export default workflow("accountWorkflow", {
  // Added only after the signIn step is verified standalone.
  authProfile: {
    name: "example-account",
    refresh: true,
  },
  credentials: ["portal_username", "portal_password"],
  async handler(ctx, input) {
    const { page } = ctx;

    await page.goto("https://app.example.com/dashboard");

    await librettoAuthenticate(ctx, {
      credentials: input.credentials,
      isSignedIn: async ({ page }) =>
        await page
          .getByRole("heading", { name: "Dashboard" })
          .isVisible()
          .catch(() => false),
      signIn: async ({ page }, credentials) => {
        await page.goto("https://app.example.com/login");
        await page.getByLabel("Email").fill(credentials.portal_username);
        await page.getByLabel("Password").fill(credentials.portal_password);
        await page.getByRole("button", { name: "Sign in" }).click();
        await page.getByRole("heading", { name: "Dashboard" }).waitFor();
      },
    });

    // Continue with the signed-in workflow steps.
  },
});
```

## Notes

- Saving a profile captures cookies, localStorage, and IndexedDB only for the comma-separated `--sites` list.
- TOTP is supported; automate it instead of treating it as unsupported 2FA. Text/email verification codes are not supported yet.
- If the user explicitly wants to import from Chrome, ask which Chrome/profile
  to launch or attach to and get consent before attaching because disconnecting
  can close or relaunch that Chrome window. Chrome may require copying the
  selected profile to a temporary user-data directory before running
  `npx libretto import-chrome-profiles example-app --cdp-url http://127.0.0.1:9222 --sites app.example.com`.
