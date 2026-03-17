# Reverse Engineering Network Requests

Use this reference when the user wants to turn a browser workflow into direct network requests.

## When to Use This

- The page clearly loads or submits data through HTTP requests.
- The user can perform the workflow manually in a headed browser.
- Replaying the request is likely faster or more stable than reproducing every UI action.

## Workflow

- Open the page in headed mode.
- Let the user perform the relevant workflow manually.
- Read the network log after the relevant step.
- Identify the smallest set of requests that actually carries the data or performs the action.
- Confirm with the user before replaying any request that could mutate data.
- Recreate the request in code outside Libretto.
- Verify the resulting workflow with `npx libretto run ...`.

## Commands

```bash
npx libretto open https://target.example.com --headed
npx libretto network --last 20
npx libretto network --method POST --last 20
npx libretto network --filter 'referral|patient|search'
npx libretto exec "return await networkLog({ method: 'POST', last: 10 })"
```

## Notes

- Start with the request that returns the data you need, not every request on the page.
- Prefer captured requests over guessing payload shape.
- If the request format is opaque or highly dynamic, fall back to UI automation for that part.
- Treat all replayed requests as potentially side-effectful until proven otherwise.
