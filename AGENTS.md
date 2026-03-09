# Agent Guidelines

## Background Context

This repository is a pnpm monorepo for Libretto.

- `packages/libretto` contains the runtime library, CLI, and integration-style test suites as a single package.

## Package Structure

- Root scripts orchestrate package-level workflows.
- Runtime and CLI build/type-check/test live in `packages/libretto/package.json`.
- CLI source is in `packages/libretto/src/cli/`.
- Tests are in `packages/libretto/test/*.spec.ts`.

## Important Commands

Root:

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
pnpm --filter libretto test -- test/pause.spec.ts
pnpm --filter libretto test -- test/stateful.spec.ts
```

Local CLI invocation:

```bash
pnpm cli -- --help
```

## Skill Documentation Source of Truth

- Edit `packages/libretto/skill/SKILL.md`.
- Run `pnpm i` to sync generated copy to `.agents/skills/libretto/SKILL.md`.
- Do not manually edit `.agents/skills/libretto/SKILL.md`.
