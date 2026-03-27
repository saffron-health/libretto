# Updating AGENTS.md Documentation

Guidelines for updating AGENTS.md files based on learnings from the current session.

## Core Principles

1. AGENTS.md goes into every session, so contents must be universally applicable
2. Less is more: fewer instructions means better instruction-following
3. Use progressive disclosure: point to detailed docs rather than inlining everything

## Where Documentation Belongs

Place docs in the deepest/lowest common ancestor:

- Root `AGENTS.md`: repo-wide conventions (build commands, package structure)
- Package `AGENTS.md` (e.g., `apps/api/AGENTS.md`): package-specific patterns
- Subdirectory `AGENTS.md` (e.g., `apps/api/src/sync/AGENTS.md`): feature-specific details
- `docs/*.md`: detailed explanations, tutorials, or complex topics

When a topic grows too large for AGENTS.md, extract it to `docs/` and reference it.

## What to Include

Good candidates for AGENTS.md:

- Commands to build, test, typecheck (copy-pasteable, verified)
- Directory structure overview with brief descriptions
- Pointers to docs/ files for specific topics

Avoid in AGENTS.md:

- Style guidelines (rely on linters/formatters and in-context learning)
- Exhaustive API documentation (use code comments or separate docs)
- Rarely-needed information (put in docs/ and reference)

## Pointing to Detailed Docs

When referencing docs/ files, provide a clear trigger so agents know WHEN to read them. Use progressive disclosure: point to docs when they're relevant.

Bad (too vague):

```markdown
See docs/interactive-debugging-workflow.md for more information.
```

Good (clear trigger):

```markdown
When fixing browser automation issues (selectors not working, elements not found), read docs/interactive-debugging-workflow.md
```

Pattern: When [specific situation], read [doc]

More examples:

```markdown
When adding new fields to Tandem sync, read docs/adding-sync-fields.md
```

```markdown
When working with service accounts or seeing auth errors, read docs/service-accounts.md
```

```markdown
When creating GCP secrets, read docs/gcloud-secrets.md
```

Keep it simple: just tell agents when the doc is relevant.

Good (clear trigger + value):

```markdown
When fixing browser automation issues (clicks not working, elements not found, selectors failing), use the interactive debugging workflow instead of the edit-restart cycle. This reduces iteration time from 5-10 minutes to 30 seconds.

See docs/interactive-debugging-workflow.md for detailed instructions and examples.
```

Pattern:

1. Trigger: When [specific situation]
2. Action: [what to do]
3. Benefit: [why it matters / time saved / problem solved]
4. Reference: See [doc] for [what's inside]

More examples:

```markdown
When adding new fields to Tandem sync, follow the schema update process to ensure proper syncing across clients.

See docs/adding-sync-fields.md for step-by-step instructions.
```

```markdown
When tests fail with auth errors after refactoring, you likely need to update service account permissions in GCP.

See docs/service-accounts.md for architecture and troubleshooting.
```

## Writing Style

- No bold or italics
- Use code blocks for commands
- Prefer `file:line` references over code snippets (snippets get stale)
- Keep it concise: aim for under 60 lines in root, shorter in nested files
- Structure: WHAT (purpose), HOW (commands/usage), WHERE (directory pointers)

## Refactoring as You Go

When adding to an AGENTS.md that already has multiple guidelines around one topic:

1. Consider collapsing related items into a single docs/ page
2. Replace the multiple items with a single reference
3. Example: Instead of 5 database migration tips, create `docs/database-migrations.md` and add one line: `- docs/database-migrations.md - Database migration patterns`

## Template

```markdown
# Package Name

Brief description of purpose.

## Commands

\`\`\`bash
pnpm test # Run tests
pnpm build # Build package
\`\`\`

## Structure

- `src/feature/` - Feature description
- `src/utils/` - Utility functions

## Docs

- `docs/relevant-topic.md` - When to read this
```
