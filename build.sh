#!/usr/bin/env bash
# THE LAST ARCHIVE - one command: world -> three archives -> wasm decoders -> game bundle -> TheLastArchive.html (one file).
# Needs: python3 + numpy, g++, an aceapex checkout (ACEAPEX, default ~/pubrepo), zstd 1.5.7 and lz4 1.10.0 sources,
# emscripten (emsdk), node + npm packages three@0.170.0 and esbuild@0.24.0 (npm install in this folder).
# ACEAPEX must be main 8ae26bf or newer (fix: the C99 decoder on 32-bit clang/wasm32). build/out/chr1.aet (shipped) adds GENOME JUMP; CHR1=<chr1.fa> repacks it (needs libzstd).
set -euo pipefail
cd "$(dirname "$0")"
ACEAPEX="${ACEAPEX:-$HOME/pubrepo}"; ZSTD="${ZSTD:-$HOME/pubrepo/.wk/zstd-1.5.7}"; LZ4="${LZ4:-lz4-1.10.0}"
source "${EMSDK_ENV:-$HOME/pubrepo/.wk/emsdk/emsdk_env.sh}" >/dev/null 2>&1
python3 build/gen_world.py
mkdir -p build/z build/out
( cd build/z && gcc -O3 -c -DZSTD_DISABLE_ASM -I"$ZSTD/lib" -I"$ZSTD/lib/common" "$ZSTD"/lib/common/*.c "$ZSTD"/lib/compress/*.c "$ZSTD"/lib/decompress/*.c ) && ar rcs build/libzstd157.a build/z/*.o
g++ -std=c++17 -O2 -march=native -DACEAPEX_ENV_TUNING -I"$ACEAPEX/src" -I"$ZSTD/lib" -I"$LZ4/lib" -o build/pack build/pack.cpp \
    "$ACEAPEX/src/aceapex_api.cpp" "$LZ4/lib/lz4.c" "$LZ4/lib/lz4hc.c" build/libzstd157.a -lpthread
./build/pack build/chunks build/out
python3 tools/assemble_blob.py
emcc -O3 -std=gnu11 -I"$ZSTD/lib" -I"$ACEAPEX/c" -I"$LZ4/lib" -DZSTD_DISABLE_ASM -DZSTD_NO_TRACE -o build/la2_wasm.js wasm/la2_wasm.c \
    "$ACEAPEX/c/aceapex_decode.c" "$LZ4/lib/lz4.c" "$ZSTD"/lib/common/*.c "$ZSTD"/lib/decompress/*.c -sSINGLE_FILE=1 -sMODULARIZE=1 -sEXPORT_NAME=LA2 \
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 -sEXPORTED_FUNCTIONS=_malloc,_free -sEXPORTED_RUNTIME_METHODS=HEAPU8
node_modules/esbuild/bin/esbuild web/src/main.js --bundle --minify --format=iife --target=es2020 --legal-comments=eof --outfile=build/game.js --log-level=warning
if [ -n "${CHR1:-}" ]; then
  g++ -std=c++17 -O2 -march=native -DACEAPEX_ENV_TUNING -I"$ACEAPEX/src" -o build/ax_pack tools/ax_pack.cpp "$ACEAPEX/src/aceapex_api.cpp" -lpthread -lzstd
  LIT_CHUNK=65536 FSE_CHUNK=65536 ./build/ax_pack "$CHR1" build/out/chr1.aet 2 65536
fi
G=""; [ -f build/out/chr1.aet ] && G=build/out/chr1.aet                         # GENOME JUMP: the shipped chr1.aet (see README)
python3 tools/inline.py web/index.html build/la2_wasm.js build/out/la2_data.bin build/game.js TheLastArchive.html $G
