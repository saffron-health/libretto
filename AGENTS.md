# Agent Guidelines

## Background Context

This repository is a single pnpm package for Libretto.

## Package Structure

- Runtime and CLI build/type-check/test live in `package.json`.
- CLI source is in `src/cli/`.
- Tests are in `test/*.spec.ts`.

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
pnpm type-check
pnpm test -- test/basic.spec.ts
pnpm test -- test/multi-page.spec.ts
pnpm test -- test/stateful.spec.ts
```

Local CLI invocation:

```bash
pnpm cli help
```

## Skill Documentation Source of Truth

- Edit `.agents/skills/libretto/SKILL.md` directly.
- `.agents/skills/libretto` is the source of truth for Libretto skill files.
