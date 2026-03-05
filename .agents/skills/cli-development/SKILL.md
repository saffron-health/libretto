---
name: cli-development
description: |
  Design and implement command-line interfaces with subcommand-scoped help, actionable success output, and debuggable failure output. Use when creating or modifying CLI commands, argument parsing, help and usage text, exit codes, or command UX for humans and agents.
---

# CLI Development

Build CLIs that stay actionable in both success and failure paths.

## Core Principles

1. Avoid dead ends.
   - Print next steps when a reasonable next action exists.
   - On terminal completion, state that no further action is required.
2. Make failures diagnosable.
   - Print known state, failed operation, and likely cause.
   - Include recovery commands and focused help text.
   - Include usage text for argument or syntax errors.
3. Keep output minimal and context-efficient.
   - Use short defaults.
   - Show detail only when requested by flags or when needed to recover from failure.
4. Scope help to subcommands.
   - Keep root help high-level.
   - Put detailed flags, examples, and edge cases in subcommand help.

## Command Contract

1. Keep output deterministic.
   - Use stable wording and field names.
   - Avoid random ordering in lists.
2. Use conventional stream behavior.
   - Write primary result data to stdout.
   - Write diagnostics, warnings, and human-oriented guidance to stderr.
   - In machine mode (`--json`), print a complete structured success or error object to stdout.
   - Document that automation should capture both stdout and stderr for full logs.
3. Return meaningful exit codes.
   - `0` for success.
   - Non-zero codes map to clear failure classes.
4. Support automation.
   - Add machine-readable output mode such as `--json`.
   - Keep human-readable output as the default.
5. Support safe execution.
   - Add `--dry-run` for mutating commands.
   - Make retry behavior explicit.

## Help and Error Pattern

Use this pattern for each subcommand:

1. One-line purpose.
2. Usage line.
3. Required arguments.
4. Optional flags.
5. Examples, including one failure-recovery example.

When returning an error, format output in this order:

1. Error summary.
2. Known state.
3. Recovery options.
4. Exact next command.
5. Relevant subcommand help hint.

## Output Templates

Success with next step:

```text
Created release r123.
Next: mycli release publish r123
```

Success without next step:

```text
Published release r123.
No further action required.
```

Failure with recovery:

```text
Error: failed to publish release r123 (artifact missing).
Known state: release exists, build step did not produce dist/app.tar.gz.
Try: mycli release build r123
Then: mycli release publish r123
Help: mycli help release publish
```

## Implementation Checklist

- Define root command and subcommand boundaries.
- Write subcommand help before command logic.
- Implement parser and validate required arguments.
- Implement success and failure output contracts.
- Verify stream contract: parseable payloads on stdout, diagnostics on stderr.
- Add tests for success, parser errors, and runtime failures.
- Verify each failure path includes state and next steps.
