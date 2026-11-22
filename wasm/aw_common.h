/* aw_common.h - ACEWORLD demo: world layout, tile generator, index format, sha256.
 * Shared by aw_pack (C++, links the ACEAPEX library) and aw_play (C99 decoder).
 * A world = W x H tiles of AW_TILE bytes, concatenated in tile order. Every tile is
 * generated deterministically from (seed, tile id); enwik8 supplies the "documents". */
#ifndef AW_COMMON_H
#define AW_COMMON_H
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>

#define AW_TILE       (256u * 1024u)       /* one tile = one ACEAPEX block (ACEAPEX_BS) */
#define AW_MAGIC      0x58495741u          /* "AWIX" */
#define AW_IDX_VER    1u

/* tile sections (bytes); sum == AW_TILE */
#define AW_S_HEIGHT   (128u * 128u * 2u)   /* u16 heightmap: terrain + flat roofs   -> visual (VRAM) */
#define AW_S_MAT      (128u * 128u)        /* u8 material ids                        -> visual */
#define AW_S_NAV      (128u * 128u)        /* u8 nav/collision flags                 -> logic (RAM) */
#define AW_S_PROPS    (2048u * 32u)        /* 2048 prop instances x 32 B             -> logic */
#define AW_S_MESH     (8192u * 8u)         /* 8192 quantized vertices x 8 B          -> visual */
#define AW_S_DOCS     (AW_TILE - AW_S_HEIGHT - AW_S_MAT - AW_S_NAV - AW_S_PROPS - AW_S_MESH) /* text -> logic */

typedef struct { uint32_t magic, ver, tile_bytes, w, h, ntiles, codec, rsv; } aw_idx_hdr;
typedef struct { uint64_t off; uint32_t clen, rsv; uint8_t sha[32]; } aw_idx_ent;
/* codec: 0 raw, 1 zstd-1 per tile, 3 zstd-3 per tile, 11 aceapex fast,1 (BS = tile), 2 aceapex level 2 (BS = tile), 22 level 2 with LIT/FSE chunk = tile, 23 open profile (GPU path) */

/* ---------- deterministic generator ---------- */
static inline uint64_t aw_mix(uint64_t x){ x ^= x >> 33; x *= 0xff51afd7ed558ccdULL; x ^= x >> 33; x *= 0xc4ceb9fe1a85ec53ULL; x ^= x >> 33; return x; }
static inline uint32_t aw_rng(uint64_t* s){ *s = *s * 6364136223846793005ULL + 1442695040888963407ULL; return (uint32_t)(*s >> 33); }
/* value noise on the world grid (continuous across tiles) */
static inline double aw_vn(uint64_t seed, double x, double y){
    long xi = (long)(x < 0 ? x - 1 : x), yi = (long)(y < 0 ? y - 1 : y); double fx = x - xi, fy = y - yi;
    #define AW_H(a,b) ((double)(aw_mix(seed ^ ((uint64_t)(a) * 0x9E3779B97F4A7C15ULL) ^ ((uint64_t)(b) * 0xC2B2AE3D27D4EB4FULL)) & 0xFFFF) / 65535.0)
    double v00 = AW_H(xi, yi), v10 = AW_H(xi + 1, yi), v01 = AW_H(xi, yi + 1), v11 = AW_H(xi + 1, yi + 1);
    #undef AW_H
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
}
/* fills buf[AW_TILE] for tile t of a w-wide world; docs = enwik8 bytes (docs_n may be 0) */
static inline void aw_gen_tile(uint64_t seed, uint32_t t, uint32_t w, const uint8_t* docs, size_t docs_n, uint8_t* buf){
    const uint32_t tx = t % w, ty = t / w; uint64_t rs = aw_mix(seed ^ (t * 0x2545F4914F6CDD1DULL)) | 1;
    uint8_t* p = buf;
    const int city = aw_vn(seed ^ 7, tx * 0.15, ty * 0.15) > 0.45;            /* city or wilderness tile */
    /* heightmap + material + nav: 128x128 cells, 8x8 city lots with flat roofs */
    for (uint32_t y = 0; y < 128; y++) for (uint32_t x = 0; x < 128; x++) {
        double gx = tx + x / 128.0, gy = ty + y / 128.0;
        double h = 0.6 * aw_vn(seed, gx * 2, gy * 2) + 0.3 * aw_vn(seed ^ 1, gx * 8, gy * 8) + 0.1 * aw_vn(seed ^ 2, gx * 32, gy * 32);
        uint16_t hv = (uint16_t)(h * 4000); uint8_t mat = (uint8_t)(h * 6), nav = 0;
        if (city) {
            uint32_t lx = x / 16, ly = y / 16; uint64_t lot = aw_mix(seed ^ (t * 131 + ly * 8 + lx));
            int road = (x % 16) < 3 || (y % 16) < 3;
            if (road) { hv = (uint16_t)(hv & 0xFFC0); mat = 10; nav = 1; }
            else if (lot & 1) { hv = (uint16_t)(1000 + (lot >> 8) % 3000); hv &= 0xFFF0; mat = (uint8_t)(20 + (lot >> 20) % 4); nav = 2; }
        }
        memcpy(p + 2 * (y * 128 + x), &hv, 2);
        p[AW_S_HEIGHT + y * 128 + x] = mat;
        p[AW_S_HEIGHT + AW_S_MAT + y * 128 + x] = nav;
    }
    p += AW_S_HEIGHT + AW_S_MAT + AW_S_NAV;
    /* props: {u32 mesh, f32 x,y,z, u16 quat[4], u32 flags, u32 lod} */
    for (uint32_t i = 0; i < 2048; i++) {
        uint32_t mesh = city ? 100 + aw_rng(&rs) % 24 : 300 + aw_rng(&rs) % 8;
        float fx = (float)(tx * 128 + (i % 64) * 2), fy = (float)(ty * 128 + (i / 64) * 4), fz = (float)(aw_rng(&rs) % 64);
        uint16_t q[4] = { 0, 0, (uint16_t)((aw_rng(&rs) % 4) * 16384), 32767 }; uint32_t fl = city ? 3 : 1, lod = aw_rng(&rs) % 3;
        uint8_t* e = p + i * 32; memcpy(e, &mesh, 4); memcpy(e + 4, &fx, 4); memcpy(e + 8, &fy, 4); memcpy(e + 12, &fz, 4);
        memcpy(e + 16, q, 8); memcpy(e + 24, &fl, 4); memcpy(e + 28, &lod, 4);
    }
    p += AW_S_PROPS;
    /* mesh: building modules repeated with offsets (int16 xyz, oct normal u8x2) */
    for (uint32_t i = 0; i < 8192; i++) {
        uint32_t mod = (i / 256) % 7, k = i % 256; int16_t v[3] = { (int16_t)((k % 16) * 64 + mod * 7), (int16_t)((k / 16) * 64), (int16_t)(mod * 512 + (aw_rng(&rs) & 3)) };
        uint8_t n[2] = { (uint8_t)(k * 37), (uint8_t)(mod * 41) };
        memcpy(p + i * 8, v, 6); memcpy(p + i * 8 + 6, n, 2);
    }
    p += AW_S_MESH;
    /* documents: a slice of enwik8 picked per tile */
    if (docs_n > AW_S_DOCS) { size_t o = aw_mix(seed ^ t ^ 0xD0C5) % (docs_n - AW_S_DOCS); memcpy(p, docs + o, AW_S_DOCS); }
    else for (uint32_t i = 0; i < AW_S_DOCS; i++) p[i] = (uint8_t)('a' + aw_rng(&rs) % 26);
}

