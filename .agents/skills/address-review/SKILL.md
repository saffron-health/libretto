---
name: address-review
description: Address PR review comments systematically. Use when responding to code review feedback on a pull request.
---

Address PR review comments systematically.

## Process

1. **Get review comments**: Use `gh api graphql` to fetch all review threads and comments for the PR. (If a PR number is not provided in the input, look up the PR for the current branch).

2. **Analyze comments**: Review all the feedback to understand what changes are needed

3. **Address each comment systematically**: For each review comment:
   - Make the requested code changes
   - Verify the changes fix the issue raised
   - Add explanatory comments if the reviewer requested clarification
   - Test changes to ensure they don't break existing functionality

4. **Quality assurance**: Run type-check, build, and lint to ensure all changes are correct

5. **Commit and push**: Stage and commit all changes with an appropriate message and push.

6. **Mark comments resolved**: Query PR review threads with `gh api graphql` to get thread IDs and outdated status. Resolve all addressed threads using `mutation { resolveReviewThread(input: {threadId: "THREAD_ID"}) { thread { isResolved } } }`. Always resolve outdated threads.

## Implementation Pattern

```
// Query review threads:
gh api graphql -f query='query { repository(owner: "owner", name: "repo") { pullRequest(number: N) { reviewThreads(first: 100) { nodes { id isResolved isOutdated comments { nodes { body } } } } } } }'

// Resolve thread:
gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "THREAD_ID"}) { thread { isResolved } } }'
```

## Notes

- Only address reviews from human users; ignore bot reviews (e.g., Claude) unless explicitly requested
- Use sub-agents to handle independent review comments in parallel when possible
- Always verify changes don't introduce new issues
- If a review comment requires clarification, document the approach taken
- Focus on the specific issues raised rather than making additional changes
- Mark outdated comments as resolved automatically since they no longer apply to current code
