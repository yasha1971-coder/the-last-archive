// ax_pack <in> <out.aet> <level 11|2> [block bytes] - ACEAPEX archive with a chosen block size (ACEAPEX_BS; format unchanged)
#include "aceapex.h"
#include <cstdio>
#include <cstdlib>
#include <vector>
int main(int c, char** v){
    if (c < 4) { fprintf(stderr, "usage: ax_pack in out level [bs]\n"); return 1; }
    if (c > 4) setenv("ACEAPEX_BS", v[4], 1);
    FILE* f = fopen(v[1], "rb"); fseek(f, 0, SEEK_END); size_t n = ftell(f); fseek(f, 0, SEEK_SET);
    std::vector<unsigned char> in(n), out(aceapex_compress_bound(n)), back(n);
    if (fread(in.data(), 1, n, f) != n) return 1; fclose(f);
    long long r = aceapex_compress(in.data(), n, out.data(), out.size(), atoi(v[3]), 0);
    if (r <= 0 || aceapex_decompress(out.data(), r, back.data(), n) != (long long)n || back != in) { fprintf(stderr, "FAIL\n"); return 1; }
    f = fopen(v[2], "wb"); fwrite(out.data(), 1, r, f); fclose(f);
    printf("%s -> %s: %zu -> %lld B (%.2f %%), level %s, bs %s, round trip OK\n", v[1], v[2], n, r, 100.0 * r / n, v[3], c > 4 ? v[4] : "default");
}
