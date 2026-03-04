---
name: get-pr-reviews
description: Get nicely formatted output of the last review comments on a PR. Used internally by other skills.
---

Get nicely formatted review comments for a pull request, grouped by file and line with proper comment threading.

## Steps

1. **Determine PR number**: If not provided, look up the associated PR for the current branch using:

   ```bash
   gh pr view --json number --jq '.number'
   ```

2. **Get formatted review comments**: Use the GitHub API to fetch and format all line-specific review comments:
   ```bash
   gh api repos/:owner/:repo/pulls/{PR_NUMBER}/comments --jq '
   group_by(.path, .line) |
   map({
     path: .[0].path,
     line: .[0].line,
     comments: sort_by(.created_at)
   }) |
   sort_by(.path, .line) |
   map(
     "**\(.path)**\n  Line \(.line):" +
     (.comments |
      map(
        if .in_reply_to_id then
          "  |  \(.user.login): \(.body)"
        else
          " (\(.user.login)): \(.body)"
        end
      ) |
      join("\n")) + "\n"
   ) |
   join("\n")
   '
   ```

## Output Format

The formatted command produces output like:

```
**apps/api/src/handlers/optionsHandlers.ts**
  Line 98: (tanishqkancharla): I think this is a bug. If you search for e.g. "blue cros", none of these search conditions will match.
  |  tanishqkancharla: I see that you re-query all insurances below, so this doesn't get used.
  |  Mochael: I think we should ditch the ilikes and just use the fuzzy search applied to planName, payer name and abbreviation
  |  tanishqkancharla: default to fuzzy search

**apps/api/src/handlers/optionsHandlers.ts**
  Line 116: (tanishqkancharla): fyi: don't need to fix, but I think you can just do `query.where(and(...conditions, or(...searchConditions)))`
```

## Key Features

- **Grouped by file and line**: Comments are organized by their location in the code
- **Threaded conversations**: Replies are indented with `|` to show the conversation flow
- **Chronological order**: Comments within each thread are sorted by creation time
- **User attribution**: Each comment shows the GitHub username of the author

## Usage Example

```bash
# Get formatted review for PR #84
gh api repos/saffron-health/monorepo/pulls/84/comments --jq '...'
```
