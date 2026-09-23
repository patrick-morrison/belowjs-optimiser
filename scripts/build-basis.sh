#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA=99f52d63aa6799cbdaecfe977111dc5ec3b31d47
ARCHIVE_SHA=82fa2a5f3344d55ef97c6b3823ceee3588e912281cf72e7b6d6a0bcd5ab0c490
WORK="${BASIS_BUILD_DIR:-/tmp/below-basis-build}"
MODE="${1:-single}"
case "$MODE" in
  single) TARGET=basis_encoder ;;
  threads) TARGET=basis_encoder_threads ;;
  wasm64) TARGET=basis_encoder_threads_wasm64 ;;
  *) printf 'Usage: %s [single|threads|wasm64]\n' "$0"; exit 1 ;;
esac
mkdir -p "$WORK" "$ROOT/test/output/basis-candidate"
if [ ! -f "$WORK/source.tar.gz" ]; then
  curl -fL "https://codeload.github.com/BinomialLLC/basis_universal/tar.gz/$SHA" -o "$WORK/source.tar.gz"
fi
printf '%s  %s\n' "$ARCHIVE_SHA" "$WORK/source.tar.gz" | shasum -a 256 -c -
SOURCE="$WORK/basis_universal-$SHA"
PATCH_SHA="$(shasum -a 256 "$ROOT/scripts/prepare-basis.mjs" | cut -d ' ' -f 1)"
if [ ! -f "$SOURCE/.below-patched" ] || [ "$(< "$SOURCE/.below-patched")" != "$PATCH_SHA" ]; then
  tar -xzf "$WORK/source.tar.gz" -C "$WORK"
  node "$ROOT/scripts/prepare-basis.mjs" "$SOURCE"
  printf '%s\n' "$PATCH_SHA" > "$SOURCE/.below-patched"
fi
emcc --version
emcmake cmake -S "$SOURCE/webgl/encoder" -B "$WORK/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5
cmake --build "$WORK/build" --target "$TARGET.js" --parallel "${BASIS_BUILD_JOBS:-4}"
cp "$WORK/build/$TARGET.js" "$WORK/build/$TARGET.wasm" "$ROOT/test/output/basis-candidate/"
# Emscripten versions that emit a separate pthread bootstrap need it beside the JS.
if [ -f "$WORK/build/$TARGET.worker.js" ]; then
  cp "$WORK/build/$TARGET.worker.js" "$ROOT/test/output/basis-candidate/"
fi
shasum -a 256 "$ROOT/test/output/basis-candidate/$TARGET."*
