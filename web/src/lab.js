// lab.js - ARCHIVE LAB: the comparison as something you can touch.
//  Portal Duel - one scene restored by two decoders; per-chunk timings measured (interleaved, whole loops between two timer
//                reads), then replayed on two pedestals in the Station, slowed down by a stated factor so milliseconds are visible.
//  Stress Test - "how many fragments do you ask for at once": the same request with each decoder, answered in frames a game drops.
//  Archive cost - three chests whose volume is the archive size of each decoder.
import * as THREE from "three";
import { CODECS, DECODER_COLOR, DECODER_CSS } from "./archive.js";
import { parseMesh, parseTextures, makeMaterials } from "./assets.js";
import { mb, fmtMs, hwLine } from "./ui.js";
import { sfx } from "./audio.js";

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const timed = (A, list, codec, reps) => { const t0 = performance.now(); for (let r = 0; r < reps; r++) for (const c of list) A.restore(c, codec, false); return (performance.now() - t0) / reps; };
// one line the player takes home: who is fastest, who is smallest, at what price
export function verdictLine(times, sizes) {
  const ds = Object.keys(times), fast = ds.reduce((a, b) => times[b] < times[a] ? b : a), small = ds.reduce((a, b) => sizes[b] < sizes[a] ? b : a);
  const slow = ds.reduce((a, b) => times[b] > times[a] ? b : a), x = (v) => v.toFixed(1) + "×";
  const c = (d) => `<b style="color:${DECODER_CSS[d]}">${d}</b>`;
  if (fast === small) return `${c(fast)} is both the fastest and the smallest in this run.`;
  return `${c(fast)}: fastest in this run — ${x(times[slow] / Math.max(times[fast], 1e-4))} faster than ${slow} — but its archive is ${x(sizes[fast] / sizes[small])} larger. ${c(small)}: smallest archive, ${x(times[small] / Math.max(times[fast], 1e-4))} slower to restore.`;
}
export const SCENES = { city: "The Forgotten City", forest: "The Frozen Forest", reactor: "The Reactor", heart: "The Heart of the Archive" };
export const EXTENT = { city: 240, forest: 220, reactor: 124, heart: 84 };
const sceneChunks = (A, frag) => [A.byName[frag + "_textures"], ...A.chunks.filter(c => c.fragment === frag && c.kind === "mesh" && !c.name.startsWith("guardian"))];

