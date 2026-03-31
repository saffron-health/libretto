# Skills Directory

- `skills/libretto` is the source of truth for the Libretto skill.
- The mirrored copies in `.agents/skills/libretto` and `.claude/skills/libretto` are generated from `skills/libretto`.
- Edit files under `skills/libretto` directly. Do not hand-edit the mirrored copies.

## Syncing

- Run `pnpm sync:mirrors` after changing anything under `skills/libretto`.
- Run `pnpm check:mirrors` to verify that generated READMEs, skill mirrors, and skill version metadata are in sync.
- `pnpm i` also resyncs the skill mirrors through `postinstall`, but use `pnpm sync:mirrors` for local doc edits because `postinstall` does not regenerate the READMEs.
