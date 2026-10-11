#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
CHECK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/iwallpeek-check.XXXXXX")
trap 'rm -rf "$CHECK_DIR"' EXIT
swiftc -parse-as-library Sources/iWallPeek/Security.swift Sources/iWallPeek/WallpaperService.swift Sources/iWallPeek/AllSpaces.swift Sources/iWallPeek/Library.swift scripts/verify.swift -o "$CHECK_DIR/verify"
"$CHECK_DIR/verify"
