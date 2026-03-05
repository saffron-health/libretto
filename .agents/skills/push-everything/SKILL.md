---
name: push-everything
description: Stage ALL changes in the repository (not just session changes), commit, and push. Use when you need to commit all pending changes.
---

## Branch handling

If on main, checkout a new branch first.

If on a non-main branch where the existing PR is already merged, the uncommitted changes are likely unrelated to that branch. In this case:

1. Checkout main and pull
2. Create a new branch with a name describing the uncommitted changes
3. Continue with the commit workflow below

## Commit workflow

Stage and commit ALL the changes in the git repo (not just the ones in this session). Use gh cli to check if a PR exists for this branch. If no PR exists, create one with an appropriate title and description. If a PR exists, query its current title and description and update them if the new changes warrant it. Push the changes.

Ignore developer tooling changes (e.g. changes to .gitignore, or agent skills, or anything in dev-tools or .bin) in the commit message or PR title/description, unless the PR is solely about those changes.

For follow-up edits in this session, continue to commit, push, and update the PR as needed.
