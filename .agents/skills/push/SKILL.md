---
name: push
description: Commit and push changes, creating or updating a PR as needed. Use for standard push workflow.
---

## Branch handling

If on main, checkout a new branch first.

If on a non-main branch where the existing PR is already merged, the uncommitted changes are likely unrelated to that branch. In this case:

1. Checkout main and pull
2. Create a new branch with a name describing the uncommitted changes
3. Continue with the commit and PR workflow below

## Commit and PR workflow

Commit the changes. Use gh cli to check if a PR exists for this branch. If no PR exists, create one with an appropriate title and description. If a PR exists, query its current title and description and update them if the new changes warrant it. Push the changes.

When writing or updating a PR title and description, always base them on the **full diff against `main`** (`git diff main...HEAD`), not just the most recent commits. The title and description should accurately summarize the entire set of changes in the PR.

### Release note labels

When creating or updating a PR in this repo, make sure it has a changelog label so GitHub Releases can categorize it correctly.

Prefer one of:

- `enhancement`
- `bug`
- `documentation`

If the correct label is unclear, prefer `enhancement`.

If the PR should be excluded from release notes, use `skip-changelog`.

Use `skip-changelog` for PRs focused only on developer tooling changes, such as agent skills, workflow plumbing, local tooling, or similar maintenance that should not appear in user-facing release notes.

### PR body formatting

When the PR body contains Markdown code spans/backticks, parentheses, angle brackets, or shell-sensitive characters, do not pass it directly via `--body "..."` because shells can mangle it.

Use `--body-file` with stdin/heredoc instead:

```bash
cat <<'EOF' | gh pr create --base main --head <branch> --title "<title>" --body-file -
## Summary
- item with `code`
EOF
```

Use the same pattern for updates:

```bash
cat <<'EOF' | gh pr edit <branch-or-number> --body-file -
## Updated Summary
- item with `code`
EOF
```

## CI and review gating

Do not report completion to the user until all required GitHub PR checks pass.

After every push:

1. Watch PR checks with `gh pr checks --watch`.
2. If GitHub returns `no checks reported`, treat it as possible propagation delay. Wait 15 seconds and retry `gh pr checks --watch`. Repeat up to 8 times (about 2 minutes total).
3. If checks are still not reported after those retries, run one remediation pass and treat merge conflicts with `main` as a likely cause:
   - Pull and merge `main` into your branch.
   - If merge conflicts occur, resolve them by following the `fix-merge-conflicts` skill.
   - Commit the conflict resolution if needed, push, and restart this CI loop once.
4. If checks are still not reported after that remediation pass, conclude no required checks are configured for this PR.
5. If checks appear, wait for all required checks to complete.
6. If any test or type-check command fails, inspect logs immediately, fix the issue, commit, push, and repeat this CI loop until checks pass.
7. If checks are blocked on AI review bots, wait for bot completion and read all bot reviews before reporting completion.

AI review bot handling:

1. Read every new AI review comment on the PR, including multiple reviews from multiple bots.
2. Analyze each concern and classify it as valid, partially valid, or not valid.
3. For valid or partially valid concerns, apply fixes, commit, push, and restart the CI loop.
4. For concerns that are not valid, explain why with concrete technical reasoning when you report status to the user.

For follow-up edits in this session, continue to commit, push, and update the PR as needed. After each follow-up push, re-run the full check-wait loop above (`gh pr checks --watch` and retries) before reporting completion.
