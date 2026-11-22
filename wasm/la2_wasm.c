/* la2_wasm.c - the three decoders of THE LAST ARCHIVE in WebAssembly: ACEAPEX (C99 decoder, region read on a
 * persistent handle), zstd 1.5.7, LZ4 1.10; plus sha256 to verify every restored chunk. JS owns the memory layout. */
#include <emscripten.h>
#include <stdint.h>
#include <string.h>
#include "aceapex_decode.h"
#include <zstd.h>
#include "lz4.h"
#include "aw_common.h"

static aceapex_dec_t* AX;
static ZSTD_DCtx* ZC;
EMSCRIPTEN_KEEPALIVE int ax_open(const uint8_t* p, size_t n){ if (AX) aceapex_dec_close(AX); AX = aceapex_dec_open(p, n); return AX ? 0 : -1; }
EMSCRIPTEN_KEEPALIVE double ax_region(uint8_t* dst, double off, double len){ return AX ? (double)aceapex_dec_region(AX, dst, (size_t)len, (uint64_t)off, (uint64_t)len) : -1; }
EMSCRIPTEN_KEEPALIVE double zstd_dec(const uint8_t* src, size_t sn, uint8_t* dst, size_t dn){
    if (!ZC) ZC = ZSTD_createDCtx(); size_t r = ZSTD_decompressDCtx(ZC, dst, dn, src, sn); return ZSTD_isError(r) ? -1 : (double)r; }
EMSCRIPTEN_KEEPALIVE int lz4_dec(const char* src, int sn, char* dst, int dn){ return LZ4_decompress_safe(src, dst, sn, dn); }
static aceapex_dec_t* GX;                                                         /* the genome archive: its own handle */
EMSCRIPTEN_KEEPALIVE int gx_open(const uint8_t* p, size_t n){ if (GX) aceapex_dec_close(GX); GX = aceapex_dec_open(p, n); return GX ? 0 : -1; }
EMSCRIPTEN_KEEPALIVE double gx_size(void){ return GX ? (double)aceapex_dec_size(GX) : -1; }
EMSCRIPTEN_KEEPALIVE double gx_region(uint8_t* dst, double off, double len){ return GX ? (double)aceapex_dec_region(GX, dst, (size_t)len, (uint64_t)off, (uint64_t)len) : -1; }
EMSCRIPTEN_KEEPALIVE void sha256(const uint8_t* p, size_t n, uint8_t* out){ aw_sha256(p, n, out); }
