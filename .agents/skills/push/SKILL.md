---
name: push
description: Commit and push changes, creating or updating a PR as needed. Use for standard push workflow.
---

## Branch handling

If on main, checkout a new branch first.

If on a non-main branch where the existing PR is already merged, the uncommitted changes are likely unrelated to that branch. In this case:

1. Checkout main and pull
2. Create a new branch with a name describing the uncommitted changes
3. Continue with the commit workflow below

## Commit workflow

Commit the changes. Use gh cli to check if a PR exists for this branch. If no PR exists, create one with an appropriate title and description. If a PR exists, query its current title and description and update them if the new changes warrant it. Push the changes.

For follow-up edits in this session, continue to commit, push, and update the PR as needed.
