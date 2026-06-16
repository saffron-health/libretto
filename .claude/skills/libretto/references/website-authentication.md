# Website Authentication

Use this reference for workflows that need a logged-in website session: how to build and verify sign-in logic with `librettoAuthenticate`, and how auth profiles save signed-in state for later runs.

Build and verify working sign-in logic first. The sign-in code takes priority; an auth profile is added only after the sign-in logic is verified, never as a substitute for it.

## Generating Sign-In Logic

Workflows that need a logged-in session must contain working sign-in logic. Follow these steps whenever you build a workflow that has to sign in to a website.

1. Open the site in headed mode and have the user log in manually so the selectors they use to sign in are recorded in the action logs.
2. Read `.libretto/sessions/<session>/actions.jsonl` to determine what secrets (credentials) are needed to be input by the user
3. Create a set of blank `LIBRETTO_CLOUD_<secret_name>` values in the .env and tell the user to fill them in. Examples are username, password, totp_secret
4. Before you open a new browser to perform validation, use the .env libretto credentials that were created along with the `librettoAuthenticate` function to add sign in functionality to the script.
5. Then when you do your workflow validatation, it must be from a clean, signed-out browser with no auth profile present, so the `librettoAuthenticate` sign-in step actually runs. Validation that passes against an already-signed-in session or a warm profile does not prove the sign-in logic works; it is a false positive.

If the user asks you to wait while they log in during exploration, treat that manual login as discovery only; still build `librettoAuthenticate` sign-in code unless the user explicitly requests a manual-login workflow.

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
      isSignedIn: async () =>
        await page
          .getByRole("heading", { name: "Dashboard" })
          .isVisible()
          .catch(() => false),
      signIn: async (_ctx, credentials) => {
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

### TOTP two-factor codes

Libretto has no special TOTP mode. For sites with TOTP-based two-factor auth, declare a TOTP secret credential such as `portal_totp_secret`, have the user put their TOTP secret in `.env`, and generate the current code from that secret inside `signIn` (for example with an `otplib`/`otpauth` helper) before submitting it. Text and email verification codes are not supported.

## Auth Profiles

Auth profiles save the signed-in browser state (cookies, localStorage, IndexedDB) so later runs can reuse a logged-in session instead of signing in from scratch. The sign-in logic still takes priority: do not add a profile until the `librettoAuthenticate` sign-in step has been verified from a signed-out browser with no profile present. If you add a profile first, validation passes on the saved session while the untested sign-in logic fails the first time that session expires.

A profile only holds whatever a signed-in session wrote into it, so it does nothing until a run has signed in at least once. With `refresh: true`, a successful run writes updated browser state back to the profile, so a fresh sign-in repairs an expired one. Local runs load `.libretto/profiles/<name>.json`; hosted runs use the provider-native profile with the same name.

Add the profile to the workflow you already verified:

```typescript
export default workflow("accountWorkflow", {
  // Added only after the signIn step above is verified standalone.
  authProfile: { name: "example-account", refresh: true },
  credentials: ["portal_username", "portal_password"],
  // ...same handler and librettoAuthenticate call as above.
});
```

## Commands

```bash
# Save the current signed-in session as a named, site-scoped profile.
npx libretto save example-app --session login --sites app.example.com,auth.example.com

# List or delete hosted auth profile names.
npx libretto cloud profiles list
npx libretto cloud profiles delete example-app
```

`save` captures cookies, localStorage, and IndexedDB only for the comma-separated `--sites` list.

To reuse an existing signed-in Chrome profile instead of signing in, use `npx libretto import-chrome-profiles`. Get the user's consent first, since attaching can close or relaunch their Chrome window.
