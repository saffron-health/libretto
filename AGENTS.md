# Agent Guidelines

## Background Context

This repository is a pnpm monorepo. The main package lives in `packages/libretto`.

We use Mintlify for our docs. Source at `docs/`. Configuration in `docs/docs.json`. Use the Mintlify skill when updating docs. Preview with `cd docs && mint dev`.

## Package Structure

- `packages/libretto` — the Libretto package (runtime, CLI, tests)
  - CLI source is in `packages/libretto/src/cli/`.
  - Tests are in `packages/libretto/test/*.spec.ts`.
- `benchmarks/` — benchmark suite (root-level, imports from `packages/libretto/src/`)
- `evals/` — eval suite (root-level)

## Important Commands

Root (runs across all packages):

```bash
pnpm i
pnpm build
pnpm type-check
pnpm test
```

Targeted (most common during development):

```bash
pnpm sync:mirrors
pnpm check:mirrors
pnpm --filter libretto type-check
pnpm --filter libretto test -- test/basic.spec.ts
pnpm --filter libretto test -- test/multi-page.spec.ts
pnpm --filter libretto test -- test/stateful.spec.ts
```

Local CLI invocation:

```bash
pnpm --filter libretto cli help
```

## Skill Documentation Source of Truth

- Edit `packages/libretto/README.template.md` directly for README changes, then run `pnpm sync:mirrors`.
- Edit `packages/libretto/skills/libretto/SKILL.md` directly.
- `packages/libretto/skills/libretto` is the source of truth for Libretto skill files.
