#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/prepare-release.sh [patch|minor|major]

Creates a release PR branch from main, bumps package.json, pushes the branch,
and opens a pull request targeting main.
EOF
}

bump="${1:-patch}"

case "$bump" in
  patch|minor|major)
    ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    echo "Invalid bump type: $bump" >&2
    usage >&2
    exit 1
    ;;
esac

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree must be clean before preparing a release." >&2
  exit 1
fi

current_branch="$(git branch --show-current)"
if [ "$current_branch" != "main" ]; then
  echo "Switching from $current_branch to main."
fi

git fetch origin
git checkout main
git pull --ff-only origin main

pnpm install --frozen-lockfile
pnpm type-check
pnpm test

current_version="$(node -p "require('./package.json').version")"
next_version="$(node -e '
const [major, minor, patch] = process.argv[1].split(".").map(Number)
const bump = process.argv[2]

let next
if (bump === "major") next = [major + 1, 0, 0]
else if (bump === "minor") next = [major, minor + 1, 0]
else next = [major, minor, patch + 1]

process.stdout.write(next.join("."))
' "$current_version" "$bump")"
branch_name="release-v${next_version}"

if git show-ref --verify --quiet "refs/heads/${branch_name}"; then
  echo "Local branch ${branch_name} already exists." >&2
  exit 1
fi

if git ls-remote --exit-code --heads origin "${branch_name}" >/dev/null 2>&1; then
  echo "Remote branch ${branch_name} already exists." >&2
  exit 1
fi

npm version "$next_version" --no-git-tag-version >/dev/null

git checkout -b "$branch_name"
git add package.json
git commit -m "release: v${next_version}"
git push -u origin "$branch_name"

gh pr create \
  --base main \
  --head "$branch_name" \
  --title "release: v${next_version}" \
  --label release \
  --body "$(cat <<EOF
## Summary

- release libretto v${next_version}

## Verification

- pnpm type-check
- pnpm test
EOF
)"
