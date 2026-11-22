// chr1_region.js - LA2-CHR1 gate: ACEAPEX region reads of chr1 in WASM (node + la2_wasm.js), every region checked against
// the FASTA; plus the whole chromosome through one region call. Stop if a region takes more than 1 ms.
//   node chr1_region.js <la2_wasm.js> <chr1.l2s.aet> <chr1.fa>
const fs = require("fs"); const { performance } = require("perf_hooks");
const LA2 = require(process.argv[2]), ar = fs.readFileSync(process.argv[3]), fa = fs.readFileSync(process.argv[4]);
let seed = 1971; const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }, p99 = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.99)]; };
(async () => {
  const M = await LA2(), base = M._malloc(ar.length); M.HEAPU8.set(ar, base);
  if (M._ax_open(base, ar.length) !== 0) { console.log("open FAIL"); process.exit(1); }
  let h = 0; while (fa[h] !== 10) h++; h++; let W = 0; while (fa[h + W] !== 10) W++;                 // header line, line width
  const nb = Math.floor((fa.length - h) / (W + 1)) * W, off = (p) => h + p + Math.floor(p / W);
  const dst = M._malloc(1 << 20); let bad = 0; const out = {};
  for (const [bases, reads] of [[4096, 2000], [65536, 500]]) {
    const t = [];
    for (let r = 0; r < reads; r++) {
      const s = Math.floor(rnd() * (nb - bases)), b0 = off(s), b1 = off(s + bases - 1) + 1, n = b1 - b0;
      const t0 = performance.now(); const got = M._ax_region(dst, b0, n); t.push(performance.now() - t0);
      if (got !== n || Buffer.compare(Buffer.from(M.HEAPU8.subarray(dst, dst + n)), fa.subarray(b0, b1)) !== 0) bad++;
    }
    out[bases] = { p50: med(t), p99: p99(t) };
    console.log(`region ${bases} bases x ${reads}: p50 ${(med(t) * 1000).toFixed(1)} us  p99 ${(p99(t) * 1000).toFixed(1)} us`);
  }
  const all = M._malloc(fa.length), t0 = performance.now(), got = M._ax_region(all, 0, fa.length), full = performance.now() - t0;
  const same = got === fa.length && Buffer.compare(Buffer.from(M.HEAPU8.subarray(all, all + fa.length)), fa) === 0;
  console.log(`full chromosome through one region call: ${full.toFixed(1)} ms (${(fa.length / full / 1e6).toFixed(2)} GB/s), ${same ? "byte-exact" : "MISMATCH"}`);
  console.log(`archive ${ar.length} B of ${fa.length} B (${(100 * ar.length / fa.length).toFixed(2)} %); region mismatches ${bad}`);
  const worst = Math.max(out[4096].p50, out[65536].p50);
  console.log(worst > 1 ? "STOP: a region takes more than 1 ms" : `GO: region p50 ${(worst * 1000).toFixed(0)} us < 1 ms; region vs full: ${(full / out[65536].p50).toFixed(0)}x (65 536 bases), ${(full / out[4096].p50).toFixed(0)}x (4 096)`);
})();
