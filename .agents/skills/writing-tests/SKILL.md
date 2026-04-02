---
name: writing-tests
description: "Write and edit test files that model real user flows. Use when creating, modifying, or reviewing test files."
---

# Writing Tests

## Core Principle: Tests Are User Flows

Each test should represent a single, concrete flow that a real user would follow when interacting with the system. Write tests at the same abstraction level as the user experiences the system.

## Rules

### 1. Match the user's interface exactly

The test should call the system the same way a user would. If the system is a CLI, the test should invoke the CLI with argument strings. If it's a library, the test should call the public API. Don't wrap the interface in test-specific helpers that hide what's actually happening.

**Good** — the test reads like what a user would do:

```ts
const result = await librettoCli("setup --skip-browsers");
expect(result.exitCode).toBe(0);

const result2 = await librettoCli("--help");
expect(result2.stdout).toContain("Usage:");
```

**Bad** — extra abstraction obscures the actual interaction:

```ts
const result = await setupWithDefaults(); // hides the real CLI invocation
assertSuccess(result); // hides what "success" means
```

### 2. Keep tests verbose and concrete

Don't introduce helpers for brevity. The value of a test is that you can read it top-to-bottom and understand exactly what's happening. Repetition across tests is fine — each test should be self-contained and readable on its own.

### 3. One flow per test

Each test should exercise one coherent user scenario from setup through assertion. Don't combine unrelated flows into a single test, and don't split one logical flow across multiple tests.

### 4. Tests form a behavioral hull

The full set of tests for a system should cover the sufficiently complete set of flows a user might follow. Think about:

- The happy path for each major feature
- Edge cases a user would realistically hit
- Error cases and what the user sees when things go wrong

When adding a new feature, add tests that cover the new user flows it introduces. When fixing a bug, add a test that reproduces the flow where the bug occurred.
