# Agent Guidelines

## Background Context

Libretto is an open-source toolkit for building robust web integrations. It gives coding agents a live browser and a token-efficient CLI to inspect pages, capture network traffic, record user actions, and replay them as automation scripts.

## Package Structure

This is a pnpm monorepo.

- `packages/libretto` — the main Libretto package (runtime, CLI, tests)
  - CLI source: `packages/libretto/src/cli/`
  - Tests: `packages/libretto/test/*.spec.ts`
- `apps/website` — marketing site (Vite / vite-plus)
- `docs/` — user-facing Mintlify documentation site
- `packages/libretto/docs/` — internal package documentation for implementation notes and maintainer references
- `benchmarks/` — benchmark suite (imports from `packages/libretto/src/`)
- `evals/` — eval suite

## Important Commands

Root (runs across all packages):

```bash
pnpm -s type-check
pnpm -s test
pnpm -s lint
pnpm -s cli
```

- Prefer `pnpm -s <script>` (or `pnpm --silent ...`) for routine scripted commands when you want less pnpm noise in logs.

- Do not pipe test commands through `grep`, `tail`, or other filters. The test reporter is minimal and token-efficient by default.
- Use `pnpm -s cli` to build and run the local development version of libretto.

## Code Quality

- TypeScript strict mode is enabled. Do not use `any` — use proper types or `unknown`.
- Use `.js` extensions in import paths (ESM resolution requires it).
- Do not add barrel files (`index.ts` re-exports). Import directly from source files within the same package.
- Do not add new dependencies without asking.
- Do not remove or comment out code to "clean up" without asking — it may be there for a reason.
- When code prints user-facing Libretto CLI commands, use `librettoCommand` from `packages/libretto/src/shared/package-manager.ts` so guidance respects the user's package manager.

## Testing

- VERY IMPORTANT: read `docs/tests-guide.md` before updating tests at all.

## Style

- Concise, technical prose. No filler or emoji.
- Prefer small, focused functions over large ones.
- Name things for what they do, not how they're implemented.

## **FORBIDDEN** Actions

- For stable releases on `main`: NEVER manually edit the `version` field in `packages/libretto/package.json`. Use `pnpm prepare-release` — that script opens a release PR, and CI publishes to npm under the `latest` dist-tag on merge.
- For experimental pre-releases (e.g. validating a new API on a downstream consumer before promoting it to a stable release): manually edit `packages/libretto/package.json` `version` to a pre-release identifier like `0.6.16-experimental-<feature>.0`, then run `pnpm publish:experimental` from this repo root. That script derives the npm dist-tag from the pre-release identifier (between `-` and `.N`) and publishes locally — it does NOT touch `main` and does NOT use the GitHub Actions release workflow. Refuses to publish if the version isn't a pre-release.
- NEVER hand-edit mirrored files in `.agents/skills/` or `.claude/skills/`. Edit the source in `packages/libretto/skills/` and run `pnpm sync:mirrors`.
- NEVER run `pnpm build` just to type-check. Use `pnpm type-check` instead.
- NEVER use `git add -A` or `git add .` — only stage the files you changed.

## Skill Mirrors

- Edit `packages/libretto/README.template.md` directly for README changes, then run `pnpm sync:mirrors`.
- Edit `packages/libretto/skills/libretto/SKILL.md` directly.
- `packages/libretto/skills/libretto` is the source of truth for Libretto skill files.
