# Auth Profiles

Use this reference when the target site requires login and the user wants to reuse local authenticated browser state.

## When to Use This

- The site requires manual login.
- The user is running workflows locally.
- Reusing a saved session is simpler than building credential-handling logic into the workflow.

## Workflow

- Open the site in headed mode.
- Ask the user to log in manually.
- Save the current session as a profile.
- Reopen the site or run the workflow with that profile.

## Commands

```bash
npx libretto open https://app.example.com --headed
npx libretto save app.example.com
npx libretto run ./integration.ts main --auth-profile app.example.com
```

## Notes

- Profiles are local to the current machine.
- Sessions can expire. If the profile stops working, repeat the login and save flow.
- Keep auth profiles as a brief operational detail in the main skill, not a full workflow pattern.
