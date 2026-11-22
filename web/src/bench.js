// bench.js - ARCHIVE BENCHMARK: the three decoders on the same chunks, three scenarios.
// A Teleport: restore a whole fragment (City). B Single object: one small chunk (the drone), 200 in a row.
// C Fly-through: the Forest cells in path order; the worst single cell is what one frame has to absorb.
// Pass 0 of every scenario verifies each chunk's sha256 (not timed); timed passes run whole loops between two timer
// reads (browser timers are ~0.1 ms coarse, so per-call timings would round to zero). Times include the copy out of wasm.
import { CODECS, CODEC_NOTE } from "./archive.js";
import { mb, fmtMs, hwLine } from "./ui.js";
import { verdictLine } from "./lab.js";
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const tick = () => new Promise(r => setTimeout(r, 0));

export async function runBenchmark(archive, progress) {
  const city = archive.chunks.filter(c => c.fragment === "city"), drone = archive.byName["drone"];
  const forest = archive.chunks.filter(c => c.fragment === "forest" && c.kind === "mesh" && c.center).sort((a, b) => (a.center[1] - b.center[1]) || (a.center[0] - b.center[0]));
  const res = {}; let bad = 0, step = 0; const steps = CODECS.length * 3;
  const verify = (list, codec) => { for (const c of list) if (archive.restore(c, codec, true).rec.ok === false) bad++; };
  const timed = (list, codec, reps) => { const t0 = performance.now(); for (let r = 0; r < reps; r++) for (const c of list) archive.restore(c, codec, false); return (performance.now() - t0) / reps; };
  for (const codec of CODECS) {
    const r = res[codec] = {};
    verify(city, codec); r.A = med([1, 2, 3, 4, 5].map(() => timed(city, codec, 3))); r.Aread = city.reduce((s, c) => s + archive.readBytes(c, codec), 0); progress(++step / steps); await tick();
    verify([drone], codec); r.B = med([1, 2, 3, 4, 5].map(() => timed([drone], codec, 200))); r.Bread = archive.readBytes(drone, codec); progress(++step / steps); await tick();
    verify(forest, codec); r.C = med([1, 2, 3, 4, 5].map(() => timed(forest, codec, 3)));
    r.Cworst = Math.max(...forest.map(c => med([1, 2, 3].map(() => timed([c], codec, 20))))); progress(++step / steps); await tick();
  }
  archive.log.length = 0; archive.flowWindow.length = 0;                           // benchmark restores are not gameplay
  const size = { ACEAPEX: archive.axLen, zstd: archive.zLen, LZ4HC: archive.lLen };
  const best = (k) => CODECS.reduce((x, y) => res[y][k] < res[x][k] ? y : x), worst = (k) => CODECS.reduce((x, y) => res[y][k] > res[x][k] ? y : x);
  const rows = CODECS.map(c => `<tr><td><b>${c}</b><br><small>${CODEC_NOTE[c]}</small></td><td>${mb(size[c])}<br><small>${(100 * size[c] / archive.meta.sizes.raw).toFixed(1)} % of ${mb(archive.meta.sizes.raw)}</small></td><td>${fmtMs(res[c].A)}<br><small>read ${mb(res[c].Aread)}</small></td>
    <td>${fmtMs(res[c].B)}<br><small>read ${mb(res[c].Bread)}</small></td><td>${fmtMs(res[c].C)}<br><small>worst cell ${fmtMs(res[c].Cworst)}</small></td></tr>`).join("");
  const smallest = CODECS.reduce((x, y) => size[y] < size[x] ? y : x);
  const line = (k, label) => { const f = best(k), s = worst(k); return `${label}: fastest <b>${f}</b>, ${(res[s][k] / Math.max(res[f][k], 1e-4)).toFixed(1)}× faster than ${s}`; };
  const verdict = `On this computer, in this browser (one core). ${line("A", "Teleport")}; ${line("B", "single object")}; ${line("C", "fly-through")}.
    Smallest archive: <b>${smallest}</b> (${mb(size[smallest])}) — a trade-off, not a winner-takes-all.
    ${bad ? `<span class="bad">${bad} chunk(s) failed sha256.</span>` : "Every restored chunk matched its sha256."}<br>${verdictLine(Object.fromEntries(CODECS.map(c => [c, res[c].A])), size)}`;
  return { html: `<table class="bench"><tr><th>Decoder</th><th>Archive size</th><th>A · Teleport<br><small>whole City, ${city.length} chunks</small></th>
    <th>B · Single object<br><small>one ${mb(drone.raw[1])} chunk</small></th><th>C · Fly-through<br><small>${forest.length} Forest cells</small></th></tr>${rows}</table><p class="verdict">${verdict}</p><p><small>${hwLine()}</small></p>`, res, bad };
}
