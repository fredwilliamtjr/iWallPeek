#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ARCH="${1:-arm64}"
case "$ARCH" in
  arm64|x86_64) SLICES=("$ARCH") ;;
  universal) SLICES=(arm64 x86_64) ;;
  *) echo 'Arquitetura inválida (use arm64, x86_64 ou universal)'; exit 1 ;;
esac
VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' Info.plist)
mkdir -p dist
TASK_STAGE=$(mktemp -d "${TMPDIR:-/tmp}/iwallpeek-build.XXXXXX")
trap 'rm -rf "$TASK_STAGE"' EXIT
BINARIES=()
for slice in "${SLICES[@]}"; do
  # Separate scratch dir per arch: SwiftPM's build db breaks when --arch alternates in one .build.
  swift build -c release --arch "$slice" --scratch-path ".build/$slice"
  BINARIES+=("$(swift build -c release --arch "$slice" --scratch-path ".build/$slice" --show-bin-path)/iWallPeek")
done
APP="$TASK_STAGE/iWallPeek.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
# Universal: one Mach-O with both slices, so the same app runs on Intel and Apple Silicon.
lipo -create "${BINARIES[@]}" -output "$APP/Contents/MacOS/iWallPeek"
for slice in "${SLICES[@]}"; do
  lipo "$APP/Contents/MacOS/iWallPeek" -verify_arch "$slice"
done
cp Info.plist "$APP/Contents/"
cp LICENSE "$APP/Contents/Resources/LICENSE-DailyWalls.txt"
cp NOTICE.md "$APP/Contents/Resources/NOTICE.md"
cp -R THIRD_PARTY_LICENSES "$APP/Contents/Resources/"
swift scripts/icon.swift "$TASK_STAGE/icon.png"
mkdir "$TASK_STAGE/AppIcon.iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$TASK_STAGE/icon.png" --out "$TASK_STAGE/AppIcon.iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$TASK_STAGE/icon.png" --out "$TASK_STAGE/AppIcon.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$TASK_STAGE/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns"
codesign --force --sign - --options runtime --entitlements Entitlements.plist "$APP"
codesign --verify --deep --strict "$APP"
# Replace only our generated output. Never installs or stops an existing app.
if [ -e dist/iWallPeek.app ]; then
  test -f dist/iWallPeek.app/Contents/Info.plist
  test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' dist/iWallPeek.app/Contents/Info.plist)" = 'com.smartfull.iWallPeek'
  rm -rf dist/iWallPeek.app
fi
ditto "$APP" dist/iWallPeek.app
mkdir "$TASK_STAGE/dmg"
ditto "$APP" "$TASK_STAGE/dmg/iWallPeek.app"
ln -s /Applications "$TASK_STAGE/dmg/Applications"
cp TESTAR.md "$TASK_STAGE/dmg/LEIA-ME.txt"
hdiutil create -volname iWallPeek -srcfolder "$TASK_STAGE/dmg" -format UDZO -ov "dist/iWallPeek-${VERSION}-${ARCH}.dmg"
hdiutil verify "dist/iWallPeek-${VERSION}-${ARCH}.dmg"
shasum -a 256 "dist/iWallPeek-${VERSION}-${ARCH}.dmg" > "dist/iWallPeek-${VERSION}-${ARCH}.dmg.sha256"
