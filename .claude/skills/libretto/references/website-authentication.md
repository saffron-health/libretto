# Website Authentication

Use this reference when a workflow needs a logged-in website session. The Working Rules in `../SKILL.md` define the required auth workflow; this file explains how to implement sign-in logic with `librettoAuthenticate`, and how auth profiles save signed-in state for later runs.

Build and verify working sign-in logic first. Authenticated workflows must use `librettoAuthenticate`; an auth profile is added only after the sign-in logic is verified, never as a substitute for it.

## Sign-In Logic

Use `librettoAuthenticate` so the workflow can sign in from a fresh browser. Declare each required secret in the workflow credentials array and use those credentials inside `signIn`.

```typescript
import { librettoAuthenticate, workflow } from "libretto";

export default workflow("accountWorkflow", {
  startUrl: "https://app.example.com/dashboard",
  credentials: ["portal_username", "portal_password"],
  async handler(ctx, input) {
    const { page } = ctx;

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

## Auth Profiles

Auth profiles save the signed-in browser state (cookies, localStorage, IndexedDB) so later runs can reuse a logged-in session instead of signing in from scratch. The sign-in logic still takes priority: do not add a profile until the `librettoAuthenticate` sign-in step has been verified from a signed-out browser with no profile present. If you add a profile first, validation passes on the saved session while the untested sign-in logic fails the first time that session expires.

A profile only holds whatever a signed-in session wrote into it, so it does nothing until a run has signed in at least once. With `refresh: true`, a successful run writes updated browser state back to the profile, so a fresh sign-in repairs an expired one.

Auth profiles are browser-runtime-specific:

- Local runs load `.libretto/profiles/<name>.json`.
- `libretto-cloud` and providers that explicitly support auth profiles use provider-backed profile state; a local profile file is not available to provider browsers.
- Provider-backed profiles are created or refreshed by workflow-declared `authProfile` metadata. For manual login on a remote provider, run the hosted workflow with a pause/wait, ask the human to sign in through the live URL, use the observed login flow to implement `librettoAuthenticate`, then let the workflow finish so the provider can persist the profile.
- A plain `open --provider` session does not have workflow auth profile metadata. `libretto save` writes a local profile from an open session; it does not persist provider-backed workflow auth profile state.
- Revalidate login when switching providers, even if the profile name is the same.

Add the profile to the workflow you already verified:

```typescript
export default workflow("accountWorkflow", {
  startUrl: "https://app.example.com/dashboard",
  // Added only after the signIn step above is verified standalone.
  authProfile: { name: "example-account", refresh: true },
  credentials: ["portal_username", "portal_password"],
  // ...same handler and librettoAuthenticate call as above.
});
```

## Commands

```bash
# Open the site in headed mode and ask the user to log in manually.
npx libretto open https://app.example.com --headed --session login

# Save the current signed-in session as a named, site-scoped profile.
npx libretto save example-app --session login --sites app.example.com,auth.example.com

# You can now reopen the site locally with that profile.
npx libretto open https://app.example.com --auth-profile example-app

# List or delete hosted auth profile names.
npx libretto cloud profiles list
npx libretto cloud profiles delete example-app
```

`save` captures cookies, localStorage, and IndexedDB only for the comma-separated `--sites` list.

To reuse an existing signed-in Chrome profile instead of signing in, use `npx libretto import-chrome-profiles`. Get the user's consent first, since attaching can close or relaunch their Chrome window.

When the user wants to deploy an authenticated workflow, trace the login flow before writing the workflow: open the site with the target provider, inspect behavior while the human signs in, implement `librettoAuthenticate`, then validate the workflow with the auth profile in the target browser runtime.
