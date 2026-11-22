// audio.js - synthesized sound (WebAudio, no files): ambience per place, rift whoosh, blaster, hits, puzzle chimes, boss.
let AC = null, master = null, amb = null; export let volume = 0.7;
export function initAudio() { if (AC) return; AC = new AudioContext(); master = AC.createGain(); master.gain.value = volume; master.connect(AC.destination); }
export function setVolume(v) { volume = v; if (master) master.gain.value = v; }
function noise() { const b = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
const AMB = { hub: [[55, 82.5], 300, 0.05], city: [[70, 105], 500, 0.09], forest: [[220, 330], 2600, 0.06], reactor: [[41, 82], 240, 0.12], heart: [[110, 164.8, 220], 900, 0.05] };
export function ambience(place) {
  if (!AC) return; const t = AC.currentTime;
  if (amb) { const o = amb; o.g.gain.setTargetAtTime(0, t, 0.4); setTimeout(() => o.nodes.forEach(n => { try { n.stop(); } catch (e) {} }), 2000); }
  const [fs, lp, nz] = AMB[place], g = AC.createGain(); g.gain.value = 0; g.connect(master); g.gain.setTargetAtTime(0.5, t, 1.0); const nodes = [];
  fs.forEach((f, i) => { const o = AC.createOscillator(); o.type = i ? "sine" : "triangle"; o.frequency.value = f; const og = AC.createGain(); og.gain.value = 0.06; o.connect(og); og.connect(g); o.start(); nodes.push(o); });
  const n = AC.createBufferSource(); n.buffer = noise(); n.loop = true; const f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp;
  const ng = AC.createGain(); ng.gain.value = nz; n.connect(f); f.connect(ng); ng.connect(g); n.start(); nodes.push(n); amb = { g, nodes };
}
function tone(freq, dur, type = "sine", vol = 0.2, slide = 0) {
  if (!AC) return; const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function burst(dur, f0, f1, vol) {
  if (!AC) return; const t = AC.currentTime, n = AC.createBufferSource(); n.buffer = noise(); const bp = AC.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.5;
  bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur); const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  n.connect(bp); bp.connect(g); g.connect(master); n.start(t); n.stop(t + dur);
}
export const sfx = {
  rift: () => burst(1.4, 180, 4000, 0.5), fire: () => tone(880, 0.18, "sawtooth", 0.12, 0.25), hit: () => burst(0.25, 2000, 300, 0.4),
  hurt: () => tone(140, 0.3, "square", 0.15, 0.5), boom: () => burst(0.8, 600, 60, 0.7), chime: (i = 0) => tone(523 * Math.pow(1.26, i), 0.9, "sine", 0.18),
  wrong: () => { tone(220, 0.25, "square", 0.1); setTimeout(() => tone(185, 0.35, "square", 0.1), 120); },
  key: () => [659, 784, 988, 1319].forEach((f, i) => setTimeout(() => tone(f, 1.2, "sine", 0.16), i * 90)),
  restore: () => tone(1500, 0.12, "sine", 0.04, 1.6), tick: (f = 700) => tone(f, 0.06, "square", 0.035), shield: () => tone(300, 0.2, "triangle", 0.06, 1.5),
  victory: () => [261.6, 329.6, 392, 523.3, 659.3, 784].forEach((f, i) => setTimeout(() => tone(f, 2.5, "triangle", 0.12), i * 180)),
};
