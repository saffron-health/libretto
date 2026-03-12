---
name: fix-merge-conflicts
description: Resolve Git merge, rebase, or cherry-pick conflicts by preserving intent from both sides. Use when unmerged paths or conflict markers are present, especially when you must inspect the PR title and description tied to conflicting commits before choosing a resolution.
---

Resolve conflicts by intent, not by line order.

## Workflow

1. Run preflight conflict detection. If no local merge/rebase/cherry-pick conflicts are present, automatically fetch and merge `origin/main`.
2. Identify conflicted files and candidate commits.
3. Map each conflicting commit to its PR.
4. Read PR title and description to extract intent.
5. Detect intent divergence and request user intervention.
6. Resolve conflicts to preserve both intents when compatible.
7. Validate behavior with targeted checks.
8. Summarize decisions and any tradeoffs.

## 0) Preflight: Ensure a Conflict Exists

If there are no active unmerged paths, proactively merge latest `origin/main` to surface conflicts:

```bash
git status --porcelain
git diff --name-only --diff-filter=U
```

Decision rule:

- If `git diff --name-only --diff-filter=U` returns files, skip auto-merge and continue to conflict analysis.
- If it returns nothing, run:

```bash
git fetch origin
git merge origin/main
```

Then re-check:

```bash
git diff --name-only --diff-filter=U
```

- If conflicts now exist, continue with the rest of this workflow.
- If still no conflicts, report that no merge conflicts were detected and stop.

## 1) Identify Conflict Scope

Run:

```bash
git status --porcelain
git diff --name-only --diff-filter=U
git log --left-right --merge --oneline
```

Use `git log --left-right --merge` as the starting set of commits that influenced the conflicted hunks.

## 2) Map Commits to PRs

Prefer GitHub metadata when available.

1. Parse owner/repo from `origin`.
2. For each conflicting commit SHA, query associated PRs.

```bash
gh api graphql \
  -f query='query($owner:String!,$repo:String!,$sha:GitObjectID!){repository(owner:$owner,name:$repo){object(oid:$sha){... on Commit{associatedPullRequests(first:5){nodes{number title body url mergedAt baseRefName headRefName}}}}}}' \
  -F owner=OWNER -F repo=REPO -F sha=COMMIT_SHA
```

If no associated PR is found, fall back to `git show --stat COMMIT_SHA` and commit message context.

## 3) Extract Intent

For each relevant PR, capture:

- Goal stated in title
- Constraints, caveats, or behavioral expectations from description
- Any explicitly non-goals

Write a short intent summary per side before editing code.

## 4) Divergence Checkpoint (User Intervention Required)

Before finalizing any hunk where intents conflict, notify the user and ask for direction.

Treat these as divergence signals:

- Both sides change the same behavior with incompatible outcomes
- One side explicitly rejects behavior the other side introduces
- Either PR description states a constraint that the other side would violate

When divergence is detected:

1. Pause editing for that hunk.
2. Provide a short comparison of intent A vs intent B.
3. Ask one explicit resolution question.
4. Wait for user response before applying the final hunk resolution.

Question format:

```text
Intent divergence detected in <file>:<hunk>.
Option A (PR #X): <one-line intent>
Option B (PR #Y): <one-line intent>
Which intent should be primary for this hunk?
```

If the user chooses one side, preserve that side and salvage any non-conflicting behavior from the other side.
If the user requests a hybrid, restate the hybrid rule before applying edits.

## 5) Resolve by Preserving Intent

For each conflict hunk:

1. Explain what each side is trying to preserve.
2. Keep both behaviors if they are compatible.
3. If incompatible, keep repository invariants and adapt the losing side's goal into a safe equivalent.
4. Never silently drop behavior that was explicitly called out in a PR description.

Avoid resolving by "take ours/theirs" unless the PR intent proves one side is obsolete.

## 6) Validate

Run focused checks that cover touched behavior. In this repository, prefer:

```bash
pnpm --filter libretto-cli type-check
pnpm --filter libretto-cli test -- <relevant-test-file>
```

Run broader checks when conflict scope is wide.

## 7) Report

Provide a concise summary:

- Files resolved
- PR intents preserved
- Any intentional compromise and why
- Follow-up risk or test gap, if any

If intent is ambiguous after reading PR metadata, ask one specific question before finalizing.
