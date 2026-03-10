# Test Guidelines

- Do not test implementation details, such as internal `.libretto` file structure or specific output formatting details.
- Use user-level abstractions like `librettoCli` and `evaluate` for semantic assertions; for exact string value matching, use `expect` instead of `evaluate`.
- Do not use `try`/`finally`; test sessions are automatically cleaned up at the end of each test.
- Do not test exit codes.
