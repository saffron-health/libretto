# Releasing Libretto

## For people

1. From the repository root, run `pnpm prepare-release patch` (or `minor`/`major`). This pulls `main`, runs tests, bumps `packages/libretto/package.json`, and opens a release PR.
2. Wait for CI and evals to finish on the PR. Review the eval summary comment.
3. Merge the PR. GitHub Actions will automatically publish to npm and create the GitHub release.

Only admins with merge access to `main` can trigger a release. The release workflow runs on push to `main`, so branch protection is the access control — there is no separate approval step.

---

## For agents

Libretto uses a simple release flow:

1. Create a release PR from `main`.
2. Merge the PR into `main`.
3. Let GitHub Actions publish the package and create the GitHub release.

This repo does not publish from local machines and does not push directly to `main`.

## Requirements

GitHub Actions needs these repository secrets:

- `OPENAI_API_KEY`: used by the existing test suite during the release workflow.

The release workflow uses a GitHub Actions environment named `release`. Create that environment in the repository settings (no required reviewers — access is controlled by branch protection on `main` instead).

On npm, configure `libretto` to trust this repository and workflow for publishing. The trusted publisher fields should match:

- Organization or user: `saffron-health`
- Repository: `libretto`
- Workflow filename: `release.yml`
- Environment name: `release`

If you prefer the CLI, the setup command is:

```bash
npm trust github libretto --repo saffron-health/libretto --file release.yml --env release
```

Trusted publishing only works on supported cloud-hosted runners. This workflow uses `ubuntu-latest`, which satisfies that requirement. npm also requires a recent toolchain for trusted publishing, so the publish job runs on Node 24.

The workflow needs `contents: write` to create the GitHub release and tag, and `id-token: write` so npm trusted publishing can exchange the GitHub OIDC token for a short-lived publish credential.

After trusted publishing is working, remove any old npm publish token from the repo secrets. npm recommends restricting token-based publishing after the migration.

GitHub release notes are auto-generated from merged pull requests. The release note categories live in `.github/release.yml`, so PR labels control where entries show up in the changelog.

## Prepare a release PR

Run one of these from a clean working tree:

```bash
pnpm prepare-release patch
pnpm prepare-release minor
pnpm prepare-release major
```

The root `scripts/prepare-release.sh` script does the following:

1. Checks that the working tree is clean.
2. Updates local `main` from `origin/main`.
3. Runs `pnpm install --frozen-lockfile`, `pnpm --filter libretto type-check`, and `pnpm --filter libretto test`.
4. Bumps the version in `packages/libretto/package.json`.
5. Creates a release branch.
6. Commits the version bump.
7. Pushes the branch and opens a PR to `main` with the `release` label.

Release PRs also run the eval workflow. That workflow compares the current eval score against the latest successful `main` baseline and fails if the score drifts by more than 5 percentage points in either direction.

## Merge behavior

After the release PR merges, `.github/workflows/release.yml` runs on `main`.

The workflow:

1. Reads the version from `packages/libretto/package.json`.
2. Checks whether that version already exists on npm and in GitHub Releases.
3. Runs install, type-check, and tests for the `libretto` package in a verification job.
4. Publishes `libretto@X.Y.Z` to npm from `packages/libretto` with trusted publishing if it is not already published.
5. Creates GitHub release `vX.Y.Z` with generated release notes if it does not already exist.

This makes the workflow safe to re-run after partial failures. For example, if npm publish succeeds but GitHub release creation fails, a re-run will skip npm and only create the missing release.

## Eval gating on release PRs

`.github/workflows/evals.yml` now runs automatically for release PRs and for qualifying pushes to `main`.

- On `main`, it records the current eval summary as the baseline artifact for future release PRs.
- On release PRs, it runs evals again and compares the overall score against the latest successful `main` baseline.
- If the score moves outside a `+/-5%` window, the eval job fails and flags the release PR.

If no successful baseline artifact exists yet, the release PR eval job reports that and skips the comparison for that run.

## Changelog behavior

The GitHub Releases page is the changelog for this repo.

When the workflow runs `gh release create ... --generate-notes`, GitHub builds the release notes from the merged PRs since the previous release. `.github/release.yml` groups PRs into sections such as Features, Fixes, and Documentation.

Today the categories map directly to labels that already exist in the repo:

- `enhancement` -> Features
- `bug` -> Fixes
- `documentation` -> Documentation

To keep release notes readable, use clear PR titles and apply one of those labels before merging. If a PR should not appear in the changelog, add the `skip-changelog` label.

## Notes

- Protect `main` in GitHub settings. Branch protection is the primary control that limits who can merge release-triggering commits into `main`. Restrict merge access to admins.
- Only merge a release PR when `main` is ready to ship.
- Do not create git tags in the PR branch. Tags are created by the release workflow after merge.
- Release notes are AI-generated from merged PRs by `scripts/generate-changelog.ts`.
