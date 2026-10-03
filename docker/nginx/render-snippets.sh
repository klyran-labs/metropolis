#!/bin/sh
# Renders the nginx security snippets for one profile.
# Usage: render-snippets.sh <production|local> <rpc-url> <source-dir> <destination-dir>
# Used by the web Dockerfiles at image build time and by the CSP verification harness.
set -eu
profile="$1"; rpc_url="$2"; source_dir="$3"; destination="$4"

[ -f "$source_dir/csp.$profile.conf" ] || { echo "Unknown CSP profile" >&2; exit 1; }
mkdir -p "$destination"
cp "$source_dir/security-headers.conf" "$destination/security-headers.conf"
origin="$(printf '%s' "$rpc_url" | sed -E 's#^(https?://[^/]+).*#\1#')"
sed "s#__RPC_ORIGIN__#$origin#g" "$source_dir/csp.$profile.conf" > "$destination/csp.conf"
