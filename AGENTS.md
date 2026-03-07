# Agent Guidelines

## Background Context

This repository is a pnpm monorepo for Libretto.

- `packages/libretto` contains the runtime library.
- `packages/libretto-cli` contains the CLI and its integration-style test suites.
- The CLI depends on the local runtime package via workspace linking.

## Package Structure

- Root scripts orchestrate package-level workflows.
- Runtime build/type-check live in `packages/libretto/package.json`.
- CLI build/type-check/test live in `packages/libretto-cli/package.json`.
- CLI tests are in `packages/libretto-cli/src/*.test.ts`.

## Important Commands

Root:

```bash
pnpm i
pnpm build
pnpm type-check
pnpm test
```

Targeted (most common during CLI work):

```bash
pnpm --filter libretto-cli type-check
pnpm --filter libretto-cli test -- src/cli-basic.test.ts
pnpm --filter libretto-cli test -- src/cli-pause.test.ts
pnpm --filter libretto-cli test -- src/cli-stateful.test.ts
```

Local CLI invocation:

```bash
pnpm cli -- --help
```

## Skill Documentation Source of Truth

- Edit `packages/libretto/skill/SKILL.md`.
- Run `pnpm i` to sync generated copy to `.agents/skills/libretto/SKILL.md`.
- Do not manually edit `.agents/skills/libretto/SKILL.md`.
