// corrupt_duel.js - LA2-CORRUPT: flip one random bit in the compressed bytes of a random chunk, restore it with the WASM
// decoder, classify: FAIL (decoder error) / SILENT (success, wrong sha256) / HARMLESS (success, right sha256). Bit restored after.
//   node corrupt_duel.js <la2_wasm.js> <la2_data.bin> [trials per codec] [seed]
const fs = require("fs"), crypto = require("crypto");
const LA2 = require(process.argv[2]), blob = fs.readFileSync(process.argv[3]), N = +(process.argv[4] || 2000);
let seed = +(process.argv[5] || 1971); const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
(async () => {
  const M = await LA2(), end = blob.length;
  const ax = blob.readUInt32LE(end - 24), z = blob.readUInt32LE(end - 20), l = blob.readUInt32LE(end - 16), ml = blob.readUInt32LE(end - 12);
  const meta = JSON.parse(blob.subarray(ax + z + l, ax + z + l + ml).toString()), chunks = meta.chunks;
  const base = M._malloc(ax + z + l); M.HEAPU8.set(blob.subarray(0, ax + z + l), base);
  const bs = blob.readUInt32LE(20), nb = blob.readUInt32LE(24), boff = i => Number(blob.readBigUInt64LE(68 + 8 * i)), dataOff = 68 + 8 * (nb + 1);
  const max = Math.max(...chunks.map(c => c.raw[1])), dst = M._malloc(max);
  const res = {};
  for (const codec of ["ACEAPEX", "zstd", "LZ4HC"]) {
    const r = res[codec] = { fail: 0, silent: 0, harmless: 0, trials: N };
    for (let t = 0; t < N; t++) {
      const c = chunks[Math.floor(rnd() * chunks.length)], n = c.raw[1];
      let lo, len;                                                                  // the compressed bytes this restore reads
      if (codec === "ACEAPEX") { const b0 = Math.floor(c.raw[0] / bs), b1 = Math.floor((c.raw[0] + n - 1) / bs); lo = dataOff + boff(b0); len = boff(b1 + 1) - boff(b0); }
      else if (codec === "zstd") { lo = ax + c.zstd[0]; len = c.zstd[1]; } else { lo = ax + z + c.lz4[0]; len = c.lz4[1]; }
      const pos = base + lo + Math.floor(rnd() * len), bit = 1 << Math.floor(rnd() * 8);
      M.HEAPU8[pos] ^= bit;
      let ok;
      if (codec === "ACEAPEX") { if (M._ax_open(base, ax) !== 0) ok = -1; else ok = M._ax_region(dst, c.raw[0], n); }   // fresh handle: no cached window
      else if (codec === "zstd") ok = M._zstd_dec(base + lo, len, dst, n); else ok = M._lz4_dec(base + lo, len, dst, n);
      M.HEAPU8[pos] ^= bit;
      if (ok !== n) { r.fail++; continue; }
      const h = crypto.createHash("sha256").update(M.HEAPU8.subarray(dst, dst + n)).digest("hex");
      if (h === c.sha256) r.harmless++; else r.silent++;
    }
  }
  M._ax_open(base, ax);
  for (const [c, r] of Object.entries(res)) console.log(`${c.padEnd(8)} trials ${r.trials}  FAIL ${r.fail} (${(100 * r.fail / r.trials).toFixed(1)} %)  SILENT ${r.silent} (${(100 * r.silent / r.trials).toFixed(1)} %)  HARMLESS ${r.harmless} (${(100 * r.harmless / r.trials).toFixed(1)} %)`);
  console.log(res.ACEAPEX.silent > 0 ? "STOP: the ACEAPEX WASM decoder does not catch every corruption (silent wrong output)" : "ACEAPEX caught every corruption");
})();
