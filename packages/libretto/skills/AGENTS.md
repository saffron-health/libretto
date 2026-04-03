# Skills Directory

- `skills/libretto` is the source of truth for the interactive Libretto skill.
- `skills/libretto-readonly` is the source of truth for the read-only diagnosis skill.
- The mirrored copies in `.agents/skills/*` and `.claude/skills/*` are generated from the matching source directories under `skills/`.
- Edit files under `skills/` directly. Do not hand-edit the mirrored copies.

## Syncing

- Run `pnpm sync:mirrors` after changing anything under `skills/`.
- Run `pnpm check:mirrors` to verify that generated READMEs, skill mirrors, and skill version metadata are in sync.
