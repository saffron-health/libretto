# Auth Profiles

Use this reference when generating or maintaining workflows that need a logged-in website session.

## When to Use This

- The user wants to persist authentication across runs.
- The workflow should recover when saved login state is stale.

## Workflow

- Open the site in headed mode.
- Ask the user to log in manually.
- Save the current session as a named, site-scoped profile.
- Run a workflow that declares the profile and includes fallback login logic.

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
browser state back to the profile. Pair profile use with `librettoAuthenticate`
so stale local or hosted sessions can fall back to login with declared
credentials before the workflow continues.

```typescript
import { librettoAuthenticate, workflow } from "libretto";

export default workflow("accountWorkflow", {
  authProfile: {
    name: "example-account",
    refresh: true,
  },
  credentials: ["username", "password"],
  async handler(ctx, input) {
    const { page } = ctx;

    await page.goto("https://app.example.com/dashboard");

    await librettoAuthenticate(ctx, {
      credentials: input.credentials,
      validate: async ({ page }) =>
        await page.getByRole("heading", { name: "Dashboard" })
          .isVisible()
          .catch(() => false),
      fallback: async ({ page }, credentials) => {
        await page.goto("https://app.example.com/login");
        await page.getByLabel("Email").fill(credentials.username);
        await page.getByLabel("Password").fill(credentials.password);
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
- If the user explicitly wants to import from Chrome, ask which Chrome/profile
  to launch or attach to and get consent before attaching because disconnecting
  can close or relaunch that Chrome window. Chrome may require copying the
  selected profile to a temporary user-data directory before running
  `npx libretto import-chrome-profiles example-app --cdp-url http://127.0.0.1:9222 --sites app.example.com`.
