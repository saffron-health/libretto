#!/usr/bin/env bash

set -euo pipefail

readonly BASE_URL="${LIBRETTO_BASE_URL:-https://libretto.sh}"
readonly INSTALL_DIR="${LIBRETTO_INSTALL_DIR:-/usr/local/bin}"
readonly DATA_DIR="${LIBRETTO_DATA_DIR:-${HOME}/.libretto/native}"
readonly REQUESTED_VERSION="${LIBRETTO_VERSION:-latest}"
readonly PACKAGE_NAME="${LIBRETTO_PACKAGE:-libretto}"

if [[ "${REQUESTED_VERSION}" != "latest" && ! "${REQUESTED_VERSION}" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  printf 'error: invalid version "%s" -- expected "latest" or a semver like "1.2.3" or "v1.2.3"\n' "${REQUESTED_VERSION}" >&2
  exit 1
fi

function info() {
  printf '==> %s\n' "$*" >&2
}

function warn() {
  printf 'warning: %s\n' "$*" >&2
}

function fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

function require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || fail "Missing required command: ${command_name}"
}

function normalize_version() {
  local version="$1"
  if [[ "${version}" == v* ]]; then
    printf '%s\n' "${version#v}"
  else
    printf '%s\n' "${version}"
  fi
}

function display_version() {
  local version="$1"
  printf 'v%s\n' "$(normalize_version "${version}")"
}

function resolve_version() {
  if [[ "${REQUESTED_VERSION}" == "latest" ]]; then
    npm view "${PACKAGE_NAME}@latest" version 2>/dev/null | tr -d '[:space:]'
  else
    normalize_version "${REQUESTED_VERSION}"
  fi
}

function install_shim() {
  local shim_path="$1"
  local destination_path="${INSTALL_DIR}/libretto"

  if mkdir -p "${INSTALL_DIR}" 2>/dev/null && install -m 0755 "${shim_path}" "${destination_path}" 2>/dev/null; then
    return
  fi

  cat >&2 <<EOF
error: Could not install the Libretto command to ${destination_path}

The installer could not create or write to ${INSTALL_DIR}. This usually means the
directory is owned by another user or requires administrator permissions.

Choose a directory you can write to and re-run the installer with LIBRETTO_INSTALL_DIR:

  curl -fsSL "${BASE_URL}/install.sh" | LIBRETTO_INSTALL_DIR="\$HOME/.local/bin" bash

Then make sure that directory is on your PATH.
EOF
  exit 1
}

require_command node
require_command npm
require_command mktemp
require_command install

VERSION="$(resolve_version)"
readonly VERSION
[[ -n "${VERSION}" ]] || fail "Could not resolve the latest Libretto version from npm"

DISPLAY_VERSION="$(display_version "${VERSION}")"
readonly DISPLAY_VERSION
INSTALL_PREFIX="${DATA_DIR}/${DISPLAY_VERSION}"
readonly INSTALL_PREFIX
PACKAGE_BIN="${INSTALL_PREFIX}/bin/libretto"
readonly PACKAGE_BIN

TMP_DIR="$(mktemp -d)"
readonly TMP_DIR
trap 'rm -rf "${TMP_DIR}"' EXIT

info "Installing Libretto ${DISPLAY_VERSION} with npm"
mkdir -p "${INSTALL_PREFIX}"
npm install --global --prefix "${INSTALL_PREFIX}" "${PACKAGE_NAME}@${VERSION}"

[[ -x "${PACKAGE_BIN}" ]] || fail "npm did not create an executable at ${PACKAGE_BIN}"

SHIM_PATH="${TMP_DIR}/libretto"
readonly SHIM_PATH
{
  printf '#!/usr/bin/env bash\n'
  printf 'exec %q "$@"\n' "${PACKAGE_BIN}"
} > "${SHIM_PATH}"

install_shim "${SHIM_PATH}"

cat >&2 <<'BANNER'

 ██╗     ██╗██████╗ ██████╗ ███████╗████████╗████████╗ ██████╗
 ██║     ██║██╔══██╗██╔══██╗██╔════╝╚══██╔══╝╚══██╔══╝██╔═══██╗
 ██║     ██║██████╔╝██████╔╝█████╗     ██║      ██║   ██║   ██║
 ██║     ██║██╔══██╗██╔══██╗██╔══╝     ██║      ██║   ██║   ██║
 ███████╗██║██████╔╝██║  ██║███████╗   ██║      ██║   ╚██████╔╝
 ╚══════╝╚═╝╚═════╝ ╚═╝  ╚═╝╚══════╝   ╚═╝      ╚═╝    ╚═════╝

BANNER

printf '  Installed Libretto %s to %s/libretto\n\n' "${DISPLAY_VERSION}" "${INSTALL_DIR}" >&2

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    warn "${INSTALL_DIR} is not on your PATH. Add it before running libretto."
    printf '\n' >&2
    ;;
esac

cat >&2 <<'NEXT'
  Get started:

    libretto setup                    Set up browsers and agent skills
    libretto open https://example.com Open a browser session
    libretto snapshot                 Inspect the current page
    libretto run ./workflow.ts        Run a workflow
    libretto --help                   See all available commands

NEXT
