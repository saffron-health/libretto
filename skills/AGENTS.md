# Skills Directory

- `skills/libretto` is the source of truth for the Libretto skill.
- The mirrored copies in `.agents/skills/libretto` and `.claude/skills/libretto` are generated from `skills/libretto`.
- Edit files under `skills/libretto` directly. Do not hand-edit the mirrored copies.

## Syncing

- Run `pnpm sync-skills` after changing anything under `skills/libretto`.
- Run `pnpm check:skills` to verify that `skills/libretto`, `.agents/skills/libretto`, and `.claude/skills/libretto` are identical.
- `pnpm i` also resyncs the mirrors through `postinstall`, but use `pnpm sync-skills` for local doc edits so you do not need a full install step.
