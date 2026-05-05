# Tests Guide

Before updating tests, read this guide and follow its rules.

## Test Guidelines

- Do not test implementation details, such as internal `.libretto` file structure or specific output formatting details.
- Use user-level abstractions like `librettoCli`; assert user-visible phrases or keywords with `expect`.
- Do not use `try`/`finally`; test sessions are automatically cleaned up at the end of each test.
- Do not test exit codes.
- Prefer Vitest fixtures for shared test setup and teardown instead of ad-hoc helpers or manual cleanup. See the [Vitest fixtures documentation](https://vitest.dev/guide/test-context.html#fixtures).
