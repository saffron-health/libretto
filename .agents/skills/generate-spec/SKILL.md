---
name: generate-spec
description: Create a spec sheet for the given feature/fix request in specs/ directory. Use when planning a significant new feature or complex fix.
---

Create a spec sheet for the given feature/fix request in specs/ directory.

Ultrathink. Follow the following steps:

## Understand existing code

Use code search sub-agents and `grep` as much as possible to deeply understand all of the relevant code. Be smart about your code search: start with where you think it might be, and if that inspires different places to read, follow up with sub-agents to do so. Each sub-agent should give you back information, and potentially other files to read or searches that might be relevant.

## Understand external documentation/libraries

If external libraries are involved, always look up and research their relevant documentation as well. Tend to adhere strictly to the examples and best practices provided by the external libraries.

## Ask critical guiding questions

After completing the research steps above, pause and ask the user any critical guiding questions before writing the spec. The feature/fix request will not always be completely defined. There may be logical errors, ambiguous requirements, or important clarifications required. Examples:

- "To store this data, we could either add a new table or extend the existing X table. The new table keeps concerns separate but adds a join; extending X is simpler but couples the concepts. Which do you prefer?"
- "There are two ways to surface this to the user: a modal dialog or an inline panel. The modal is more disruptive but harder to miss; the inline panel is less intrusive but easier to overlook. Which feels right?"
- "We need to sync this state. We could poll on an interval or use a WebSocket. Polling is simpler to implement but adds latency; WebSocket is real-time but more complex. Which trade-off do you want?"

Present the options you see, explain the trade-offs briefly, and let the user decide. If the feature request is fully defined and the path forward is obvious, skip the questions and write the spec directly. Practice good judgement.

## Establish goals and non-goals

After research and any clarifying questions, establish explicit goals and non-goals for the spec. These come directly from the user. If the user did not provide them in the initial prompt, suggest a set of goals and non-goals and ask for confirmation before proceeding.

Goals are high-level end-user stories that describe what should be true when the spec is complete. Example: "user sets up a Gmail trigger and it works as expected."

Non-goals clarify what is deliberately out of scope. Example: "don't worry about migration or backfills."

By default, always include "no migrations or backfills" as a non-goal unless the user explicitly requests them.

The spec must include these sections near the top, before the implementation plan.

## Reason critically about the spec

Before writing the spec, think through the implementation with a "bicycle before car" mindset. Spec the simplest version that works end-to-end and delivers real value. Do not spec the scalable, polished, extensible version.

### Scope

Cut any phase that is not required for the core functionality to work. If you can remove a phase and a real user can still use the feature, it does not belong in v1. Infrastructure, abstraction layers, configuration systems, and polish are almost never v1 work.

### Testing

Each phase's success criteria should verify the thing most likely to go wrong, not the thing most likely to go right. A test that a Zod schema parses valid input is low-value. A test that filtering logic excludes wrong results is high-value. Ask: "What would make me revert this phase?" Test that.

If a phase does not have a clear way to verify it works, the phase is poorly scoped. Restructure it so it produces something testable: extract a pure function, expose an interface, write to an observable output. Design for testability in the spec, not after implementation.

### End-to-end verification

Agents have access to CLI tools for running tests and project scripts. Specs should leverage these where appropriate.

When a phase involves runtime behavior, prefer success criteria that verify end-to-end behavior with the project's existing scripts and test commands rather than only relying on unit tests.

### Common failure modes

- Adding extensibility or configurability nobody asked for
- Creating abstractions before there are two concrete cases
- Testing that code exists rather than testing that it behaves correctly
- Phases that are pure refactoring or setup with no user-facing progress

## Write an effective spec

Specs should always have the following form:

```markdown
## Problem overview

A couple plain English sentences describing the problem: either a bug, or a feature request, or a refactor to be done with motivation

## Solution overview

A couple plain English sentences describing the proposed solution.

## Goals

High-level end-user stories that must be true when the spec is complete.

## Non-goals

What is deliberately out of scope. Always includes "no migrations or backfills" unless the user requested them.

## Future work

Items identified during implementation that are valuable but non-blocking. Big features, refactors, or cleanup that can be done after the spec is complete. Only added during implementation, not during initial spec creation.

## Important files/docs/websites for implementation

A list of all the files that are involved in the implementation. Also included should be any docs files or external links to documentation. Each doc should be annotated with a brief sentence about what it is (and if its not obvious, why it's relevant).

## Implementation

A phased plan where each phase represents a single commit-sized change (<100 lines). Each phase should be independently committable and leave the codebase in a working state.
```

Each implementation phase must include success criteria as task items alongside the implementation tasks. Success criteria are verifiable assertions: quick checks ("ensure X is in package.json"), unit tests to write and run, or manual user stories. They should be the minimum set needed to confirm the phase is correctly done.

```markdown
### Phase 1: Add gender and age fields to the provider search input schema

- [ ] Add `gender` parameter to `searchProvidersInput` schema in `apps/api/src/tools/searchProviders.ts` as optional `z.enum(["M", "F"])`
- [ ] Add `ageFilter` parameter using structured object with optional `min_age` and `max_age` integer fields
- [ ] Verify `pnpm run typecheck` passes with the new fields
- [ ] Add a unit test that parses input with `gender: "M"` and `ageFilter: { min_age: 30 }` without throwing

### Phase 2: Implement gender and age filtering logic

- [ ] Add gender filtering logic to the database query using `eq(providers.gender, gender)` when gender is provided
- [ ] Add age range filtering logic using `gte(providers.age, min_age)` and `lte(providers.age, max_age)` when age filters are provided
- [ ] Add a unit test querying with `gender: "F"` and assert only female providers are returned
- [ ] Add a unit test querying with `ageFilter: { min_age: 30, max_age: 50 }` and assert results are within range
```

### What to avoid in the spec

- Avoid introducing new infrastructure, abstractions, or optimization work unless explicitly required for the requested outcome.
- Avoid refactor-only phases that do not produce user-visible or test-visible progress.