export function measureDuel(A, frag, a, b) {
  const list = sceneChunks(A, frag), out = { frag, a, b, list, ms: { [a]: [], [b]: [] }, bad: 0 };
  for (const c of list) for (const d of [a, b]) if (A.restore(c, d, true).rec.ok === false) out.bad++;      // verify every chunk, both ways
  for (const [i, c] of list.entries()) {                                                                   // interleave so neither side warms the cache for the other
    const first = i % 2 ? b : a, second = first === a ? b : a;
    out.ms[first].push(med([0, 1, 2].map(() => timed(A, [c], first, 8)))); out.ms[second].push(med([0, 1, 2].map(() => timed(A, [c], second, 8))));
  }
  for (const d of [a, b]) { out[d] = { total: out.ms[d].reduce((s, x) => s + x, 0), read: list.reduce((s, c) => s + A.readBytes(c, d), 0) }; }
  out.bytes = list.reduce((s, c) => s + c.raw[1], 0); A.log.length = 0; A.flowWindow.length = 0; return out;
}
// deterministic "random" order of all chunks, the same for every decoder
function order(A) { let s = 1971; const idx = A.chunks.map((_, i) => i); for (let i = idx.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) >>> 0; const j = s % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; } return idx.map(i => A.chunks[i]); }
export function measureStress(A, n) {
  const list = order(A).slice(0, n), res = {}; let bad = 0;
  for (const d of CODECS) { for (const c of list) if (A.restore(c, d, true).rec.ok === false) bad++;
    const t = med([0, 1, 2].map(() => timed(A, list, d, 2))); res[d] = { ms: t, read: list.reduce((s, c) => s + A.readBytes(c, d), 0), drops: Math.floor((8 + t) / 16.7) }; }
  A.log.length = 0; A.flowWindow.length = 0;
  return { n, bytes: list.reduce((s, c) => s + c.raw[1], 0), res, bad, sizes: { ACEAPEX: A.axLen, zstd: A.zLen, LZ4HC: A.lLen } };
}
export function measureCurve(A) {
  const list = order(A), per = {};
  for (const d of CODECS) per[d] = list.map(c => med([0, 1, 2].map(() => timed(A, [c], d, 6))));
  A.log.length = 0; A.flowWindow.length = 0; return { list, per };
}
export function curveSvg(cv, n) {
  const W = 760, H = 220, L = 46, B = 30, N = cv.list.length, pts = {}, drops = (ms) => Math.floor((8 + ms) / 16.7);
  let ymax = 1; for (const d of CODECS) { let s = 0; pts[d] = cv.per[d].map(ms => { s += ms; const y = drops(s); ymax = Math.max(ymax, y); return y; }); }
  const X = (i) => L + (W - L - 10) * (i - 1) / (N - 1), Y = (v) => H - B - (H - B - 10) * v / ymax;
  const lines = CODECS.map(d => `<polyline fill="none" stroke="${DECODER_CSS[d]}" stroke-width="2.5" points="${pts[d].map((v, i) => `${X(i + 1).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}"/>`).join("");
  const grid = Array.from({ length: ymax + 1 }, (_, v) => v).filter(v => ymax <= 8 || v % Math.ceil(ymax / 8) === 0)
    .map(v => `<line x1="${L}" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(159,232,255,.12)"/><text x="${L - 8}" y="${Y(v) + 4}" fill="#8aa0b2" font-size="11" text-anchor="end">${v}</text>`).join("");
  const mark = `<line x1="${X(n)}" x2="${X(n)}" y1="10" y2="${H - B}" stroke="#fff" stroke-dasharray="4 4" opacity=".6"/><text x="${X(n) + 4}" y="22" fill="#fff" font-size="11">your request: ${n}</text>`;
  const leg = CODECS.map((d, i) => `<text x="${L + 10 + i * 110}" y="${H - 6}" fill="${DECODER_CSS[d]}" font-size="12">■ ${d}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:rgba(0,0,0,.25)">${grid}${lines}${mark}${leg}
    <text x="${W - 12}" y="${H - B + 16}" fill="#8aa0b2" font-size="11" text-anchor="end">fragments requested at once → ${N}</text>
    <text x="12" y="16" fill="#8aa0b2" font-size="11">frames dropped at 60 fps</text></svg>`;
}
export function stressHtml(r) {
  const max = Math.max(...CODECS.map(d => r.res[d].ms));
  const rows = CODECS.map(d => { const x = r.res[d]; return `<tr><td style="color:${DECODER_CSS[d]}"><b>${d}</b></td><td style="width:45%"><div style="height:14px;background:${DECODER_CSS[d]};width:${Math.max(2, 100 * x.ms / max)}%"></div></td>
    <td>${fmtMs(x.ms)}</td><td>${mb(x.read)}</td><td>${x.drops === 0 ? "fits in the frame" : `drops ${x.drops} frame${x.drops > 1 ? "s" : ""}`}</td></tr>`; }).join("");
  return `<p>Requested <b>${r.n}</b> chunk${r.n > 1 ? "s" : ""} (${mb(r.bytes)} of world) in one frame, with 8 ms of rendering already spent of a 16.7 ms frame:</p>
    <table class="bench"><tr><th>Decoder</th><th>Restore time</th><th></th><th>Read</th><th>At 60 fps</th></tr>${rows}</table>
    <p class="verdict">${r.bad ? `<span class="bad">${r.bad} chunk(s) failed sha256.</span>` : "Every chunk verified (sha256)."} One CPU core in this browser.</p>
    <p class="verdict">${verdictLine(Object.fromEntries(CODECS.map(d => [d, r.res[d].ms])), r.sizes)}</p><p><small>${hwLine()}</small></p>`;
}

// ---------- ALL CORES ----------
export async function measureCores(A, pool, frag = "city") {
  const list = sceneChunks(A, frag), res = {}; let bad = 0; const total = list.reduce((s, c) => s + c.raw[1], 0), largest = Math.max(...list.map(c => c.raw[1]));
  for (const d of CODECS) {
    const first = await pool.restore(list, d); for (const c of list) if (!A.verifyBytes(c, first.outChunks.get(c.name))) bad++;
    for (let k = 0; k < 4; k++) await pool.restore(list, d);                     // warm runs (not timed)
    const ones = [], runs = []; let busy = null;
    for (let k = 0; k < 5; k++) { ones.push((await pool.restore(list, d, 1)).wall); const r = await pool.restore(list, d); runs.push(r.wall); busy = r.busy; }   // 1 worker vs all, interleaved
    const one = med(ones), all = med(runs); res[d] = { one, all, speed: one / all, busy, tasks: first.tasks };
  }
  A.log.length = 0; A.flowWindow.length = 0;
  return { frag, res, bad, cores: pool.n, total, largest, cap: total / largest };
}
export function coresHtml(r) {
  const rows = CODECS.map(d => { const x = r.res[d]; return `<tr><td style="color:${DECODER_CSS[d]}"><b>${d}</b></td><td>${x.tasks}</td><td>${fmtMs(x.one)}</td><td>${fmtMs(x.all)}</td><td><b>${x.speed.toFixed(1)}×</b></td></tr>`; }).join("");
  const d = "ACEAPEX", x = r.res[d], wall = x.all, bars = x.busy.map((b, i) => `<div title="core ${i + 1}" style="display:inline-block;width:${Math.max(6, 100 / r.cores - 1)}%;margin-right:1%;height:46px;background:#13243a;position:relative;vertical-align:bottom">
    <i style="position:absolute;bottom:0;left:0;right:0;height:${Math.min(100, 100 * b / Math.max(wall, 1e-3))}%;background:${DECODER_CSS[d]}"></i></div>`).join("");
  return `<p>Restoring <b>${SCENES[r.frag]}</b> (${mb(r.total)}) with one worker and with <b>${r.cores}</b> workers (each has its own copy of the archive; same code path, rendering paused):</p>
    <table class="bench"><tr><th>Decoder</th><th>Tasks</th><th>1 core</th><th>All cores</th><th>Speed-up</th></tr>${rows}</table>
    <p><small>ACEAPEX: busy time of each core during the restore</small><br>${bars}</p>
    <p class="verdict">zstd and LZ4HC store each chunk as one frame, so the largest chunk (${mb(r.largest)}, textures) is one task for one core — they can never get more than ${r.cap.toFixed(2)}× faster here, however many cores you add. ACEAPEX reads by 256 KiB blocks, so every core gets work.
    ${r.bad ? `<span class="bad">${r.bad} chunk(s) failed sha256.</span>` : "Every chunk restored by the workers matched its sha256."}</p><p><small>${hwLine()}</small></p>`;
}

// ---------- 3D: text, chests, duel pedestals ----------
export function label(text, color = "#e6f6ff", w = 6) {
  const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 192; const g = cv.getContext("2d");
  const draw = (t) => { g.clearRect(0, 0, 1024, 192); g.font = "600 52px Segoe UI, system-ui, sans-serif"; g.textAlign = "center"; g.fillStyle = "rgba(0,0,0,.55)";
    const lines = t.split("\n"); lines.forEach((l, i) => { g.fillStyle = "#000"; g.fillText(l, 514, 70 + i * 64 + 3); g.fillStyle = i ? "#cfe3f0" : color; g.fillText(l, 512, 70 + i * 64); }); tex.needsUpdate = true; };
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; draw(text);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })); s.scale.set(w, w * 192 / 1024, 1); s.userData.draw = draw; return s;
}
export function makeChests(scene, A) {
  const size = { ACEAPEX: A.axLen, zstd: A.zLen, LZ4HC: A.lLen }, out = {};
  CODECS.forEach((d, i) => {
    const e = 0.95 * Math.cbrt(size[d] / 1e6), a = -Math.PI / 2 + (i - 1) * 0.55, x = Math.cos(a) * 7.5, z = Math.sin(a) * 7.5;     // volume = archive size
    const m = new THREE.Mesh(new THREE.BoxGeometry(e, e, e), new THREE.MeshStandardMaterial({ color: DECODER_COLOR[d], emissive: DECODER_COLOR[d], emissiveIntensity: 0.15, metalness: 0.5, roughness: 0.35 }));
    m.position.set(x, e / 2, z); m.rotation.y = -a;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: DECODER_COLOR[d] })); m.add(edges);
    const smallest = Math.min(...Object.values(size)), rel = size[d] === smallest ? "smallest archive" : `${(size[d] / smallest).toFixed(1)}× the smallest`;
    const raw = A.meta.sizes.raw, l = label(`${d} · ${mb(size[d])} (${(100 * size[d] / raw).toFixed(1)} %)\n${rel}`, DECODER_CSS[d], 3.4); l.position.set(x, e + 0.9, z);
    scene.add(m, l); out[d] = { mesh: m, x, z, e };
  });
  return out;
}
export class Duel {
  constructor(game, scene) { this.g = game; this.scene = scene; this.sides = []; this.t = 0; this.active = false; this.extra = []; }
  clear() {
    for (const s of this.sides) { this.scene.remove(s.group, s.label, s.group.userData.light, s.stream); if (s.win) this.scene.remove(s.win);
      s.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); [].concat(o.material).forEach(m => m.dispose()); } }); s.stream.geometry.dispose(); }
    for (const e of this.extra) this.scene.remove(e); this.extra = []; this.sides = []; this.active = false; this.winner = null;
  }
  // the bytes this decoder reads, flowing from its chest to its pedestal: thickness = bytes read
  stream(d, x, read, chests) {
    const c = chests[d], n = Math.max(40, Math.min(700, Math.round(read / 9000))), pos = new Float32Array(n * 3), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) ph[i] = Math.random();
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: DECODER_COLOR[d], size: 0.13, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    pts.frustumCulled = false; this.scene.add(pts);
    const a = new THREE.Vector3(c.x, c.e + 0.2, c.z), b = new THREE.Vector3(x, 2.2, 5.6), m = a.clone().add(b).multiplyScalar(0.5).add(new THREE.Vector3(0, 4.5, 0));
    pts.userData = { a, b, m, ph, n, on: false };
    return pts;
  }
  flow(s, dt) {
    const u = s.stream.userData, p = s.stream.geometry.attributes.position.array, q = new THREE.Vector3();
    s.stream.material.opacity += ((u.on ? 0.95 : 0) - s.stream.material.opacity) * Math.min(1, dt * 4);
    for (let i = 0; i < u.n; i++) { u.ph[i] = (u.ph[i] + dt * 0.9) % 1; const t = u.ph[i], k = 1 - t;
      q.set(k * k * u.a.x + 2 * k * t * u.m.x + t * t * u.b.x, k * k * u.a.y + 2 * k * t * u.m.y + t * t * u.b.y, k * k * u.a.z + 2 * k * t * u.m.z + t * t * u.b.z);
      const j = (i * 0.618) % 1 - 0.5; p[3 * i] = q.x + j * 0.35; p[3 * i + 1] = q.y + ((i * 0.37) % 1 - 0.5) * 0.35; p[3 * i + 2] = q.z + j * 0.2; }
    s.stream.geometry.attributes.position.needsUpdate = true;
  }
  start(r, chests) {
    this.clear(); const A = this.g.A, s = 5.4 / EXTENT[r.frag];
    const slow = Math.max(r[r.a].total, r[r.b].total); this.slowDil = 7000 / Math.max(slow, 0.01); this.dil = this.slowDil;   // the slower side takes 7 s on screen
    [[r.a, -4.6], [r.b, 4.6]].forEach(([d, x], si) => {
      const group = new THREE.Group(); group.position.set(x, 1.25, 5.6);
      const light = new THREE.PointLight(DECODER_COLOR[d], 40, 14); light.position.set(x, 5, 5.6); group.userData.light = light; this.scene.add(light); group.scale.setScalar(s); this.scene.add(group);
      const tex = parseTextures(A.restore(r.list[0], d, false).data); let t = r.ms[d][0]; const chunks = [];
      for (let i = 1; i < r.list.length; i++) {
        const { mats, uniforms } = makeMaterials(r.frag, tex, new THREE.Color(DECODER_COLOR[d]).multiplyScalar(0.45)), mesh = new THREE.Mesh(parseMesh(A.restore(r.list[i], d, false).data), mats);
        mesh.visible = false; group.add(mesh); t += r.ms[d][i]; chunks.push({ ms: t, u: uniforms.uReveal, mesh });
      }
      const lab = label(`${d}`, DECODER_CSS[d], 3.4); lab.position.set(x, 3.1, 5.6); this.scene.add(lab);
      this.sides.push({ d, si, group, label: lab, chunks, total: r[d].total, read: r[d].read, done: false, shown: 0, stream: this.stream(d, x, r[d].read, chests) });
    });
    A.log.length = 0; A.flowWindow.length = 0; this.r = r; this.t = 0; this.active = true; this.real = false; this.awaitReal = false;
    this.count = label("3", "#ffe08a", 7); this.count.position.set(0, 3.4, 5.6); this.scene.add(this.count); this.extra.push(this.count);
    this.countdown = 3.0; this.lastBeep = 4;
  }
  reset(real) {                                                                   // hide everything, start the timeline again
    for (const s of this.sides) { for (const c of s.chunks) { c.mesh.visible = false; c.u.value = 0; } s.done = false; s.shown = 0; s.flash = 0; if (s.win) { this.scene.remove(s.win); s.win = null; } }
    for (const e of this.extra) if (e !== this.count) this.scene.remove(e); this.extra = this.extra.filter(e => e === this.count);
    this.winner = null; this.t = 0; this.real = real; this.dil = real ? 1 : this.slowDil; this.awaitReal = false;
  }
  replayReal() { this.reset(true); this.realT0 = performance.now(); sfx.rift(); }
  update(dt) {
    if (!this.sides.length) return;
    if (this.countdown > 0) {                                                       // 3 - 2 - 1 - GO
      this.countdown -= dt; const k = Math.ceil(this.countdown);
      if (k !== this.lastBeep) { this.lastBeep = k; if (k > 0) sfx.tick(440); else sfx.tick(880); }
      this.count.visible = true; this.count.userData.draw(k > 0 ? String(k) : "GO"); const sc = 7 * (1.35 - (this.countdown % 1) * 0.35); this.count.scale.set(sc, sc * 192 / 1024, 1);
      for (const s of this.sides) { s.stream.userData.on = false; this.flow(s, dt); }
      return;
    }
    if (this.count.visible && this.t > 0.6) this.count.visible = false;
    this.t += dt;
    for (const s of this.sides) {
      let shown = 0; for (const c of s.chunks) { if (this.t >= c.ms * this.dil / 1000) { c.mesh.visible = true; c.u.value = Math.min(1, c.u.value + dt / 0.45); shown++; } }
      if (shown > s.shown && !this.real) sfx.tick(s.si ? 520 : 780); s.shown = shown;
      s.group.rotation.y += dt * 0.15; const doneNow = shown === s.chunks.length;
      s.stream.userData.on = !doneNow; this.flow(s, dt);
      if (doneNow && !s.done) { s.done = true;
        if (!this.winner) { this.winner = s; s.flash = 1; sfx.key(); const other = this.sides.find(o => o !== s);
          s.win = label(`FINISHED FIRST · ${s.d}`, "#ffe08a", 4.2); s.win.position.set(s.group.position.x, 3.85, s.group.position.z); this.scene.add(s.win);
          s.margin = (other.total / Math.max(s.total, 1e-4)).toFixed(1); }
        else { const w = this.winner, plus = label(`+${fmtMs(s.total - w.total)}`, "#ff6a5a", 3.0); plus.position.set(s.group.position.x, 3.85, s.group.position.z); this.scene.add(plus); this.extra.push(plus);
          if (this.real) { const both = Math.max(w.total, s.total), fr = Math.ceil(both / 16.7);
            this.g.ui?.say(both < 16.7 ? `At real speed both finished within ${fmtMs(both)} — less than one 60 Hz frame (16.7 ms). The difference is headroom, not a wait.`
              : `At real speed: ${w.d} ${fmtMs(w.total)}, ${s.d} ${fmtMs(s.total)} — the slower one needs ${fr} frames at 60 Hz.`, 9); }
          else this.awaitReal = true; } }
      if (s.flash) { s.flash = Math.max(0, s.flash - dt * 0.8); s.group.userData.light.intensity = 40 + 400 * s.flash; if (s.win) { const k = 4.2 * (1 + 0.35 * s.flash); s.win.scale.set(k, k * 192 / 1024, 1); } }
      s.label.userData.draw(`${s.d}${s.done ? (this.winner === s ? ` ✓  ${s.margin}× faster` : "  ✓") : shown === 0 ? " · textures…" : ` · ${shown}/${s.chunks.length}`}\n${fmtMs(s.total)} real · read ${mb(s.read)}`);
    }
  }
  caption() {
    if (!this.sides.length) return "";
    if (this.real) return `PORTAL DUEL · ${SCENES[this.r.frag]} · REAL SPEED ×1`;
    return `PORTAL DUEL · ${SCENES[this.r.frag]} · replay slowed ×${Math.round(this.dil).toLocaleString("en")} so milliseconds are visible${this.awaitReal ? " · press [R] to replay at real speed" : ""}`;
  }
}
