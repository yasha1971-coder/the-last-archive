#!/usr/bin/env python3
"""template + wasm js + data blob + game bundle -> one self-contained HTML."""
import base64, sys
tpl, wasm, data, game, out = sys.argv[1:6]
chr1 = sys.argv[6] if len(sys.argv) > 6 else None
h = open(tpl, encoding='utf-8').read()
esc = lambda s: s.replace('</script', '<\\/script')
h = h.replace('/*__WASM__*/', esc(open(wasm, encoding='utf-8').read()), 1)
h = h.replace('/*__DATA__*/', base64.b64encode(open(data, 'rb').read()).decode(), 1)
h = h.replace('/*__CHR1__*/', base64.b64encode(open(chr1, 'rb').read()).decode() if chr1 else '', 1)
h = h.replace('/*__GAME__*/', esc(open(game, encoding='utf-8').read()), 1)
import html, os
lic = [('ACEAPEX', os.path.expanduser('~/pubrepo/LICENSE')), ('three.js', 'node_modules/three/LICENSE'),
       ('Zstandard', os.path.expanduser('~/pubrepo/.wk/zstd-1.5.7/LICENSE')), ('LZ4 library', 'lz4-1.10.0/lib/LICENSE')]
h = h.replace('/*__LICENSES__*/', html.escape('\n\n'.join(f'== {n} ==\n' + open(p, encoding='utf-8').read() for n, p in lic)), 1)
open(out, 'w', encoding='utf-8').write(h); print(f'{out}: {len(h.encode())/1e6:.1f} MB')
