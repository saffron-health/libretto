# CLI Testing

This package runs CLI tests with Vitest as subprocess-based black-box checks.

## Scope

- Tests are inline under `src/**/*.test.ts`.
- Tests should validate CLI behavior through command invocation, exit codes, and stdout/stderr.
- `packages/libretto-cli/src/index.ts` is treated as runtime-under-test, not a unit-test target.

## Fixtures

- Shared fixture helpers live in `src/test-fixtures.ts`.
- Every test gets a unique temp workspace directory under the OS temp directory.
- Seed helpers write `.libretto` and legacy `.libretto-cli` state inside the temp workspace only.
- `librettoCli` executes the built CLI with subprocess `cwd` set to the temp workspace.

## Guardrails

- Do not write test artifacts to repository-local runtime folders.
- Keep tests deterministic and offline (no live LLM or website dependencies).
- Prefer seeded files and subprocess assertions over browser launches.
