---
name: summarize
description: Summarize a spec or current changes into a format suitable for sharing on Slack. Use when creating a summary for team communication.
---

Summarize the given spec or current changes into a format suitable for sharing on Slack.

Read the spec file or use git diff to understand the current changes if no spec is provided.

Output the summary in this exact format:

```
**Problem:** Right now, we ...
- <bullet point explaining issue>
- <bullet point explaining issue>
- ...

**Solution:** <one sentence explaining the solution>
- <bullet point explaining change>
- <bullet point explaining change>
- ...
```

Guidelines:

- Write concisely using active voice
- Focus on what matters to teammates who have no context
- Do not reference "this spec" or "this PR" - explain the problem and solution directly
- Keep bullet points short and scannable
- Use technical terms appropriately but avoid jargon
