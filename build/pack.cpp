// pack - THE LAST ARCHIVE data: the same chunk bytes three ways, each round-tripped before anything is written.
//   pack <chunks dir> <out dir>   -> ax.bin (one ACEAPEX fast-8 archive of all chunks, blocks 256 KiB, read by region),
//                                    zstd.bin (one zstd-19 frame per chunk), lz4.bin (one LZ4HC-12 block per chunk), offsets.json
// Each codec gets its best "pack offline, decode fast" setting; a game ships one of them.
#include "aceapex.h"
#include <zstd.h>
#include "lz4.h"
#include "lz4hc.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <fstream>
#include <sstream>
#include <regex>

static std::vector<unsigned char> slurp(const std::string& p){ std::ifstream f(p, std::ios::binary); return std::vector<unsigned char>((std::istreambuf_iterator<char>(f)), {}); }
static void spit(const std::string& p, const std::vector<unsigned char>& v){ std::ofstream f(p, std::ios::binary); f.write((const char*)v.data(), v.size()); }

int main(int argc, char** argv){
    if (argc < 3) { fprintf(stderr, "usage: pack <chunks dir> <out dir>\n"); return 1; }
    std::string in = argv[1], out = argv[2];
    std::ifstream mf(in + "/manifest.json"); std::stringstream ss; ss << mf.rdbuf(); std::string man = ss.str();
    std::regex re("\"name\": \"([^\"]+)\""); std::vector<std::string> names;
    for (std::sregex_iterator it(man.begin(), man.end(), re), end; it != end; ++it) names.push_back((*it)[1]);
    std::vector<unsigned char> raw, z, l; std::string offs = "[";
    for (size_t i = 0; i < names.size(); i++) {
        std::vector<unsigned char> c = slurp(in + "/" + names[i] + ".bin");
        size_t roff = raw.size(); raw.insert(raw.end(), c.begin(), c.end());
        std::vector<unsigned char> zb(ZSTD_compressBound(c.size())), lb(LZ4_compressBound((int)c.size())), back(c.size());
        size_t zc = ZSTD_compress(zb.data(), zb.size(), c.data(), c.size(), 19);
        int lc = LZ4_compress_HC((const char*)c.data(), (char*)lb.data(), (int)c.size(), (int)lb.size(), 12);
        if (ZSTD_isError(zc) || lc <= 0) { fprintf(stderr, "compress failed %s\n", names[i].c_str()); return 1; }
        if (ZSTD_decompress(back.data(), c.size(), zb.data(), zc) != c.size() || back != c) { fprintf(stderr, "zstd round trip FAIL\n"); return 1; }
        if (LZ4_decompress_safe((const char*)lb.data(), (char*)back.data(), lc, (int)c.size()) != (int)c.size() || back != c) { fprintf(stderr, "lz4 round trip FAIL\n"); return 1; }
        char e[256]; snprintf(e, sizeof e, "%s[\"%s\",%zu,%zu,%zu,%zu,%zu,%d]", i ? "," : "", names[i].c_str(), roff, c.size(), z.size(), zc, l.size(), lc);
        offs += e; z.insert(z.end(), zb.begin(), zb.begin() + zc); l.insert(l.end(), lb.begin(), lb.begin() + lc);
    }
    offs += "]";
    setenv("ACEAPEX_BS", "262144", 1);
    std::vector<unsigned char> ax(aceapex_compress_bound(raw.size())), back(raw.size());
    int64_t ac = aceapex_compress(raw.data(), raw.size(), ax.data(), ax.size(), 18, 0);   // fast profile level 8 (library level 18)
    if (ac <= 0 || aceapex_decompress(ax.data(), ac, back.data(), raw.size()) != (int64_t)raw.size() || back != raw) { fprintf(stderr, "ACEAPEX round trip FAIL\n"); return 1; }
    ax.resize(ac); spit(out + "/ax.bin", ax); spit(out + "/zstd.bin", z); spit(out + "/lz4.bin", l);
    std::ofstream o(out + "/offsets.json"); o << offs;
    printf("raw %zu B | ACEAPEX fast 8 (blocks 256 KiB): %lld B (%.2f %%) | zstd-19 per chunk: %zu B (%.2f %%) | LZ4HC-12 per chunk: %zu B (%.2f %%) | all round trips OK\n",
           raw.size(), (long long)ac, 100.0 * ac / raw.size(), z.size(), 100.0 * z.size() / raw.size(), l.size(), 100.0 * l.size() / raw.size());
}
