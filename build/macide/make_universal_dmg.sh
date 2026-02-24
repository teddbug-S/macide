#!/usr/bin/env bash
# shellcheck disable=SC1091
#
# Creates a macOS Universal (fat) binary DMG by merging x64 and arm64 builds.
# Called by the macide-build.yml CI after both arch artifacts are available.
#
# Inputs (from environment or argument):
#   RELEASE_VERSION — e.g. "1.0.0"
#   APP_NAME        — e.g. "Macide"
#   assets-x64/     — directory containing x64 .zip
#   assets-arm64/   — directory containing arm64 .zip
#
# Output:
#   assets/<APP_NAME>-darwin-universal-<VERSION>.dmg

set -euo pipefail

APP="${APP_NAME:-Macide}"
VERSION="${RELEASE_VERSION:-dev}"
DST="assets"
mkdir -p "${DST}"

echo "=== Universal DMG: merging x64 + arm64 ==="

# Find the app bundles
X64_ZIP=$(find assets-x64 -name "*.zip" | head -1)
ARM64_ZIP=$(find assets-arm64 -name "*.zip" | head -1)

if [[ -z "${X64_ZIP}" || -z "${ARM64_ZIP}" ]]; then
  echo "[ERROR] Could not find both architecture ZIPs"
  exit 1
fi

# Extract both
WORK=$(mktemp -d)
unzip -q "${X64_ZIP}"   -d "${WORK}/x64"
unzip -q "${ARM64_ZIP}" -d "${WORK}/arm64"

X64_APP=$(find "${WORK}/x64"   -name "${APP}.app" -maxdepth 2 | head -1)
ARM64_APP=$(find "${WORK}/arm64" -name "${APP}.app" -maxdepth 2 | head -1)

if [[ -z "${X64_APP}" || -z "${ARM64_APP}" ]]; then
  echo "[ERROR] Could not locate .app bundles"
  exit 1
fi

echo "  x64   app: ${X64_APP}"
echo "  arm64 app: ${ARM64_APP}"

# Use lipo to merge all native binaries
UNIVERSAL_APP="${WORK}/universal/${APP}.app"
cp -R "${X64_APP}" "${UNIVERSAL_APP}"

find "${X64_APP}" -type f | while read -r f; do
  REL="${f#${X64_APP}/}"
  ARM64_F="${ARM64_APP}/${REL}"
  UNIV_F="${UNIVERSAL_APP}/${REL}"

  if [[ -f "${ARM64_F}" ]]; then
    # Try lipo merge (succeeds for Mach-O, silently uses x64 for non-binary)
    if file "${f}" | grep -q "Mach-O"; then
      lipo -create "${f}" "${ARM64_F}" -output "${UNIV_F}" 2>/dev/null || \
        cp "${f}" "${UNIV_F}"
    fi
  fi
done

# Package into DMG
DMG_OUT="${DST}/${APP}-darwin-universal-${VERSION}.dmg"
npx create-dmg "${UNIVERSAL_APP}" "${WORK}" 2>/dev/null && \
  mv "${WORK}"/*.dmg "${DMG_OUT}" || \
  echo "[WARN] create-dmg not available; skipping DMG creation"

# Always produce a universal ZIP
zip -r -X -y "${DST}/${APP}-darwin-universal-${VERSION}.zip" "${UNIVERSAL_APP}"

rm -rf "${WORK}"
echo "=== Universal DMG: done ==="
