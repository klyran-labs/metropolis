#!/usr/bin/env bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js runtime is required to execute set-privy-role.mjs" >&2
  exit 1
fi

exec node "${SCRIPT_DIR}/set-privy-role.mjs" "$@"
