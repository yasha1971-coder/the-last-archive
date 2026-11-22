// main.js - boot: wasm decoders + embedded Archive blob -> FX + Game; menus; main loop.
import { Archive, CODECS } from "./archive.js";
import { FX } from "./fx.js";
import { Game } from "./game.js";
import { initAudio, setVolume } from "./audio.js";
import { ui, mb, hwLine } from "./ui.js";
import { runBenchmark } from "./bench.js";
import { measureDuel, measureStress, stressHtml, SCENES, verdictLine, measureCurve, curveSvg, measureCores, coresHtml } from "./lab.js";
import { Pool } from "./pool.js";
import { Genome, jumpHtml } from "./genome.js";
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
  let genome = null, fullMs = 0;
  const gpos = document.getElementById("g-pos"), gwin = document.getElementById("g-win");
  async function getGenome() { if (!genome) { ui.set("g-out", "<p>Opening the chromosome archive…</p>"); await new Promise(r => setTimeout(r, 20));
      const b64 = document.getElementById("chr1-data").textContent.trim(); if (!b64) throw new Error("this build has no chromosome inside");
      let b; try { b = new Uint8Array(await (await fetch("data:application/octet-stream;base64," + b64)).arrayBuffer()); }
      catch (e) { b = new Uint8Array(b64.length * 3 / 4); let o = 0; for (let i = 0; i < b64.length; i += 4 << 18) { const part = atob(b64.slice(i, i + (4 << 18))); for (let k = 0; k < part.length; k++) b[o++] = part.charCodeAt(k); } b = b.subarray(0, o); }   // fallback: decode in pieces
      genome = new Genome(M, b); window.__LA2.genome = genome; } return genome; }
  const jump = async () => { try { const g = await getGenome(), start = Math.floor(+gpos.value / 1e6 * (g.bases - +gwin.value)); window.__LA2.measuring = true;
      const r = g.jump(start, +gwin.value); window.__LA2.measuring = false; window.__LA2.jump = r; ui.set("g-out", jumpHtml(g, start, r, fullMs)); } catch (e) { window.__LA2.measuring = false; ui.set("g-out", `<p class="bad">${e.message}</p>`); } };
  gpos.oninput = jump; gwin.onchange = jump;
  const openGenome = () => { ui.show("genome"); jump(); }; on("b-genome", openGenome); on("b-genome2", openGenome);
  on("g-full", async () => { const g = await getGenome(); ui.set("g-out", "<p>Decoding all 254 MB…</p>"); await new Promise(r => setTimeout(r, 20)); window.__LA2.measuring = true; fullMs = g.full(); window.__LA2.measuring = false; window.__LA2.fullMs = fullMs; jump(); });
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
