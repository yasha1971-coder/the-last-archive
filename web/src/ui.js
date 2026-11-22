// ui.js - menus, HUD and cards (English). Plain DOM over the canvas.
const $ = (id) => document.getElementById(id);
export const ui = {
  show(id) { for (const s of document.querySelectorAll(".screen")) s.classList.toggle("on", s.id === id); },
  hideAll() { for (const s of document.querySelectorAll(".screen")) s.classList.remove("on"); },
  hud(on) { $("hud").classList.toggle("on", on); },
  set(id, html) { const e = $(id); if (e) e.innerHTML = html; },
  bar(id, v) { const e = $(id); if (e) e.style.width = Math.round(Math.max(0, Math.min(1, v)) * 100) + "%"; },
  say(text, sec = 5) { const e = $("subtitle"); e.textContent = text; e.classList.add("on"); clearTimeout(this._st); this._st = setTimeout(() => e.classList.remove("on"), sec * 1000); },
  hint(text) { $("hint").textContent = text || ""; },
  card(html, sec = 7) { const e = $("card"); e.innerHTML = html; e.classList.add("on"); clearTimeout(this._ct); this._ct = setTimeout(() => e.classList.remove("on"), sec * 1000); },
  toast(text) { const e = document.createElement("div"); e.className = "toast"; e.textContent = text; $("toasts").appendChild(e); setTimeout(() => e.remove(), 2600); },
};
// where the numbers come from: the machine running this page (the browser does not reveal the CPU model)
export function hwLine() {
  const ua = navigator.userAgent, os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "this OS";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "this browser";
  return `All numbers are measured live on this machine (${navigator.hardwareConcurrency || "?"} logical cores, ${os}, ${br}; decoders on one core). Run the benchmark on your machine for your own numbers.`;
}
export const mb = (b) => (b / 1e6).toFixed(b < 1e7 ? 2 : 1) + " MB";
export const fmtMs = (m) => m < 10 ? m.toFixed(2) + " ms" : m.toFixed(1) + " ms";
export function restoreCard(b) {
  return `<div class="ct">ARCHIVE RESTORE · ${b.title}</div>
  <table><tr><td>Decoder</td><td style="color:${({ACEAPEX:"#3fd8ff",zstd:"#ffa53a",LZ4HC:"#d65bff"})[b.codec]}">${b.codec}</td></tr><tr><td>Chunks</td><td>${b.n}</td></tr>
  <tr><td>Read from archive</td><td>${mb(b.read)}</td></tr><tr><td>Restored</td><td>${mb(b.bytes)}</td></tr>
  <tr><td>Decode time (sum)</td><td>${fmtMs(b.ms)}</td></tr><tr><td>Until fully assembled</td><td>${(b.wall / 1000).toFixed(2)} s</td></tr>
  <tr><td>Frames over 20 ms</td><td>${b.slow}</td></tr><tr><td>sha256 verified</td><td>${b.ok}/${b.n} ${b.ok === b.n ? "✓" : "✗"}</td></tr></table>`;
}
