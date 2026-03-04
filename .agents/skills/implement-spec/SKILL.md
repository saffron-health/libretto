---
name: implement-spec
description: Implement a single phase of a spec. Use when given a spec file and a phase number to implement.
---

Implement the specified phase of the given spec file.

Ultrathink. Follow these steps:

## 1. Read and understand the spec

Read the entire spec file. Understand the problem overview, solution overview, goals, and non-goals. Pay close attention to the phase you've been asked to implement.

## 2. Read all important files

Read every file listed in the "Important files/docs/websites for implementation" section of the spec. Also read any external documentation links. Do not start writing code until you thoroughly understand the existing codebase and how your changes fit in.

## 3. Implement the phase

Work through every task item in the phase, including all success criteria (tests, typechecks, lint checks). A phase is not complete until every task item is done, including running any verification steps.

Run `pnpm run typecheck`, `pnpm test`, and `pnpm run lint` after implementation to catch issues.

## 4. Verify goals

Check the spec's Goals section. If the phase you just implemented should complete any of those goals, explicitly verify them through integration tests or manual testing of the Electron app using Playwright (see AGENTS.md for Playwright instructions). Do not consider the phase done until achieved goals are verified end-to-end.

## 5. Mark tasks complete

Mark all completed task items in the spec as done (`- [x]`) before presenting to the user.

## 6. Do not commit

When you're done, do **not** stage or commit your changes. Present the completed work to the user for manual review. The user may request changes.

## 7. Handle user feedback

If the user asks for changes, implement them. Iterate until the user is satisfied.

## 8. Update the spec before committing

Once the user approves and asks you to commit:

1. **Update the spec** to reflect what was actually implemented. If the implementation deviated from what was originally specced (e.g. the user asked for a different approach), overwrite the phase content in the spec to match what was done. The spec should always reflect the current state of the codebase, not the original plan.
2. **Check downstream phases.** If your spec changes affect later phases, ask the user whether you should update those phases too.
3. Then commit both the implementation and the updated spec together.

## 9. Future work

If during implementation you identify work that is not blocking but would be valuable later (big features, refactors, cleanup), propose adding it to a "Future work" section in the spec, placed above the "Important files" section. Confirm with the user before adding.

If the work is blocking (the app is broken without it), it should be done as part of the current spec — either in this phase or added to a subsequent phase.

## 10. Handoff

When the user asks you to hand off to the next phase, include in the handoff summary a note to load the `implement-spec` skill.
