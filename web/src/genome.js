// genome.js - GENOME JUMP: a whole human chromosome (chr1, 248 956 422 bases) in one ACEAPEX archive inside the page.
// Opening the screen streams every 64 KiB block once: that pass draws the chromosome map (GC of each block) and builds a
// 2bit copy in memory - the best-known alternative for region reads - so each jump can be priced three ways: ACEAPEX
// region, 2bit region, and the same decoder without an index (from the start). Regions carry no checksum of their own
// (format: ROADMAP item 9); offline every one of 2 500 random regions matched the FASTA byte for byte (LA2-CHR1b).
import { hwLine } from "./ui.js";
export class Genome {
  constructor(M, bytes) {
    this.M = M; this.p = M._malloc(bytes.length); M.HEAPU8.set(bytes, this.p); this.arcLen = bytes.length;
    if (M._gx_open(this.p, bytes.length) !== 0) throw new Error("the genome archive was refused by the decoder");
    this.size = M._gx_size(); this.buf = M._malloc(1 << 20); this.tbuf = M._malloc(1 << 20);
    const head = this.read(0, 200), s = new TextDecoder().decode(head); this.h = s.indexOf("\n") + 1; this.W = s.indexOf("\n", this.h) - this.h;
    const body = this.size - this.h; this.bases = body - Math.ceil(body / (this.W + 1));   /* every line ends with \n, the last one may be short */
    this.BS = 65536; this.blocks = Math.ceil(this.size / this.BS); this.map = null;
  }
  // one pass over all blocks: chromosome map (3 bytes per block: GC, N, soft-masked) + 2bit copy in memory
  prep() {
    const mp = this.M._malloc(this.blocks * 3), t0 = performance.now(), sz = this.M._gx_prep(mp), ms = performance.now() - t0;
    if (sz < 0) throw new Error("the chromosome pass failed");
    this.map = this.M.HEAPU8.slice(mp, mp + this.blocks * 3); this.M._free(mp); this.twoBitSize = sz; this.prepMs = ms; return ms;
  }
  read(off, len) { const r = this.M._gx_region(this.buf, off, len); if (r !== len) throw new Error("region failed"); return this.M.HEAPU8.slice(this.buf, this.buf + len); }
  off(b) { return this.h + b + Math.floor(b / this.W); }
  blockSpan(start, n) { const b0 = this.off(start), b1 = this.off(start + n - 1) + 1; return [Math.floor(b0 / this.BS), Math.floor((b1 - 1) / this.BS)]; }
  // timing loops run until >= 8 ms (browser timers are ~0.1 ms coarse); ACEAPEX jumps are spread over the chromosome
  // (the decoder keeps the last blocks: repeating one window would time a cache hit); decode only, no copy out
  jump(start, n) {
    const b0 = this.off(start), b1 = this.off(start + n - 1) + 1, raw = this.read(b0, b1 - b0), M = this.M, L = this.bases - n;
    let k = 0, t0 = performance.now(), el = 0;
    while (el < 8 && k < 400) { k++; const s2 = (start + k * 7919 * 1031) % L, c0 = this.off(s2), c1 = this.off(s2 + n - 1) + 1; if (M._gx_region(this.buf, c0, c1 - c0) !== c1 - c0) throw new Error("region failed"); el = performance.now() - t0; }
    const us = el / k * 1000; let tbUs = 0, noIdxMs = 0;
    if (this.map) {
      let j = 0; t0 = performance.now(); el = 0;
      while (el < 8 && j < 20000) { for (let q = 0; q < 16; q++, j++) M._tb_region(this.tbuf, (start + j * 104729) % L, n); el = performance.now() - t0; }
      tbUs = el / j * 1000;
      t0 = performance.now(); if (M._gx_stream(b0) !== b0) throw new Error("stream failed"); noIdxMs = performance.now() - t0;
    }
    let seq = ""; for (const c of raw) if (c !== 10) seq += String.fromCharCode(c);
    const [k0, k1] = this.blockSpan(start, n);
    return { start, seq, us, tbUs, noIdxMs, bytes: b1 - b0, k0, k1, blocks: k1 - k0 + 1, reps: k };
  }
  quick(start, n) { const b0 = this.off(start), b1 = this.off(start + n - 1) + 1; if (this.M._gx_region(this.buf, b0, b1 - b0) !== b1 - b0) throw new Error("region failed"); return [b0, b1]; }
  text(b0, b1) { let s = ""; const H = this.M.HEAPU8; for (let i = this.buf, e = this.buf + (b1 - b0); i < e; i++) if (H[i] !== 10) s += String.fromCharCode(H[i]); return s; }
  scan(motif, cap = 20000) {
    const M = this.M, mp = M._malloc(64), out = M._malloc(8 * cap); M.HEAPU8.set(new TextEncoder().encode(motif), mp);
    const t0 = performance.now(), total = M._gx_scan(mp, motif.length, out, cap), ms = performance.now() - t0;
    const dv = new DataView(M.HEAPU8.buffer), hits = []; for (let i = 0; i < Math.min(total, cap); i++) hits.push([dv.getUint32(out + 8 * i, true), dv.getUint32(out + 8 * i + 4, true)]);
    M._free(mp); M._free(out); if (total < 0) throw new Error("scan failed"); return { motif, total, hits, ms };
  }
  full() { const big = this.M._malloc(this.size), t0 = performance.now(); const r = this.M._gx_region(big, 0, this.size); const ms = performance.now() - t0; this.M._free(big); if (r !== this.size) throw new Error("full decode failed"); return ms; }
  fasta(r) { let s = `>chr1:${r.start + 1}-${r.start + r.seq.length} (UCSC hg38, 1-based)\n`; for (let i = 0; i < r.seq.length; i += 60) s += r.seq.slice(i, i + 60) + "\n"; return s; }
}