/* ---------- sha256 (FIPS 180-4) ---------- */
typedef struct { uint32_t h[8]; uint64_t n; uint8_t b[64]; uint32_t bl; } aw_sha;
static const uint32_t aw_K[64] = {
0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,
0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,
0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,
0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
#define AW_ROR(x,n) (((x) >> (n)) | ((x) << (32 - (n))))
static inline void aw_sha_blk(aw_sha* s, const uint8_t* d){
    uint32_t w[64], a, b, c, e, f, g, h, dd, i;
    for (i = 0; i < 16; i++) w[i] = (uint32_t)d[4*i] << 24 | (uint32_t)d[4*i+1] << 16 | (uint32_t)d[4*i+2] << 8 | d[4*i+3];
    for (i = 16; i < 64; i++) { uint32_t s0 = AW_ROR(w[i-15],7) ^ AW_ROR(w[i-15],18) ^ (w[i-15] >> 3), s1 = AW_ROR(w[i-2],17) ^ AW_ROR(w[i-2],19) ^ (w[i-2] >> 10); w[i] = w[i-16] + s0 + w[i-7] + s1; }
    a = s->h[0]; b = s->h[1]; c = s->h[2]; dd = s->h[3]; e = s->h[4]; f = s->h[5]; g = s->h[6]; h = s->h[7];
    for (i = 0; i < 64; i++) {
        uint32_t t1 = h + (AW_ROR(e,6) ^ AW_ROR(e,11) ^ AW_ROR(e,25)) + ((e & f) ^ (~e & g)) + aw_K[i] + w[i];
        uint32_t t2 = (AW_ROR(a,2) ^ AW_ROR(a,13) ^ AW_ROR(a,22)) + ((a & b) ^ (a & c) ^ (b & c));
        h = g; g = f; f = e; e = dd + t1; dd = c; c = b; b = a; a = t1 + t2;
    }
    s->h[0] += a; s->h[1] += b; s->h[2] += c; s->h[3] += dd; s->h[4] += e; s->h[5] += f; s->h[6] += g; s->h[7] += h;
}
static inline void aw_sha256(const void* data, size_t n, uint8_t out[32]){
    static const uint32_t H0[8] = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    aw_sha s; memcpy(s.h, H0, 32); const uint8_t* d = (const uint8_t*)data; size_t i = 0;
    for (; i + 64 <= n; i += 64) aw_sha_blk(&s, d + i);
    uint8_t t[128] = {0}; size_t r = n - i; memcpy(t, d + i, r); t[r] = 0x80;
    size_t L = r + 9 <= 64 ? 64 : 128; uint64_t bits = (uint64_t)n * 8;
    for (int k = 0; k < 8; k++) t[L - 1 - k] = (uint8_t)(bits >> (8 * k));
    aw_sha_blk(&s, t); if (L == 128) aw_sha_blk(&s, t + 64);
    for (int k = 0; k < 8; k++) { out[4*k] = (uint8_t)(s.h[k] >> 24); out[4*k+1] = (uint8_t)(s.h[k] >> 16); out[4*k+2] = (uint8_t)(s.h[k] >> 8); out[4*k+3] = (uint8_t)s.h[k]; }
}
static inline void aw_hex(const uint8_t* h, size_t n, char* out){ static const char X[] = "0123456789abcdef"; for (size_t i = 0; i < n; i++) { out[2*i] = X[h[i] >> 4]; out[2*i+1] = X[h[i] & 15]; } out[2*n] = 0; }
#endif
