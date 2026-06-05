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
- Reopen the site or run the workflow with that profile.

## Commands

```bash
npx libretto open https://app.example.com --headed --session login
npx libretto save example-app --session login --sites app.example.com,auth.example.com
npx libretto run ./integration.ts --auth-profile example-app
npx libretto profiles fetch chrome example-app --cdp-url http://127.0.0.1:9222 --sites app.example.com
npx libretto cloud profiles list
```

## Saving From Existing Chrome

Recent Chrome versions do not allow `--remote-debugging-port` against the
default user-data directory. If Chrome prints `DevTools remote debugging
requires a non-default data directory`, copy the desired profile to a temporary
user-data directory and launch Chrome from that copy before running
`profiles fetch chrome`; disable extensions if the copied profile opens and
exits.

## Notes

- Profiles are local to the current machine.
- Saving a profile captures cookies and localStorage only for the comma-separated `--sites` list.
- `libretto cloud deploy` creates a missing hosted auth profile from the local saved profile when a workflow declares `authProfile`.
- `authProfile: { name: "example-app", sites: ["app.example.com"], refresh: true }` refreshes the saved profile after successful local and hosted runs.
- `libretto cloud credentials push <name> --prefix LIBRETTO_<NAME>_` pushes matching env vars as hosted credentials. Prefixes must start with `LIBRETTO_` and end with `_`.
- Sessions can expire. If refresh is disabled or cannot recover the profile, repeat the login and save flow.
- Keep auth profiles as a brief operational detail in the main skill, not a full workflow pattern.
