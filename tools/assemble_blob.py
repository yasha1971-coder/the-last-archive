#!/usr/bin/env python3
"""ax.bin + zstd.bin + lz4.bin + offsets.json + manifest.json -> build/out/la2_data.bin ([ax][zstd][lz4][json][trailer])."""
import json, struct
o = 'build/out'; ax = open(f'{o}/ax.bin','rb').read(); z = open(f'{o}/zstd.bin','rb').read(); l = open(f'{o}/lz4.bin','rb').read()
offs = json.load(open(f'{o}/offsets.json')); man = json.load(open('build/chunks/manifest.json')); by = {c['name']: c for c in man['chunks']}
table = []
for name, ro, rl, zo, zl, lo, ll in offs:
    c = dict(by[name]); c.update(raw=[ro, rl], zstd=[zo, zl], lz4=[lo, ll]); table.append(c)
meta = json.dumps({"version": 1, "chunks": table, "sizes": {"ax": len(ax), "zstd": len(z), "lz4": len(l), "raw": sum(c['bytes'] for c in table)}}).encode()
open(f'{o}/la2_data.bin','wb').write(ax + z + l + meta + struct.pack('<IIIIQ', len(ax), len(z), len(l), len(meta), 0x324C415453414C))
print('blob', len(ax) + len(z) + len(l) + len(meta) + 24, 'B')
