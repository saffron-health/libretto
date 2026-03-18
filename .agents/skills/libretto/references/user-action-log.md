# User Action Log

Use this reference when the user performs steps manually in a headed Libretto session and you want to incorporate those steps into a workflow.

## When to Use This

- The user demonstrates the workflow in the browser window.
- You want to know what they clicked, typed, or selected.
- You need to reconcile manual user actions with captured network requests.

## Workflow

- Open the session in headed mode.
- Ask the user to perform the workflow.
- Read the user action log after they finish.
- Use the log to identify the important transitions in the workflow.
- Combine the action log with `snapshot` or `network` when the log alone is not enough.

## Commands

```bash
npx libretto actions --source user --last 20
npx libretto actions --source user --filter 'button|input|select'
npx libretto exec "return await actionLog({ source: 'user', last: 10 })"
```

## Notes

- The action log is most useful for reconstructing the sequence of a workflow, not for discovering every selector you need.
- If the user performed relevant manual steps, read the action log before writing or revising the workflow code.
- Use the action log to anchor your understanding, then inspect the current page state with `snapshot` or `exec`.
