#!/usr/bin/env bash
# Publish an experimental pre-release of libretto from this machine.
#
# Usage:
#   1. Manually edit packages/libretto/package.json `version` to a pre-release
#      identifier, e.g. "0.6.16-experimental-zod.0". The pre-release identifier
#      (the bit between "-" and ".N") becomes the npm dist-tag.
#   2. Run `pnpm publish:experimental` from the libretto repo root.
#
# Stable releases (no pre-release suffix) MUST go through `pnpm prepare-release`
# instead — this script will refuse to publish a non-pre-release version because
# that would overwrite the `latest` dist-tag without going through the normal
# release PR + CI flow.
set -euo pipefail

package_json_path="packages/libretto/package.json"
package_dir="packages/libretto"

if [ ! -f "$package_json_path" ]; then
  echo "Run this script from the libretto repo root (cannot find ${package_json_path})." >&2
  exit 1
fi

version="$(node -p "require('./${package_json_path}').version")"

if [[ ! "$version" =~ -([^.]+)\.[0-9]+$ ]]; then
  echo "Refusing to publish: version '${version}' is not a pre-release." >&2
  echo "Manually set packages/libretto/package.json version to something like" >&2
  echo "  0.6.16-experimental-zod.0" >&2
  echo "before running this script, or use 'pnpm prepare-release' for stable releases." >&2
  exit 1
fi
dist_tag="${BASH_REMATCH[1]}"

echo "Publishing libretto@${version} under dist-tag '${dist_tag}'."

# Build the package so dist/ is fresh (npm publish ships dist/).
pnpm --filter libretto build

(
  cd "$package_dir"
  # --otp is requested interactively by npm if 2FA is enabled. If you have it
  # ready, run with NPM_CONFIG_OTP=<code> pnpm publish:experimental.
  npm publish --access public --tag "$dist_tag"
)

echo
echo "Published libretto@${version} (dist-tag: ${dist_tag})."
echo "Consumers can pin to it with:"
echo "  \"libretto\": \"${version}\""
echo "or install the latest experimental with:"
echo "  npm install libretto@${dist_tag}"
