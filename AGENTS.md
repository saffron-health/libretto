# Agent Guidelines

## Background Context

This repository is a pnpm monorepo. The main package lives in `packages/libretto`.

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

- Edit `packages/libretto/skills/libretto/SKILL.md` directly.
- `packages/libretto/skills/libretto` is the source of truth for Libretto skill files.
