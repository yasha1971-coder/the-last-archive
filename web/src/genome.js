// genome.js - GENOME JUMP: a whole human chromosome (chr1, 248 956 422 bases) in one ACEAPEX archive inside the page.
// The slider jumps anywhere; only the 64 KiB blocks under the window are decoded. Counters: time, blocks decoded vs the
// whole chromosome. Regions carry no checksum of their own (format: ROADMAP item 9); offline every one of 2 500 random
// regions matched the FASTA byte for byte (LA2-CHR1b).
import { hwLine } from "./ui.js";
export class Genome {
  constructor(M, bytes) {
    this.M = M; this.p = M._malloc(bytes.length); M.HEAPU8.set(bytes, this.p); this.arcLen = bytes.length;
    if (M._gx_open(this.p, bytes.length) !== 0) throw new Error("the genome archive was refused by the decoder");
    this.size = M._gx_size(); this.buf = M._malloc(1 << 20);
    const head = this.read(0, 200), s = new TextDecoder().decode(head); this.h = s.indexOf("\n") + 1; this.W = s.indexOf("\n", this.h) - this.h;
    const body = this.size - this.h; this.bases = body - Math.ceil(body / (this.W + 1));   /* every line ends with \n, the last one may be short */
    this.BS = 65536; this.blocks = Math.ceil(this.size / this.BS);
  }
  read(off, len) { const r = this.M._gx_region(this.buf, off, len); if (r !== len) throw new Error("region failed"); return this.M.HEAPU8.slice(this.buf, this.buf + len); }
  off(b) { return this.h + b + Math.floor(b / this.W); }
  jump(start, n) {                                                                // n bases from base `start`
    const b0 = this.off(start), b1 = this.off(start + n - 1) + 1, raw = this.read(b0, b1 - b0), reps = 20;
    // timing: 20 cold jumps spread over the chromosome from here (the decoder keeps the last blocks; repeating one window
    // would time a cache hit), averaged - browser timers are ~0.1 ms coarse
    const span = Math.floor((this.bases - n) / reps), t0 = performance.now();
    for (let k = 1; k <= reps; k++) { const s2 = (start + k * span) % (this.bases - n), c0 = this.off(s2), c1 = this.off(s2 + n - 1) + 1; if (this.M._gx_region(this.buf, c0, c1 - c0) !== c1 - c0) throw new Error("region failed"); }   // decode only, no copy out
    const us = (performance.now() - t0) / reps * 1000;
    let seq = ""; for (const c of raw) if (c !== 10) seq += String.fromCharCode(c);
    return { seq, us, bytes: b1 - b0, blocks: Math.floor((b1 - 1) / this.BS) - Math.floor(b0 / this.BS) + 1 };
  }
  full() { const big = this.M._malloc(this.size), t0 = performance.now(); const r = this.M._gx_region(big, 0, this.size); const ms = performance.now() - t0; this.M._free(big); if (r !== this.size) throw new Error("full decode failed"); return ms; }
}
const COL = { A: "#5fd35f", C: "#5fa8ff", G: "#ffcf4a", T: "#ff6a6a", N: "#566" };
export function basesHtml(seq, show = 900) {
  let out = ""; for (let i = 0; i < Math.min(seq.length, show); i++) { const c = seq[i], u = c.toUpperCase(); out += `<span style="color:${COL[u] || "#999"};opacity:${c === u ? 1 : 0.55}">${u}</span>`; if (i % 90 === 89) out += "<br>"; }
  return out;
}
export function jumpHtml(g, start, r, fullMs) {
  const pct = (100 * start / g.bases).toFixed(2), more = fullMs ? `${(fullMs * 1000 / r.us).toFixed(0)}× less time` : "press TIME THE WHOLE CHROMOSOME to compare";
  return `<p>Position <b>${start.toLocaleString("en")}</b> of ${g.bases.toLocaleString("en")} bases (${pct} %) · window ${r.seq.length.toLocaleString("en")} bases</p>
    <div style="font:12px/1.25 monospace;background:rgba(0,0,0,.35);padding:8px;max-height:150px;overflow:hidden;letter-spacing:.5px">${basesHtml(r.seq)}</div>
    <table class="bench"><tr><th></th><th>This jump</th><th>Whole chromosome</th></tr>
    <tr><td>Decode time <small>(avg of 20 cold jumps)</small></td><td><b>${r.us < 1000 ? r.us.toFixed(0) + " µs" : (r.us / 1000).toFixed(2) + " ms"}</b></td><td>${fullMs ? fullMs.toFixed(0) + " ms" : "—"}</td></tr>
    <tr><td>64 KiB blocks decoded</td><td><b>${r.blocks}</b></td><td>${g.blocks.toLocaleString("en")}</td></tr>
    <tr><td>Bytes restored</td><td>${(r.bytes / 1024).toFixed(1)} KiB</td><td>${(g.size / 1e6).toFixed(1)} MB</td></tr></table>
    <p class="verdict">Only the blocks under the window are decoded — ${more}. Archive: ${(g.arcLen / 1e6).toFixed(1)} MB for ${(g.size / 1e6).toFixed(1)} MB of FASTA (${(100 * g.arcLen / g.size).toFixed(1)} %).
    Lowercase = soft-masked repeats (dimmed), N = gaps.</p><p><small>Regions carry no checksum of their own (offline, 2 500 random regions matched the FASTA byte for byte). ${hwLine()}</small></p>`;
}
