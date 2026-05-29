# Auth Profiles

Use this reference only when the user explicitly asks to save or reuse local authenticated browser state.

## When to Use This

- The site requires manual login.
- The user is running workflows locally or wants to push an explicit profile to Libretto Cloud.

## Workflow

- Open the site in headed mode.
- Ask the user to log in manually.
- Save the current session as a named profile.
- Reopen the site or run the workflow with that named profile.
- Push the named profile separately when hosted runs need it.

## Commands

```bash
npx libretto open https://app.example.com --headed
npx libretto save app --session default --site app.example.com
npx libretto run ./integration.ts --auth-profile app
npx libretto cloud profiles push app --site app.example.com
```

## Notes

- Profiles are local to the current machine.
- Pushing a profile to Libretto Cloud overwrites a cloud profile with the same name.
- Sessions can expire. If the profile stops working, repeat the login and save flow.
- Keep auth profiles as a brief operational detail in the main skill, not a full workflow pattern.
