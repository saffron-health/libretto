# Auth Profiles

Use this reference only when the user explicitly asks to save or reuse local authenticated browser state.

## When to Use This

- The site requires manual login.
- The user is running workflows locally.
- The workflow declares an auth profile for hosted runs.

## Workflow

- Open the site in headed mode.
- Ask the user to log in manually.
- Save the current session as a named, site-scoped profile.
- Reopen the site with that profile or run a workflow that declares it.

## Commands

```bash
npx libretto open https://app.example.com --headed --session login
npx libretto save example-app --session login --sites app.example.com,auth.example.com
npx libretto run ./integration.ts
npx libretto cloud profiles list
npx libretto cloud profiles delete example-app
```

## Saving From Existing Chrome

Recent Chrome versions do not allow `--remote-debugging-port` against the
default user-data directory. If Chrome prints `DevTools remote debugging
requires a non-default data directory`, copy the desired profile to a temporary
user-data directory and launch Chrome from that copy before running
`profiles fetch chrome`; disable extensions if the copied profile opens and
exits.

```bash
npx libretto profiles fetch chrome example-app --cdp-url http://127.0.0.1:9222 --sites app.example.com
```

## Notes

- Profiles are local to the current machine.
- Saving a profile captures cookies, localStorage, and IndexedDB only for the comma-separated `--sites` list.
- `run` uses the workflow-declared `authProfile`; do not pass `--auth-profile` to `run`.
- `libretto cloud deploy` registers missing hosted auth profile names when a workflow declares `authProfile`; it does not upload local profile files.
- `authProfile: { name: "example-app", refresh: true }` refreshes local profile data for sites visited by successful local runs; hosted runs use provider-native profile persistence.
- Sessions can expire. If refresh is disabled or cannot recover the profile, repeat the login and save flow.
- Keep auth profiles as a brief operational detail in the main skill, not a full workflow pattern.
