#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/prepare-release.sh [patch|minor|major]

Creates a release PR branch from main, bumps packages/libretto/package.json,
bumps packages/affordance/package.json when affordance changed since the last
Libretto release and its current version is already published, pushes the
branch, and opens a pull request targeting main.
EOF
}

bump="${1:-patch}"
package_json_path="packages/libretto/package.json"
package_dir="packages/libretto"
skill_path="packages/libretto/skills/libretto/SKILL.md"
affordance_package_json_path="packages/affordance/package.json"
affordance_dir="packages/affordance"

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
pnpm --filter libretto type-check
pnpm --filter libretto test

current_version="$(node -p "require('./${package_json_path}').version")"
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

affordance_changed=false
affordance_current_version="$(node -p "require('./${affordance_package_json_path}').version")"
affordance_next_version=""

if git rev-parse --verify --quiet "v${current_version}" >/dev/null; then
  if ! git diff --quiet "v${current_version}..HEAD" -- "$affordance_dir"; then
    affordance_changed=true
  fi
else
  echo "Warning: v${current_version} tag not found; skipping automatic affordance change detection." >&2
fi

if [ "$affordance_changed" = true ]; then
  pnpm --filter affordance type-check
  pnpm --filter affordance test

  if npm view "affordance@${affordance_current_version}" version >/dev/null 2>&1; then
    affordance_next_version="$(node -e '
const [major, minor, patch] = process.argv[1].split(".").map(Number)
process.stdout.write([major, minor, patch + 1].join("."))
' "$affordance_current_version")"
  else
    echo "Affordance changed, but affordance@${affordance_current_version} is not published; keeping current affordance version."
  fi
fi

if git show-ref --verify --quiet "refs/heads/${branch_name}"; then
  echo "Local branch ${branch_name} already exists." >&2
  exit 1
fi

if git ls-remote --exit-code --heads origin "${branch_name}" >/dev/null 2>&1; then
  echo "Remote branch ${branch_name} already exists." >&2
  exit 1
fi

git checkout -b "$branch_name"

(
  cd "$package_dir"
  npm version "$next_version" --no-git-tag-version >/dev/null
)

if [ -n "$affordance_next_version" ]; then
  (
    cd "$affordance_dir"
    npm version "$affordance_next_version" --no-git-tag-version >/dev/null
  )
fi

node packages/dev-tools/scripts/set-libretto-skill-version.mjs "$next_version"

pnpm sync:mirrors
pnpm check:mirrors

git add \
  "$package_json_path" \
  "$affordance_package_json_path" \
  packages/libretto/skills/libretto/SKILL.md \
  packages/libretto/skills/libretto-readonly/SKILL.md \
  .agents/skills/libretto \
  .agents/skills/libretto-readonly \
  .claude/skills/libretto \
  .claude/skills/libretto-readonly \
  packages/create-libretto/package.json \
  README.md \
  packages/libretto/README.md
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
$(if [ -n "$affordance_next_version" ]; then echo "- release affordance v${affordance_next_version}"; elif [ "$affordance_changed" = true ]; then echo "- include affordance changes already versioned at v${affordance_current_version}"; fi)

## Verification

- pnpm --filter libretto type-check
- pnpm --filter libretto test
$(if [ "$affordance_changed" = true ]; then echo "- pnpm --filter affordance type-check"; echo "- pnpm --filter affordance test"; fi)
EOF
)"
