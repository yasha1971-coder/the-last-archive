// pool.js - ALL CORES: a pool of Web Workers, each with its own copy of the archive and its own wasm decoders.
// A page opened from a file has no shared memory, so workers cannot share one heap; each decodes its tasks and hands
// the bytes back (transferred, not copied). ACEAPEX splits every chunk into ranges of whole 256 KiB blocks (any core can
// take any block); zstd and LZ4HC store one frame per chunk, so a chunk is one task.
import { CODECS } from "./archive.js";

const WORKER = `
self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "init") {
    const M = self.M = await LA2(); const b = new Uint8Array(m.blob); self.base = M._malloc(b.length); M.HEAPU8.set(b, self.base);
    self.ax = m.ax; self.z = m.z; self.scratch = M._malloc(m.max);
    if (M._ax_open(self.base, m.ax) !== 0) { postMessage({ type: "error", msg: "ax_open" }); return; }
    // warm-up: run every decoder until the engine has optimized it (fresh workers start on the baseline wasm tier)
    const t0 = performance.now(); for (const w of m.warm) for (let k = 0; k < 40; k++) {
      if (w.codec === "ACEAPEX") M._ax_region(self.scratch, w.off, w.len); else if (w.codec === "zstd") M._zstd_dec(self.base + self.ax + w.src, w.slen, self.scratch, w.len); else M._lz4_dec(self.base + self.ax + self.z + w.src, w.slen, self.scratch, w.len); }
    postMessage({ type: "ready", warm: performance.now() - t0 }); return;
  }
  const M = self.M, out = [], t0 = performance.now();
  for (const j of m.jobs) {
    let r;
    if (j.codec === "ACEAPEX") r = M._ax_region(self.scratch, j.off, j.len);
    else if (j.codec === "zstd") r = M._zstd_dec(self.base + self.ax + j.src, j.slen, self.scratch, j.len);
    else r = M._lz4_dec(self.base + self.ax + self.z + j.src, j.slen, self.scratch, j.len);
    if (r !== j.len) { postMessage({ type: "error", msg: j.codec + " job failed" }); return; }
    const buf = M.HEAPU8.slice(self.scratch, self.scratch + j.len).buffer; out.push({ id: j.id, buf });
  }
  postMessage({ type: "done", out, busy: performance.now() - t0 }, out.map(o => o.buf));
};`;

export class Pool {
  constructor(n) { this.n = n; this.workers = []; }
  async init(wasmJs, blob, archive) {
    const url = URL.createObjectURL(new Blob([wasmJs, WORKER], { type: "text/javascript" }));
    const max = Math.max(...archive.chunks.map(c => c.raw[1]));
    await Promise.all(Array.from({ length: this.n }, () => new Promise((ok, bad) => {
      const w = new Worker(url); w.onmessage = (e) => { if (e.data.type === "ready") { this.workers.push(w); ok(); } else bad(new Error(e.data.msg)); };
      w.onerror = (e) => bad(e); const copy = blob.slice(0, archive.axLen + archive.zLen + archive.lLen).buffer;
      const d = archive.byName["drone"], warm = [{ codec: "ACEAPEX", off: d.raw[0], len: d.raw[1] }, { codec: "zstd", src: d.zstd[0], slen: d.zstd[1], len: d.raw[1] }, { codec: "LZ4HC", src: d.lz4[0], slen: d.lz4[1], len: d.raw[1] }];
      w.postMessage({ type: "init", blob: copy, ax: archive.axLen, z: archive.zLen, max, warm }, [copy]);
    })));
    this.A = archive;
  }
  tasks(chunks, codec) {                                                         // the units of work a decoder allows
    const A = this.A, out = []; let id = 0;
    for (const c of chunks) {
      if (codec !== "ACEAPEX") { out.push({ id: id++, chunk: c, codec, len: c.raw[1], src: codec === "zstd" ? c.zstd[0] : c.lz4[0], slen: codec === "zstd" ? c.zstd[1] : c.lz4[1], at: 0 }); continue; }
      const bs = A.bs, end = c.raw[0] + c.raw[1];
      for (let o = c.raw[0]; o < end;) { const nb = Math.min(end, (Math.floor(o / bs) + 1) * bs); out.push({ id: id++, chunk: c, codec, off: o, len: nb - o, at: o - c.raw[0] }); o = nb; }
    }
    return out;
  }
  // restore chunks on all workers; returns wall ms, per-worker busy ms, and the restored chunks (Uint8Array per chunk)
  async restore(chunks, codec, use = this.workers.length) {                      // use = how many workers may take tasks (1 = one core, same code path)
    const tasks = this.tasks(chunks, codec), per = this.workers.map(() => []);
    [...tasks].sort((a, b) => b.len - a.len).forEach(t => {                       // largest first, to the least loaded worker
      let k = 0, best = Infinity; per.forEach((q, i) => { if (i >= use) return; const s = q.reduce((x, y) => x + y.len, 0); if (s < best) { best = s; k = i; } }); per[k].push(t); });
    const t0 = performance.now();
    const res = await Promise.all(this.workers.map((w, i) => new Promise((ok, bad) => {
      if (!per[i].length) return ok({ out: [], busy: 0 });
      w.onmessage = (e) => e.data.type === "done" ? ok(e.data) : bad(new Error(e.data.msg));
      w.postMessage({ type: "jobs", jobs: per[i].map(({ chunk, ...j }) => j) });
    })));
    const wall = performance.now() - t0;
    const byId = new Map(tasks.map(t => [t.id, t])), outChunks = new Map();
    for (const r of res) for (const o of r.out) { const t = byId.get(o.id); let b = outChunks.get(t.chunk.name); if (!b) outChunks.set(t.chunk.name, b = new Uint8Array(t.chunk.raw[1])); b.set(new Uint8Array(o.buf), t.at); }
    return { wall, busy: res.map(r => r.busy), tasks: tasks.length, outChunks };
  }
}
