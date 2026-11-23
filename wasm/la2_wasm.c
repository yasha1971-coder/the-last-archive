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

/* ---- GENOME, v1.1: one streaming pass over the chromosome builds (a) a per-block map (GC, N, soft-masked share) and
 * (b) a 2bit copy in memory - the best-known alternative for region reads (UCSC .2bit layout: 2 bits per base,
 * T C A G = 0 1 2 3, first base in the high bits, N runs and lowercase runs as block lists). Then: 2bit region reads,
 * "no index" (the same decoder from the start), and a motif scan streaming the archive (both strands). ---- */
#include <stdlib.h>
static uint8_t* GB;                                                  /* 1 MiB work buffer for the genome passes */
static uint8_t* TB; static double TBASES, GHEAD, GSIZE;
static uint32_t *NS, *NE, *MS, *ME; static uint32_t NN, MN, NC, MC;  /* N runs and lowercase runs: [start, end) */
static int GNAME;
static void run_push(uint32_t** s, uint32_t** e, uint32_t* n, uint32_t* cap, uint32_t a, uint32_t b){
    if (*n == *cap) { *cap = *cap ? *cap * 2 : 4096; *s = realloc(*s, *cap * 4); *e = realloc(*e, *cap * 4); }
    (*s)[*n] = a; (*e)[*n] = b; (*n)++; }
/* map: 3 bytes per 64 KiB FASTA block (GC of ACGT, N share, lowercase share; 0..255). Returns the .2bit file size. */
EMSCRIPTEN_KEEPALIVE double gx_prep(uint8_t* map){
    if (!GX) return -1; if (!GB) GB = malloc(1 << 20);
    const uint64_t size = aceapex_dec_size(GX), BS = 65536; GSIZE = (double)size;
    size_t h0 = aceapex_dec_region(GX, GB, 4096, 0, size < 4096 ? size : 4096); size_t h = 0; while (h < h0 && GB[h] != '\n') h++;
    if (h >= h0) return -1; GHEAD = (double)(h + 1); GNAME = 0; while (1 + GNAME < (int)h && GB[1 + GNAME] > ' ') GNAME++;
    free(TB); TB = malloc(size / 4 + 2); NN = MN = 0; if (!TB) return -1;
    /* per byte: bits 0-1 code, 2 GC, 3 AT, 4 N, 5 lowercase, 6 skip (newline) */
    static uint8_t K[256]; if (!K['A']) { for (int c = 0; c < 256; c++) K[c] = 0x10 | (c >= 'a' && c <= 'z' ? 0x20 : 0);
        const char* B = "TCAG"; for (int i = 0; i < 4; i++) { K[(uint8_t)B[i]] = i | (i & 1 ? 4 : 8); K[(uint8_t)B[i] + 32] = i | (i & 1 ? 4 : 8) | 0x20; }
        K['\n'] = K['\r'] = 0x40; }
    uint32_t pos = 0, nOpen = 0, mOpen = 0; int inN = 0, inM = 0; uint32_t acc = 0;
    for (uint64_t b0 = 0, bi = 0; b0 < size; b0 += BS, bi++) {
        size_t len = size - b0 < BS ? (size_t)(size - b0) : BS;
        if (aceapex_dec_region(GX, GB, len, b0, len) != len) return -1;
        uint32_t gc = 0, at = 0, nn = 0, lo = 0, tot = 0;
        for (size_t i = (b0 == 0 ? h + 1 : 0); i < len; i++) {
            uint32_t k = K[GB[i]]; if (k & 0x40) continue;
            int isN = (k >> 4) & 1, low = (k >> 5) & 1;
            if ((isN != inN) | (low != inM)) {
                if (isN != inN) { if (isN) nOpen = pos; else run_push(&NS, &NE, &NN, &NC, nOpen, pos); inN = isN; }
                if (low != inM) { if (low) mOpen = pos; else run_push(&MS, &ME, &MN, &MC, mOpen, pos); inM = low; } }
            gc += (k >> 2) & 1; at += (k >> 3) & 1; nn += isN; lo += low; tot++;
            acc = (acc << 2) | (k & 3); if ((++pos & 3) == 0) TB[(pos >> 2) - 1] = (uint8_t)acc;
        }
        map[3 * bi] = (uint8_t)(gc + at ? 255.0 * gc / (gc + at) : 0); map[3 * bi + 1] = (uint8_t)(tot ? 255.0 * nn / tot : 0); map[3 * bi + 2] = (uint8_t)(tot ? 255.0 * lo / tot : 0);
    }
    if (pos & 3) TB[pos >> 2] = (uint8_t)(acc << (2 * (4 - (pos & 3))));
    if (inN) run_push(&NS, &NE, &NN, &NC, nOpen, pos); if (inM) run_push(&MS, &ME, &MN, &MC, mOpen, pos);
    TBASES = pos;
    return 16.0 + (1 + GNAME + 4) + 4 + 4 + 8.0 * NN + 4 + 8.0 * MN + 4 + (pos + 3) / 4;   /* header, index, record, packed DNA */
}
EMSCRIPTEN_KEEPALIVE double gx_nruns(void){ return NN; }
EMSCRIPTEN_KEEPALIVE double gx_mruns(void){ return MN; }
static uint32_t first_end_after(const uint32_t* e, uint32_t n, uint32_t x){ uint32_t lo = 0, hi = n; while (lo < hi) { uint32_t m = (lo + hi) / 2; if (e[m] <= x) lo = m + 1; else hi = m; } return lo; }
/* 2bit region: n letters from base `start`, exactly as a .2bit reader returns them (N gaps, lowercase repeats). */
EMSCRIPTEN_KEEPALIVE double tb_region(uint8_t* dst, double startd, double nd){
    if (!TB) return -1; uint32_t s = (uint32_t)startd, n = (uint32_t)nd; if ((double)s + n > TBASES) return -1;
    static const char L[4] = { 'T', 'C', 'A', 'G' };
    uint32_t i = 0, p = s;
    for (; i < n && (p & 3); i++, p++) dst[i] = L[(TB[p >> 2] >> (6 - 2 * (p & 3))) & 3];
    for (; i + 4 <= n; i += 4, p += 4) { uint8_t v = TB[p >> 2]; dst[i] = L[v >> 6]; dst[i + 1] = L[(v >> 4) & 3]; dst[i + 2] = L[(v >> 2) & 3]; dst[i + 3] = L[v & 3]; }
    for (; i < n; i++, p++) dst[i] = L[(TB[p >> 2] >> (6 - 2 * (p & 3))) & 3];
    for (uint32_t k = first_end_after(NE, NN, s); k < NN && NS[k] < s + n; k++) for (uint32_t q = NS[k] > s ? NS[k] : s, z = NE[k] < s + n ? NE[k] : s + n; q < z; q++) dst[q - s] = 'N';
    for (uint32_t k = first_end_after(ME, MN, s); k < MN && MS[k] < s + n; k++) for (uint32_t q = MS[k] > s ? MS[k] : s, z = ME[k] < s + n ? ME[k] : s + n; q < z; q++) dst[q - s] |= 32;
    return n;
}
/* "No index": the same decoder restores everything before byte offset `upto`, 1 MiB at a time. */
EMSCRIPTEN_KEEPALIVE double gx_stream(double upto){
    if (!GX) return -1; if (!GB) GB = malloc(1 << 20); uint64_t u = (uint64_t)upto, done = 0;
    while (done < u) { size_t len = u - done < (1u << 20) ? (size_t)(u - done) : (1u << 20); if (aceapex_dec_region(GX, GB, len, done, len) != len) return -1; done += len; }
    return (double)done;
}
/* Motif scan over the whole chromosome, streaming the archive: forward and reverse-complement hits (case-insensitive,
 * across line and block boundaries). Stores up to `cap` hits as (base position, strand 0/1); returns the total count. */
