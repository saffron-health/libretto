# Libretto Monorepo

## Releasing a New Version

**Never manually edit `packages/libretto/package.json` version.** Use the release script:

```bash
pnpm prepare-release [patch|minor|major]
```

This bumps the version, updates all SKILL.md files, syncs mirrors, validates parity, commits, pushes a `release-v*` branch, and opens a PR. The release CI workflow triggers automatically when the PR merges to `main`.

## Mirror System

Skill files and READMEs are mirrored across multiple locations. **Do not hand-edit the mirrored copies.** Edit source files only, then sync.

Source directories:
- `packages/libretto/skills/libretto/` — interactive Libretto skill (source of truth)
- `packages/libretto/skills/libretto-readonly/` — read-only diagnosis skill (source of truth)

Mirror targets (generated — never edit directly):
- `.agents/skills/libretto/` and `.agents/skills/libretto-readonly/`
- `.claude/skills/libretto/` and `.claude/skills/libretto-readonly/`

After any change to source skill files or READMEs:

```bash
pnpm sync:mirrors    # sync all mirrored files
pnpm check:mirrors   # validate everything is in sync
```
