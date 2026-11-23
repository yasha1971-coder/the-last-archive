// main.js - boot: wasm decoders + embedded Archive blob -> FX + Game; menus; main loop.
import { Archive, CODECS } from "./archive.js";
import { FX } from "./fx.js";
import { Game } from "./game.js";
import { initAudio, setVolume } from "./audio.js";
import { ui, mb, hwLine } from "./ui.js";
import { runBenchmark } from "./bench.js";
import { measureDuel, measureStress, stressHtml, SCENES, verdictLine, measureCurve, curveSvg, measureCores, coresHtml } from "./lab.js";
import { Pool } from "./pool.js";
import { Genome, GenomeMap, basesHtml, jumpHtml, scanHtml, prepHtml } from "./genome.js";
import { DECODER_CSS } from "./archive.js";

const S = Object.assign({ codec: "ACEAPEX", quality: "high", overloadFx: true, sens: 1, volume: 0.7 }, JSON.parse(localStorage.getItem("la2.settings") || "{}"));
const save = () => localStorage.setItem("la2.settings", JSON.stringify(S));

async function boot() {
  const M = await LA2();
  const b64 = document.getElementById("archive-data").textContent.trim();
  const blob = new Uint8Array(await (await fetch("data:application/octet-stream;base64," + b64)).arrayBuffer());
  const A = new Archive(M, blob); let fx = null, game;
  try { fx = new FX(document.getElementById("view")); game = new Game(fx, A, S); }
  catch (e) {                                                                     // no WebGL2: the measurements still work, the 3D parts say why they do not
    game = { paused: true, started: false, surge: 0, place: null, update() {}, enter() {}, noGL: true };
    for (const id of ["b-play"]) document.getElementById(id).style.display = "none";
    ui.set("noglnote", "WebGL2 is not available in this browser: the game and the Portal Duel need it. Benchmark, Stress Test and Genome Jump work."); }
  window.__LA2 = { A, game, S };                                                   // test hook (headless checks)
  if (fx) fx.setQuality(S.quality); setVolume(S.volume);
  const pc = (n) => (100 * n / A.meta.sizes.raw).toFixed(1) + " %";
  ui.set("sizes", `One archive, three decoders: ACEAPEX ${mb(A.axLen)} (${pc(A.axLen)}) · zstd ${mb(A.zLen)} (${pc(A.zLen)}) · LZ4HC ${mb(A.lLen)} (${pc(A.lLen)}) — of ${mb(A.meta.sizes.raw)} of world data`);
  if (fx) game.enter("hub"); ui.set("hwline", hwLine()); ui.show("menu"); document.getElementById("loading").remove();

  const play = () => { initAudio(); ui.hideAll(); ui.hud(true); game.paused = false; document.getElementById("view").requestPointerLock?.(); };
  const on = (id, f) => document.getElementById(id).addEventListener("click", f);
  on("b-play", play); on("b-resume", play);
  on("b-settings", () => { syncSettings(); ui.show("settings"); }); on("b-psettings", () => { syncSettings(); ui.show("settings"); });
  on("b-howto", () => ui.show("howto")); on("b-credits", () => ui.show("credits"));
  for (const b of document.querySelectorAll(".back")) b.addEventListener("click", () => ui.show(game.started ? "pause" : "menu"));
  on("b-quit", () => location.reload()); on("b-again", () => location.reload());
  on("b-bench", async () => {
    ui.show("bench"); ui.set("benchout", "<p>Restoring every chunk with each decoder…</p>");
    await new Promise(r => setTimeout(r, 50));
    window.__LA2.measuring = true; const r = await runBenchmark(A, p => ui.bar("benchbar", p)); window.__LA2.measuring = false; ui.set("benchout", r.html); window.__LA2.bench = r;
  });
  // ARCHIVE LAB
  const openLab = () => { game.paused = true; game.started = game.started || !!game.place; document.exitPointerLock?.(); ui.show("lab"); };
  game.onLab = openLab; on("b-lab", () => { initAudio(); ui.show("lab"); });
  const fill = (id, list, v) => { const e = document.getElementById(id); e.innerHTML = list.map(([k, t]) => `<option value="${k}">${t}</option>`).join(""); e.value = v; return e; };
  fill("d-scene", Object.entries(SCENES), "city"); fill("d-a", CODECS.map(c => [c, c]), "ACEAPEX"); fill("d-b", CODECS.map(c => [c, c]), "zstd");
  on("d-run", async () => {
    const f = document.getElementById("d-scene").value, a = document.getElementById("d-a").value, b = document.getElementById("d-b").value;
    if (a === b) { ui.set("d-out", "Pick two different decoders."); return; }
    if (!fx) { ui.set("d-out", "The Portal Duel needs WebGL2, which this browser does not provide."); return; }
    ui.set("d-out", "Measuring both portals…"); await new Promise(r => setTimeout(r, 30));
    window.__LA2.measuring = true; const r = measureDuel(A, f, a, b); window.__LA2.measuring = false; window.__LA2.duel = r;
    ui.set("d-out", `<b style="color:${DECODER_CSS[a]}">${a}</b> ${r[a].total.toFixed(2)} ms · <b style="color:${DECODER_CSS[b]}">${b}</b> ${r[b].total.toFixed(2)} ms ${r.bad ? '<span class="bad">sha256 FAIL</span>' : "· sha256 ✓"}<br>${verdictLine({ [a]: r[a].total, [b]: r[b].total }, { ACEAPEX: A.axLen, zstd: A.zLen, LZ4HC: A.lLen })}<br><small>${hwLine()}</small>`);
    if (game.place?.frag !== "hub") game.enter("hub");
    game.place.duel.start(r, game.place.chests); game.pos.set(0, 9.2); game.yaw = 0; game.pitch = -0.22;
    setTimeout(play, 600);
  });
  const sn = document.getElementById("s-n"); sn.oninput = () => { ui.set("s-nv", sn.value); const cv = window.__LA2.curve, o = document.getElementById("s-out"); if (cv && o.querySelector("svg")) o.querySelector("svg").outerHTML = curveSvg(cv, +sn.value); };
  on("s-run", async () => { ui.set("s-out", "<p>Requesting…</p>"); await new Promise(r => setTimeout(r, 30)); window.__LA2.measuring = true; const r = measureStress(A, +sn.value); window.__LA2.stress = r; if (!window.__LA2.curve) window.__LA2.curve = measureCurve(A); window.__LA2.measuring = false;
    ui.set("s-out", curveSvg(window.__LA2.curve, +sn.value) + stressHtml(r));
    game.surge = Math.min(1, Math.max(...Object.values(r.res).map(x => x.ms)) / 40); });
  let genome = null, gmap = null, fullMs = 0, lastJump = null, scanRes = null, hl = null, auto = null;
  const gpos = document.getElementById("g-pos"), gwin = document.getElementById("g-win");
  async function getGenome() { if (!genome) { ui.set("g-out", "<p>Opening the chromosome archive…</p>"); await new Promise(r => setTimeout(r, 20));
      const b64 = document.getElementById("chr1-data").textContent.trim(); if (!b64) throw new Error("this build has no chromosome inside");
      let b; try { b = new Uint8Array(await (await fetch("data:application/octet-stream;base64," + b64)).arrayBuffer()); }
      catch (e) { b = new Uint8Array(b64.length * 3 / 4); let o = 0; for (let i = 0; i < b64.length; i += 4 << 18) { const part = atob(b64.slice(i, i + (4 << 18))); for (let k = 0; k < part.length; k++) b[o++] = part.charCodeAt(k); } b = b.subarray(0, o); }   // fallback: decode in pieces
      const g = new Genome(M, b); window.__LA2.genome = g;
      ui.set("g-out", `<p>Building the chromosome map: decoding all ${g.blocks.toLocaleString("en")} blocks once…</p>`); await new Promise(r => setTimeout(r, 30));
      window.__LA2.measuring = true; g.prep(); window.__LA2.measuring = false; ui.set("g-prep", prepHtml(g));
      gmap = new GenomeMap(document.getElementById("g-map"), g, (f) => { stopAuto(); hl = null; gpos.value = Math.round(f * 1e6); jump(); });
      window.__LA2.gmap = gmap; genome = g; } return genome; }
  const winN = () => +gwin.value;
  async function jumpTo(start, n) {
    try { const g = await getGenome(); start = Math.max(0, Math.min(g.bases - n, Math.floor(start)));
      window.__LA2.measuring = true; const r = g.jump(start, n); window.__LA2.measuring = false; window.__LA2.jump = r; lastJump = r;
      gmap.win = [start, n]; gmap.light(r.k0, r.k1); gmap.start(); ui.set("g-out", jumpHtml(g, r, fullMs, hl)); }
    catch (e) { window.__LA2.measuring = false; ui.set("g-out", `<p class="bad">${e.message}</p>`); } }
  const jump = async () => { const g = await getGenome(); return jumpTo(+gpos.value / 1e6 * (g.bases - winN()), winN()); };
  gpos.oninput = () => { stopAuto(); hl = null; jump(); }; gwin.onchange = () => { hl = null; jump(); };
  on("g-go", async () => { stopAuto(); const g = await getGenome(); const nums = (document.getElementById("g-goto").value.replace(/chr1:?/i, "").replace(/[, _]/g, "").match(/\d+/g) || []).map(Number);
    if (!nums.length) return; const s = Math.max(1, nums[0]) - 1, n = nums[1] > nums[0] ? Math.min(262144, nums[1] - nums[0] + 1) : winN(); hl = null;
    gpos.value = Math.round(s / Math.max(1, g.bases - n) * 1e6); jumpTo(s, n); });
  on("g-find", async () => { stopAuto(); const mot = document.getElementById("g-motif").value.toUpperCase().replace(/[^ACGT]/g, "");
    if (mot.length < 4) { ui.set("g-scan", "<p class='bad'>Type 4–32 letters of A, C, G, T.</p>"); return; }
    const g = await getGenome(); ui.set("g-scan", `<p>Streaming all ${(g.size / 1e6).toFixed(0)} MB for ${mot} on both strands…</p>`); await new Promise(r => setTimeout(r, 30));
    window.__LA2.measuring = true; const sr = g.scan(mot); window.__LA2.measuring = false; scanRes = sr; window.__LA2.scan = sr; gmap.hits = sr.hits; gmap.start(); ui.set("g-scan", scanHtml(g, sr)); });
  document.getElementById("g-scan").onclick = (e) => { const a = e.target.closest("[data-hit]"); if (!a || !scanRes) return; e.preventDefault(); stopAuto();
    const [p] = scanRes.hits[+a.dataset.hit], s = Math.max(0, p - 30); hl = [p - s, scanRes.motif.length]; jumpTo(s, winN()); };
  on("g-save", () => { if (!lastJump) return; const g = genome, blob = new Blob([g.fasta(lastJump)], { type: "text/plain" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `chr1_${lastJump.start + 1}-${lastJump.start + lastJump.seq.length}.fa`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
  // AUTOPILOT: one random jump per frame; decode time summed over all jumps (single jumps are below the timer's resolution)
  function stopAuto() { if (!auto) return; auto.on = false; auto = null; window.__LA2.measuring = false; document.getElementById("g-auto").textContent = "AUTOPILOT"; }
  on("g-auto", async () => { if (auto) { stopAuto(); return; } const g = await getGenome(); const A2 = auto = { on: true, n: 0, ms: 0, t0: performance.now() };
    document.getElementById("g-auto").textContent = "STOP AUTOPILOT"; window.__LA2.measuring = true; gmap.start(); hl = null;
    const step = () => { if (!A2.on) return; const n = winN(), s = Math.floor(Math.random() * (g.bases - n)), t = performance.now(), [b0, b1] = g.quick(s, n); A2.ms += performance.now() - t; A2.n++;
      const [k0, k1] = g.blockSpan(s, n); gmap.light(k0, k1); gmap.win = [s, n]; gpos.value = Math.round(s / (g.bases - n) * 1e6);
      const sec = (performance.now() - A2.t0) / 1000; window.__LA2.auto = { n: A2.n, us: A2.ms / A2.n * 1000, perSec: A2.n / sec };
      ui.set("g-out", `<p>AUTOPILOT · chr1:<b>${(s + 1).toLocaleString("en")}</b> · ${A2.n.toLocaleString("en")} jumps · <b>${(A2.ms / A2.n * 1000).toFixed(0)} µs</b> average decode per jump · ${(A2.n / sec).toFixed(0)} jumps per second (one per frame)</p>
        <div style="font:12px/1.25 monospace;background:rgba(0,0,0,.35);padding:8px;max-height:150px;overflow:hidden;letter-spacing:.5px">${basesHtml(g.text(b0, b1))}</div>`);
      requestAnimationFrame(step); };
    requestAnimationFrame(step); });
  const openGenome = () => { ui.show("genome"); jump(); }; on("b-genome", openGenome); on("b-genome2", openGenome);
  on("g-full", async () => { stopAuto(); const g = await getGenome(); ui.set("g-out", "<p>Decoding all 254 MB…</p>"); await new Promise(r => setTimeout(r, 20)); window.__LA2.measuring = true; fullMs = g.full(); window.__LA2.measuring = false; window.__LA2.fullMs = fullMs; jump(); });
  for (const b of document.querySelectorAll("#genome .back")) b.addEventListener("click", () => { stopAuto(); if (gmap) gmap.stop(); });
  let pool = null;
  on("c-run", async () => {
    ui.set("c-out", "<p>Starting the workers…</p>"); await new Promise(r => setTimeout(r, 30));
    try { if (!pool) { pool = new Pool(Math.min(16, navigator.hardwareConcurrency || 4)); await pool.init(document.getElementById("wasm-js").textContent, blob, A); }
      ui.set("c-out", `<p>Restoring on ${pool.n} cores…</p>`); window.__LA2.measuring = true; const r = await measureCores(A, pool); window.__LA2.measuring = false; window.__LA2.cores = r; ui.set("c-out", coresHtml(r)); }
    catch (e) { window.__LA2.measuring = false; ui.set("c-out", `<p class="bad">All-cores mode is not available in this browser: ${e.message}</p>`); }
  });
  // settings
  const sel = (id, list, key, cb) => { const e = document.getElementById(id); e.innerHTML = list.map(v => `<option>${v}</option>`).join(""); e.value = S[key]; e.onchange = () => { S[key] = e.value; save(); cb && cb(); }; };
  function syncSettings() {
    sel("s-codec", CODECS, "codec"); sel("s-quality", ["low", "high", "ultra"], "quality", () => fx && fx.setQuality(S.quality));
    const o = document.getElementById("s-overload"); o.checked = S.overloadFx; o.onchange = () => { S.overloadFx = o.checked; save(); };
    const v = document.getElementById("s-volume"); v.value = S.volume; v.oninput = () => { S.volume = +v.value; setVolume(S.volume); save(); };
    const s = document.getElementById("s-sens"); s.value = S.sens; s.oninput = () => { S.sens = +s.value; save(); };
  }
  document.addEventListener("pointerlockchange", () => { if (!document.pointerLockElement && !game.paused && !game.place?.won) { game.paused = true; game.started = true; ui.show("pause"); } });
  addEventListener("keydown", e => { if (e.code === "Escape" && game.paused && game.started && document.getElementById("pause").classList.contains("on")) play(); });
  let last = performance.now();
  const loop = (t) => { const dt = (t - last) / 1000; last = t; if (!window.__LA2.measuring && fx) { game.update(dt); fx.render(t / 1000); } requestAnimationFrame(loop); };   // measurements pause rendering: the main thread is not shared
  requestAnimationFrame(loop);
}
boot().catch(e => { document.getElementById("loading").textContent = "The Archive could not start: " + e.message; console.error(e); });
