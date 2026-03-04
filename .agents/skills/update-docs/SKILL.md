---
name: update-docs
description: Update AGENTS.md files based on session learnings about a topic. Use when documenting patterns, commands, or conventions discovered during development.
---

Update AGENTS.md files based on what was learned in this session about: $TOPIC

Read `docs/updating-agents-docs.md` for full guidelines before proceeding.

## Process

1. Review the conversation for learnings about the specified topic:
   - Patterns or conventions discovered
   - Commands needed but not documented
   - Architectural insights
   - Common pitfalls encountered

2. Determine where each learning belongs (lowest common ancestor):
   - Root `AGENTS.md` for repo-wide patterns
   - Package-level AGENTS.md for package-specific patterns
   - `docs/*.md` for detailed explanations

3. Check if the target AGENTS.md already has related content:
   - If multiple related items exist, consider extracting to a docs/ page
   - If adding would make the file too long (>60 lines for root), extract to docs/

4. Apply changes following the writing style in the guidelines

5. List what was updated and why
