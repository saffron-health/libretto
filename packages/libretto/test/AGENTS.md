# Test Guidelines

- Do not test implementation details, such as internal `.libretto` file structure or specific output formatting details.
- Use user-level abstractions like `librettoCli` and `evaluate`; use `expect` only for exact string expectations.
- Do not use `try`/`finally`; test sessions are automatically cleaned up at the end of each test.
- Do not test exit codes.