EMSCRIPTEN_KEEPALIVE double gx_scan(const char* mot, int m, uint32_t* out, int cap){
    if (!GX || !TB || m < 1 || m > 64) return -1; if (!GB) GB = malloc(1 << 20);   /* needs gx_prep (header length) */
    char f[64], r[64]; for (int i = 0; i < m; i++) { char c = mot[i] & ~32; f[i] = c; r[m - 1 - i] = c == 'A' ? 'T' : c == 'T' ? 'A' : c == 'C' ? 'G' : c == 'G' ? 'C' : 'N'; }
    int pal = memcmp(f, r, m) == 0; uint64_t size = aceapex_dec_size(GX); double total = 0; int stored = 0;
    static uint8_t* SB; if (!SB) SB = malloc((1 << 20) + 128);
    uint32_t pf = 0, pr = 0; if (m >= 4) { memcpy(&pf, f, 4); memcpy(&pr, r, 4); }   /* 4-byte prefix test first */
    uint32_t carry = 0, base0 = 0;                                   /* SB[0] is base number base0 */
    for (uint64_t off = (uint64_t)GHEAD; off < size; ) {
        size_t len = size - off < (1u << 20) ? (size_t)(size - off) : (1u << 20);
        if (aceapex_dec_region(GX, GB, len, off, len) != len) return -1; off += len;
        uint32_t nb = carry; for (size_t i = 0; i < len; i++) { uint8_t c = GB[i]; if (c != '\n' && c != '\r') SB[nb++] = c & ~32; }
        for (uint32_t i = 0; i + m <= nb; i++) {
            uint32_t w; if (m >= 4) { memcpy(&w, SB + i, 4); if (w != pf && w != pr) continue; } else if (SB[i] != (uint8_t)f[0] && SB[i] != (uint8_t)r[0]) continue;
            int fw = memcmp(SB + i, f, m) == 0, rv = !pal && memcmp(SB + i, r, m) == 0;
            if (fw || rv) { total++; if (stored < cap) { out[2 * stored] = base0 + i; out[2 * stored + 1] = rv; stored++; } }
        }
        carry = nb < (uint32_t)(m - 1) ? nb : (uint32_t)(m - 1); memmove(SB, SB + nb - carry, carry); base0 += nb - carry;
    }
    return total;
}