// ---------------- the chromosome map: one column of light per 64 KiB block ----------------
export class GenomeMap {
  constructor(canvas, g, onPick) {
    this.c = canvas; this.g = g; this.flash = new Float32Array(g.blocks); this.win = null; this._hits = null; this.base = null; this.on = false;
    const pick = (e) => { const r = canvas.getBoundingClientRect(), f = Math.min(1, Math.max(0, (e.clientX - r.left - this.x0) / (r.width - 2 * this.x0))); onPick(f); };
    let drag = false; canvas.onpointerdown = (e) => { drag = true; canvas.setPointerCapture(e.pointerId); pick(e); };
    canvas.onpointermove = (e) => { if (drag) pick(e); }; canvas.onpointerup = () => { drag = false; };
    this.x0 = 14;
  }
  set hits(h) { this._hits = h; this.base = null; } get hits() { return this._hits; }
  light(k0, k1) { for (let k = Math.max(0, k0); k <= Math.min(this.g.blocks - 1, k1); k++) this.flash[k] = 1; }
  start() { if (this.on) return; this.on = true; const loop = () => { if (!this.on) return; this.draw(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
  stop() { this.on = false; }
  draw() {
    const c = this.c, dpr = window.devicePixelRatio || 1, Wc = c.clientWidth, Hc = c.clientHeight; if (!Wc) return;
    if (c.width !== Math.round(Wc * dpr)) { c.width = Math.round(Wc * dpr); c.height = Math.round(Hc * dpr); }
    const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, Wc, Hc);
    const g = this.g, nb = g.blocks, x0 = this.x0, w = Wc - 2 * x0, yc = 52, hh = 20, bx = (k) => x0 + w * k / nb;
    if (!this.base || this.base.width !== c.width) this.base = this.layer(c.width, c.height, dpr, Wc, Hc);
    x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(this.base, 0, 0); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    // decoded blocks: light columns that fade
    x.globalCompositeOperation = "lighter";
    for (let k = 0; k < nb; k++) { const f = this.flash[k]; if (f < 0.02) { this.flash[k] = 0; continue; }
      const px = bx(k), gr = x.createLinearGradient(0, 4, 0, yc + hh); gr.addColorStop(0, "rgba(120,220,255,0)"); gr.addColorStop(1, `rgba(170,240,255,${0.9 * f})`);
      x.fillStyle = gr; x.fillRect(px - 1.5, 4, 3, yc + hh - 4); x.fillStyle = `rgba(255,255,255,${f})`; x.fillRect(px - 2, yc - hh, 4, 2 * hh); this.flash[k] = f * 0.93; }
    x.globalCompositeOperation = "source-over";
    // the window
    if (this.win) { const [s, n] = this.win, a = x0 + w * s / g.bases, b = Math.max(a + 2, x0 + w * (s + n) / g.bases);
      x.strokeStyle = "#9fe8ff"; x.lineWidth = 2; x.beginPath(); x.moveTo(a, yc - hh - 6); x.lineTo(a, yc + hh + 12); x.moveTo(b, yc - hh - 6); x.lineTo(b, yc + hh + 12); x.stroke(); }
  }
  layer(W, H, dpr, Wc, Hc) {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = this.g, m = g.map, nb = g.blocks, x0 = this.x0, w = Wc - 2 * x0, yc = 52, hh = 20;
    const bx = (k) => x0 + w * k / nb;
    // body: GC of each block (dark = AT-rich, light = GC-rich), black = N gaps
    x.save(); x.beginPath(); x.roundRect(x0, yc - hh, w, 2 * hh, hh); x.clip();
    for (let px = 0; px < w; px++) {
      const k0 = Math.floor(px * nb / w), k1 = Math.max(k0 + 1, Math.floor((px + 1) * nb / w)); let gc = 0, n = 0, cnt = 0, nn = 0;
      for (let k = k0; k < k1; k++) { const kn = m[3 * k + 1] / 255; nn += kn; if (kn < 0.5) { gc += m[3 * k] / 255; cnt++; } n++; }
      if (!cnt) { x.fillStyle = "#06080b"; } else { const t = Math.min(1, Math.max(0, (gc / cnt - 0.34) / 0.22)); x.fillStyle = `rgb(${18 + t * 205 | 0},${28 + t * 218 | 0},${54 + t * 201 | 0})`; }
      x.fillRect(x0 + px, yc - hh, 1, 2 * hh);
    }
    x.restore(); x.strokeStyle = "rgba(159,232,255,.45)"; x.lineWidth = 1; x.beginPath(); x.roundRect(x0, yc - hh, w, 2 * hh, hh); x.stroke();
    // thin strip: soft-masked (repeat) share
    for (let px = 0; px < w; px++) { const k0 = Math.floor(px * nb / w), k1 = Math.max(k0 + 1, Math.floor((px + 1) * nb / w)); let lo = 0; for (let k = k0; k < k1; k++) lo += m[3 * k + 2] / 255; lo /= (k1 - k0);
      x.fillStyle = `rgba(178,120,255,${0.1 + 0.85 * lo})`; x.fillRect(x0 + px, yc + hh + 5, 1, 5); }
    // motif hits above the body
    if (this.hits && this.hits.length) { const bins = new Uint32Array(w); for (const [p] of this.hits) bins[Math.min(w - 1, Math.floor(p / g.bases * w))]++;
      x.fillStyle = "#ffcf4a"; for (let px = 0; px < w; px++) if (bins[px]) { const hgt = Math.min(16, 3 + 3 * Math.log2(bins[px])); x.fillRect(x0 + px, yc - hh - 4 - hgt, 1, hgt); } }
    // scale in Mb
    x.fillStyle = "rgba(200,230,255,.6)"; x.font = "11px system-ui, sans-serif"; x.textAlign = "center";
    for (let mb = 0; mb <= g.bases / 1e6; mb += 25) { const px = x0 + w * mb * 1e6 / g.bases; x.fillRect(px, yc + hh + 13, 1, 4); x.fillText(mb + " Mb", px, yc + hh + 29); }
    return cv;
  }
}

const COL = { A: "#5fd35f", C: "#5fa8ff", G: "#ffcf4a", T: "#ff6a6a", N: "#566" };
export function basesHtml(seq, show = 900, hl = null) {
  let out = ""; for (let i = 0; i < Math.min(seq.length, show); i++) { const c = seq[i], u = c.toUpperCase(), on = hl && i >= hl[0] && i < hl[0] + hl[1];
    out += `<span style="color:${COL[u] || "#999"};opacity:${c === u ? 1 : 0.55}${on ? ";background:rgba(255,207,74,.35);outline:1px solid #ffcf4a" : ""}">${u}</span>`; if (i % 90 === 89) out += "<br>"; }
  return out;
}
const fmt = (us) => us < 1000 ? `${us < 10 ? us.toFixed(1) : us.toFixed(0)} µs` : `${(us / 1000).toFixed(us < 1e4 ? 2 : 0)} ms`;
const bar = (us, col) => `<span style="display:inline-block;height:12px;width:${Math.max(2, Math.min(100, 100 * Math.log10(Math.max(1, us)) / 6)).toFixed(1)}%;background:${col};vertical-align:middle;box-shadow:0 0 8px ${col}"></span>`;
export function jumpHtml(g, r, fullMs, hl = null) {
  const end = r.start + r.seq.length, pct = (100 * r.start / g.bases).toFixed(2);
  let cost = "";
  if (g.map) {
    const fasterTb = r.us / r.tbUs, larger = 100 * (g.twoBitSize / g.arcLen - 1);
    cost = `<table class="bench" style="margin-top:6px"><tr><th>Cost of this jump</th><th style="width:46%">time <small>(log scale: 1 µs … 1 s)</small></th><th></th><th>stored as</th></tr>
      <tr><td>ACEAPEX region</td><td>${bar(r.us, "#9fe8ff")}</td><td><b>${fmt(r.us)}</b></td><td>${(g.arcLen / 1e6).toFixed(1)} MB</td></tr>
      <tr><td>2bit region <small>(UCSC .2bit, built in memory from the same chromosome)</small></td><td>${bar(r.tbUs, "#7dffb0")}</td><td><b>${fmt(r.tbUs)}</b></td><td>${(g.twoBitSize / 1e6).toFixed(1)} MB</td></tr>
      <tr><td>No index <small>(the same decoder from the start to here)</small></td><td>${bar(r.noIdxMs * 1000, "#ff9a6a")}</td><td><b>${fmt(r.noIdxMs * 1000)}</b></td><td>—</td></tr></table>
      <p class="verdict">Both indexed formats pay for the window, not for the file: ${r.blocks} of ${g.blocks.toLocaleString("en")} blocks touched.
      2bit reads this window <b>${fasterTb >= 1 ? fasterTb.toFixed(1) + "× faster" : (1 / fasterTb).toFixed(1) + "× slower"}</b> than ACEAPEX; its file is ${larger.toFixed(1)} % larger.
      ${r.noIdxMs * 1000 > 3 * r.us ? `Without an index, reaching ${pct} % of the chromosome costs ${(r.noIdxMs * 1000 / r.us).toFixed(0)}× the ACEAPEX window.` : `This close to the start, decoding from the beginning costs about as much as the window — move further to see the difference.`}</p>`;
  }
  return `<p>chr1:<b>${(r.start + 1).toLocaleString("en")}-${end.toLocaleString("en")}</b> <small>(1-based, UCSC style)</small> · ${pct} % · window ${r.seq.length.toLocaleString("en")} bases · ${(r.bytes / 1024).toFixed(1)} KiB of FASTA</p>
    <div style="font:12px/1.25 monospace;background:rgba(0,0,0,.35);padding:8px;max-height:150px;overflow:hidden;letter-spacing:.5px">${basesHtml(r.seq, 900, hl)}</div>
    ${cost}
    <p><small>Lowercase = soft-masked repeats (dimmed), N = gaps. Timing: decode only, averaged over ${r.reps} jumps spread over the chromosome.
    ${fullMs ? `Whole chromosome: ${fullMs.toFixed(0)} ms. ` : ""}Regions carry no checksum of their own (offline, 2 500 random regions matched the FASTA byte for byte). ${hwLine()}</small></p>`;
}
export function scanHtml(g, s) {
  const list = s.hits.slice(0, 12).map(([p, st], i) => `<a href="#" data-hit="${i}" style="color:#ffcf4a">${(p + 1).toLocaleString("en")}${st ? " (−)" : ""}</a>`).join(" · ");
  return `<p class="verdict">Motif <b>${s.motif}</b>: <b>${s.total.toLocaleString("en")}</b> hits on both strands in ${s.ms.toFixed(0)} ms —
    the whole chromosome streamed once (${(g.size / s.ms / 1e6).toFixed(2)} GB/s of FASTA). Yellow marks on the map; click a hit to jump to it.</p>
    <p><small>${list}${s.total > 12 ? " …" : ""}${s.total > s.hits.length ? ` (map shows the first ${s.hits.length.toLocaleString("en")})` : ""}</small></p>`;
}
export function prepHtml(g) {
  return `<small>Map built in ${g.prepMs.toFixed(0)} ms: all ${g.blocks.toLocaleString("en")} blocks (${(g.size / 1e6).toFixed(0)} MB) decoded once, ${(g.size / g.prepMs / 1e6).toFixed(2)} GB/s including the map and a 2bit copy for comparison.
    Body colour: GC content of each 64 KiB block (dark = AT-rich, light = GC-rich), black = N gaps; violet strip: share of soft-masked repeats. Click or drag on the chromosome to jump.</small>`;
}
