# CLI Testing

This package runs CLI tests with Vitest as subprocess-based black-box checks.

## Scope

- Tests are under `test/**/*.spec.ts`.
- Tests should validate CLI behavior through command invocation, exit codes, and stdout/stderr.
- `packages/libretto-cli/src/index.ts` is treated as runtime-under-test, not a unit-test target.

## Fixtures

- Shared fixture helpers live in `test/fixtures.ts`.
- Every test gets a unique temp workspace directory under the OS temp directory.
- Seed helpers write `.libretto` state inside the temp workspace only.
- `librettoCli` executes the built CLI with subprocess `cwd` set to the temp workspace.
- `evaluate(actual).toMatch(assertion)` runs an LLM-based semantic assertion.
  - `toMatch` is async: use `await evaluate(stdout).toMatch("...")`.
  - API key is loaded via `gcloud secrets versions access latest --secret=libretto-test-openai-api-key` in `test/fixtures.ts`.
  - Configure model/cache constants directly in `test/fixtures.ts`.
  - Caches verdicts to `temp/libretto-cli-evaluate-cache/`.

## Guardrails

- Do not write test artifacts to repository-local runtime folders.
- Keep tests deterministic by default; only use live LLM assertions when explicitly needed.
- Prefer seeded files and subprocess assertions over browser launches.
