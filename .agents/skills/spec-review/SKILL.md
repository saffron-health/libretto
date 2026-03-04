---
name: spec-review
description: Review a spec for under-specified areas, bugs, and adherence to the generate-spec skill. Use when asked to review, critique, or check a spec.
---

Review the spec the user points you to. Follow these steps in order.

## Step 1: Read the spec and the generate-spec skill

Read the spec file the user references. Then read `.agents/skills/generate-spec/SKILL.md` to understand the requirements specs must meet.

## Step 2: Research the codebase

Use sub-agents to read every file listed in the spec's "Important files" section. For each file, understand its current state well enough to evaluate whether the spec's proposed changes are correct and complete.

If the spec references external libraries or APIs, look up their documentation.

## Step 3: Evaluate

Assess the spec against three categories. For each finding, cite the specific spec line or section and the relevant source file and line number.

### Under-specified areas

Find places where the spec leaves ambiguous decisions that should have explicit design intent from the user. Examples:

- A phase says "update the handler" but two handlers exist and the spec does not say which one
- A schema change is described but the migration path for existing data on disk is not addressed
- A new dependency is introduced between two modules but the spec does not state which module owns the interface
- Error handling or edge cases are not mentioned for a path that can clearly fail
- The spec describes behavior but does not specify what happens when the precondition is not met

Do not flag things that are obviously implied by context. Flag things where a reasonable implementer would have to guess.

### Bugs

Find **design-level** logical errors — things that would send an implementer down the wrong path or produce incorrect behavior that tooling won't catch. Examples:

- A phase deletes a module but a later phase depends on the concept it provided (not just the import — the typecheck catches that)
- The spec contradicts its own goals or non-goals (e.g., says "calendar support later" but removes the only calendar mechanism without acknowledging it)
- A fan-out loop creates sessions but nothing deduplicates if the same event matches the same trigger twice
- The spec assumes a data shape or behavior that doesn't match reality in the codebase

Do **not** flag:

- Missing imports/exports — the typechecker catches these
- Exact function signatures or parameter mismatches — the implementer will resolve these during development
- Test assertion details — the test runner catches these
- Wiring specifics that are obvious from context (e.g., "this function isn't exported yet" — that's an implementation detail, not a spec concern)

### Adherence to generate-spec skill

Check whether the spec follows the structure and principles in `generate-spec/SKILL.md`:

- Does it have all required sections (problem overview, solution overview, goals, non-goals, important files, implementation)?
- Is each phase commit-sized (under 100 lines of change)?
- Does each phase have success criteria that verify the thing most likely to go wrong?
- Does the spec avoid speccing extensibility, abstraction layers, or polish that nobody asked for?
- Are there phases that are pure setup or refactoring with no user-facing progress?
- Is the sanity checklist present and correct?
- Does the spec represent the simplest version that works end-to-end?

Do **not** check whether guiding questions were asked — the reviewer does not have context about the conversation that produced the spec. Assume all decisions in the spec were intentional.

## Step 4: Structure your response

Use this format:

```markdown
# Spec Review: [spec title]

## Under-specified

- [Finding with spec section reference and source file reference]

## Bugs

- [Finding with spec section reference and source file reference]

## Adherence

- [Finding referencing specific generate-spec requirement]

## Verdict

[2-3 sentences. State whether the spec is ready to implement, needs minor clarifications, or needs significant rework.]
```

If a category has no findings, write "None" under it.

## Principles

- **Review the plan, not the implementation.** A spec is a design document, not a line-by-line coding guide. Don't flag things that tooling (typechecker, linter, test runner) will catch during implementation. Focus on decisions that, if wrong, would waste significant time or produce incorrect behavior.
- Be specific. Every finding must reference a spec section and a source file or generate-spec requirement.
- Be conservative. Only flag things that would cause an implementer to go down the wrong path, produce a design-level bug, or violate an explicit generate-spec rule.
- Do not suggest scope additions. The goal is to find holes in the existing scope, not to expand it.
- Do not comment on writing style or formatting unless it violates generate-spec structure requirements.
