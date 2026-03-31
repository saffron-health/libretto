#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/prepare-release.sh [patch|minor|major]

Creates a release PR branch from main, bumps the Libretto package versions,
updates the skill metadata version, pushes the branch, and opens a pull
request targeting main.
EOF
}

bump="${1:-patch}"
libretto_package_json_path="packages/libretto/package.json"
create_package_json_path="packages/create-libretto/package.json"
skill_path="packages/libretto/skills/libretto/SKILL.md"

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
pnpm check:mirrors
pnpm --filter create-libretto type-check
pnpm --filter libretto type-check
pnpm --filter libretto test

current_version="$(node -p "require('./${libretto_package_json_path}').version")"
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

git checkout -b "$branch_name"

for package_dir in "packages/libretto" "packages/create-libretto"; do
  (
    cd "$package_dir"
    npm version "$next_version" --no-git-tag-version >/dev/null
  )
done

node packages/dev-tools/scripts/set-libretto-skill-version.mjs "$next_version"

pnpm sync:mirrors
pnpm check:mirrors

git add \
  "$libretto_package_json_path" \
  "$create_package_json_path" \
  "$skill_path" \
  README.md \
  packages/libretto/README.md \
  .agents/skills/libretto \
  .claude/skills/libretto
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
- release create-libretto v${next_version}

## Verification

- pnpm check:mirrors
- pnpm --filter create-libretto type-check
- pnpm --filter libretto type-check
- pnpm --filter libretto test
EOF
)"
