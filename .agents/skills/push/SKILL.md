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

For follow-up edits in this session, continue to commit, push, and update the PR as needed.
