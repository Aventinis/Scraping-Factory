#!/usr/bin/env bash
# Issue #346: builds one release bundle — a self-contained single-file
# companion for the given runtime identifier, the unpacked extension, and the
# matching installer scripts — and packs it (.zip for Windows, .tar.gz for
# Linux/macOS, which keeps the executable bits).
#
# Usage: install/build-bundle.sh <rid> <version> [output-dir]
#   rid: win-x64 | linux-x64 | osx-arm64 | osx-x64
# Needs the .NET SDK (cross-publishing for the other operating systems works
# from any host) and `zip` for Windows bundles.
set -euo pipefail

RID="${1:?usage: build-bundle.sh <rid> <version> [output-dir]}"
VERSION="${2:?usage: build-bundle.sh <rid> <version> [output-dir]}"
OUT="${3:-dist}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
BUNDLE="$STAGE/ScrapingFactory"
mkdir -p "$BUNDLE/companion" "$BUNDLE/extension"

# Single file, self-contained (no .NET install needed), compressed to roughly
# halve the size. Deliberately NOT trimmed: the language-module registry finds
# its code generators by reflection, which trimming would break.
dotnet publish "$ROOT/companion/ScrapingFactory.Companion" -c Release -r "$RID" --self-contained true \
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true \
  -p:DebugType=None -p:Version="$VERSION" -o "$BUNDLE/companion" >/dev/null
rm -f "$BUNDLE/companion/"*.staticwebassets.endpoints.json

# The extension as "Load unpacked" wants it: runtime files only.
(cd "$ROOT/extension" && tar -cf - --exclude=node_modules --exclude='*.test.js' --exclude=types \
  --exclude=tsconfig.json --exclude=package.json --exclude=package-lock.json --exclude=coverage .) \
  | tar -xf - -C "$BUNDLE/extension"

# Issue #352: the shipped extension is the release channel — it cannot be
# switched into the development behaviours (plain http to another machine).
# Fails loudly if the line this rewrites ever changes, instead of silently
# shipping a development build.
BUILD_CONFIG="$BUNDLE/extension/shared/build-config.js"
sed -i.bak "s/^  const CHANNEL = 'development';/  const CHANNEL = 'release';/" "$BUILD_CONFIG"
rm -f "$BUILD_CONFIG.bak"
grep -q "^  const CHANNEL = 'release';" "$BUILD_CONFIG" \
  || { echo "build-bundle.sh: could not set the release channel in $BUILD_CONFIG" >&2; exit 1; }

case "$RID" in
  win-*) cp "$ROOT/install/install.ps1" "$ROOT/install/uninstall.ps1" "$BUNDLE/" ;;
  *)     cp "$ROOT/install/install.sh" "$ROOT/install/uninstall.sh" "$BUNDLE/"; chmod +x "$BUNDLE/install.sh" "$BUNDLE/uninstall.sh" ;;
esac
cp "$ROOT/install/INSTALL.md" "$BUNDLE/INSTALL.md"
echo "$VERSION" > "$BUNDLE/VERSION"

NAME="scraping-factory-$VERSION-$RID"
case "$RID" in
  win-*) (cd "$STAGE" && zip -qr "$OUT/$NAME.zip" ScrapingFactory); echo "$OUT/$NAME.zip" ;;
  *)     tar -czf "$OUT/$NAME.tar.gz" -C "$STAGE" ScrapingFactory; echo "$OUT/$NAME.tar.gz" ;;
esac
