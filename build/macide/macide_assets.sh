#!/usr/bin/env bash
# shellcheck disable=SC1091
#
# Macide-specific asset compilation steps (spec §11.3).
# Run as part of the main build pipeline, after prepare_vscode.sh and
# before the platform gulp build command.
#
# Steps:
#   1. Compile macide-core extension TypeScript
#   2. Bake the Obsidian Flow color theme JSON into the output directory
#   3. Subset Geist fonts to the characters used by Macide webviews
#   4. Pre-extract bundled Copilot VSIX files so first launch is instant
#   5. Write build metadata (version, commit, date) into a manifest file
#
# Environment variables:
#   RELEASE_VERSION   — e.g. "1.0.0"
#   VSCODE_ARCH       — e.g. "x64", "arm64"
#   CI_BUILD          — "yes" | "no"
#   SHOULD_BUILD      — "yes" | "no"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "=== Macide Assets: start ==="
echo "  RELEASE_VERSION = ${RELEASE_VERSION:-dev}"
echo "  VSCODE_ARCH     = ${VSCODE_ARCH:-native}"

# ---------------------------------------------------------------------------
# 1. Compile macide-core TypeScript extension
# ---------------------------------------------------------------------------

EXTENSION_DIR="${REPO_ROOT}/src/stable/extensions/macide-core"

if [[ -f "${EXTENSION_DIR}/tsconfig.json" ]]; then
  echo "--- Compiling macide-core extension ---"
  pushd "${EXTENSION_DIR}" > /dev/null
  npm install --prefer-offline 2>&1 | tail -5
  npm run compile
  popd > /dev/null
else
  echo "[WARN] macide-core tsconfig.json not found — skipping compile"
fi

# ---------------------------------------------------------------------------
# 2. Bake Obsidian Flow color theme
# ---------------------------------------------------------------------------

THEME_SRC="${REPO_ROOT}/src/macide/theme/obsidianFlow.json"
THEME_DST="${EXTENSION_DIR}/out/theme/obsidianFlow.json"

if [[ -f "${THEME_SRC}" ]]; then
  echo "--- Baking Obsidian Flow theme ---"
  mkdir -p "$(dirname "${THEME_DST}")"
  # Pretty-print → compact to save bytes
  node -e "
    const d = JSON.parse(require('fs').readFileSync('${THEME_SRC}', 'utf-8'));
    require('fs').writeFileSync('${THEME_DST}', JSON.stringify(d));
  " 2>/dev/null || cp "${THEME_SRC}" "${THEME_DST}"
  SIZE=$(wc -c < "${THEME_DST}")
  echo "  theme written: ${SIZE} bytes"
else
  echo "[WARN] obsidianFlow.json not found at ${THEME_SRC}"
fi

# ---------------------------------------------------------------------------
# 3. Subset Geist fonts (requires fonttools / pyftsubset if available)
#    Only runs when pyftsubset is installed — silently skips otherwise.
#    The full Geist variable fonts already ship in the repo; subsetting is
#    a size-optimisation for production builds.
# ---------------------------------------------------------------------------

FONTS_SRC="${REPO_ROOT}/src/macide"
FONTS_DST="${EXTENSION_DIR}/out/fonts"
mkdir -p "${FONTS_DST}"

if command -v pyftsubset &>/dev/null; then
  # Unicode ranges for ASCII + Latin Extended-A (covers Geist webview usage)
  UNICODES="U+0020-007E,U+00A0-017E,U+2018,U+2019,U+201C,U+201D,U+2026,U+2192,U+2713,U+26A0"
  echo "--- Subsetting Geist fonts ---"
  for TTF in "${FONTS_SRC}"/**/*.ttf 2>/dev/null || true; do
    [[ -f "${TTF}" ]] || continue
    BASE=$(basename "${TTF}" .ttf)
    pyftsubset "${TTF}" \
      --unicodes="${UNICODES}" \
      --output-file="${FONTS_DST}/${BASE}-subset.ttf" \
      --flavor=woff2 \
      --desubroutinize \
      2>/dev/null && echo "  subset: ${BASE}" || true
  done
else
  echo "[SKIP] pyftsubset not found — copying fonts as-is"
  find "${FONTS_SRC}" -name "*.ttf" -o -name "*.woff2" 2>/dev/null | while read -r f; do
    cp "${f}" "${FONTS_DST}/" 2>/dev/null || true
  done
fi

# ---------------------------------------------------------------------------
# 4. Pre-extract bundled Copilot VSIX files
#    Looks for copilot*.vsix in the repo's extensions/ cache and unzips them
#    so the extension host doesn't need to do it at first launch.
# ---------------------------------------------------------------------------

VSIX_DIR="${REPO_ROOT}/vscode/.build/extensions"
EXTRACT_MARKER="${VSIX_DIR}/.macide-preextracted"

if [[ -d "${VSIX_DIR}" && ! -f "${EXTRACT_MARKER}" ]]; then
  echo "--- Pre-extracting Copilot VSIXs ---"
  find "${VSIX_DIR}" -maxdepth 1 -name "*.vsix" | while read -r vsix; do
    NAME=$(basename "${vsix}" .vsix)
    DEST="${VSIX_DIR}/${NAME}"
    if [[ ! -d "${DEST}" ]]; then
      mkdir -p "${DEST}"
      unzip -q "${vsix}" -d "${DEST}" 2>/dev/null && \
        echo "  extracted: ${NAME}" || \
        echo "[WARN] failed to extract ${vsix}"
    fi
  done
  touch "${EXTRACT_MARKER}"
else
  echo "[SKIP] VSIX pre-extraction (already done or dir not found)"
fi

# ---------------------------------------------------------------------------
# 5. Write build metadata manifest
# ---------------------------------------------------------------------------

META_FILE="${EXTENSION_DIR}/out/build-meta.json"
mkdir -p "$(dirname "${META_FILE}")"

GIT_COMMIT=$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "${META_FILE}" <<EOF
{
  "version": "${RELEASE_VERSION:-dev}",
  "arch": "${VSCODE_ARCH:-native}",
  "commit": "${GIT_COMMIT}",
  "buildDate": "${BUILD_DATE}",
  "channel": "stable"
}
EOF
echo "--- Build manifest written: ${META_FILE} ---"

echo "=== Macide Assets: done ==="
