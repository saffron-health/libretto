# onlineMind2Web

This folder contains Libretto benchmark cases modeled after Online-Mind2Web.

The first wired case is a single hardcoded public example task from the published
Online-Mind2Web example result:

- task id: `fb7b4f784cfde003e2548fdf4e8d6b4f`
- task: open the Discogs page with an overview of submission guidelines for releases

The implementation intentionally stays thin:

- benchmark task metadata lives in `cases.ts`
- the benchmark itself is a regular Vitest spec
- grading still uses the existing Claude transcript judge from `evals/harness.ts`
