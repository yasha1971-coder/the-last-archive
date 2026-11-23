// game.js - THE LAST ARCHIVE. "You don't load the world. The Archive returns it to you."
// Places are restored chunk by chunk from the Archive (three decoders, switchable); chunks assemble out of light and fold
// away again when the Archive no longer needs them. Puzzles rebuild streets, the beam melts the ice, valves raise bridges.
import * as THREE from "three";
import { CODECS, DECODER_COLOR, DECODER_CSS } from "./archive.js";
import { makeChests, Duel } from "./lab.js";
import { parseMesh, parseTextures, makeMaterials } from "./assets.js";
import { makeSky, makeParticles, makePortal, makeBeam, glowSphere } from "./fx.js";
import { ambience, sfx } from "./audio.js";
import { ui, restoreCard, mb, hwLine } from "./ui.js";

const PLACE = {
  hub:     { title: "The Station", fog: [0x05080d, 0.012], sun: [0x8fd0ff, 0.7], amb: [0x3a5070, 0x080a10, 0.9], spawn: [0, 10, 0], R: 17 },
  city:    { title: "The Forgotten City", fog: [0x1a0c26, 0.012], sun: [0xc8b8ff, 0.9], amb: [0x553366, 0x110818, 0.8], spawn: [0, -14, Math.PI], R: 115 },
  forest:  { title: "The Frozen Forest", fog: [0x41566e, 0.013], sun: [0xcfe4ff, 0.8], amb: [0x8aa6c4, 0x1c2633, 0.6], spawn: [0, -12, Math.PI], R: 100 },
  reactor: { title: "The Reactor", fog: [0x0a0806, 0.014], sun: [0xff9a50, 0.6], amb: [0x442211, 0x050302, 0.7], spawn: [0, 48, 0], R: 58 },
  heart:   { title: "The Heart of the Archive", fog: [0x2a1804, 0.010], sun: [0xffd27a, 1.0], amb: [0x664422, 0x110800, 0.8], spawn: [0, 32, 0], R: 37 },
};
const RIFTS = [{ to: "city", pos: [0, -15], rot: 0, color: 0xff9a3c }, { to: "forest", pos: [15, 0], rot: -Math.PI / 2, color: 0x7ad8ff },
               { to: "reactor", pos: [-15, 0], rot: Math.PI / 2, color: 0x5aff8a }, { to: "heart", pos: [0, 15], rot: Math.PI, color: 0xffd27a }];
const LOAD_R = 75, FOLD_R = 115;

export class Game {
  constructor(fx, archive, settings) {
    this.fx = fx; this.A = archive; this.S = settings; this.keys = new Set(); this.down = {}; this.mouse = { dx: 0, dy: 0, fire: false, shield: false };
    this.yaw = 0; this.pitch = 0; this.pos = new THREE.Vector2(); this.hp = 100; this.energy = 100; this.t = 0; this.frameMs = 16.7; this.slowFrames = 0;
    this.texCache = {}; this.places = {}; this.tunnel = null; this.paused = true; this.hurt = 0; this.overload = 0; this.surge = 0;
    this.droneGeo = null; this.batch = null; this.stats = { slow: 0 };
    addEventListener("keydown", e => this.key(e, true)); addEventListener("keyup", e => this.key(e, false));
    addEventListener("mousemove", e => { if (document.pointerLockElement) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    addEventListener("mousedown", e => { if (!document.pointerLockElement) return; if (e.button === 0) this.mouse.fire = true; if (e.button === 2) this.mouse.shield = true; });
    addEventListener("mouseup", e => { if (e.button === 2) this.mouse.shield = false; });
    addEventListener("contextmenu", e => e.preventDefault());
  }
  key(e, d) { const k = e.code; if (d && !this.down[k]) this.edge = (this.edge || new Set()).add(k); this.down[k] = d; if (["Space", "ArrowUp", "ArrowDown", "Tab"].includes(k)) e.preventDefault(); }
  pressed(k) { return this.edge && this.edge.has(k); }

  // ---------------- Archive: textures, chunks, assembly ----------------
  textures(frag) {
    if (!this.texCache[frag]) { const { data, rec } = this.A.restore(frag + "_textures", this.S.codec); this.note(rec); this.texCache[frag] = parseTextures(data); }
    return this.texCache[frag];
  }
  note(rec) { if (this.batch) { const b = this.batch; b.n++; b.read += rec.read; b.bytes += rec.bytes; b.ms += rec.ms; b.ok += rec.ok ? 1 : 0; } sfx.restore(); }
  restoreChunk(P, name) {
    const c = this.A.byName[name]; if (P.chunks[name]) { if (P.chunks[name].state === "folding") P.chunks[name].state = "assembling"; return; }
    const { data, rec } = this.A.restore(c, this.S.codec); this.note(rec);
    const { mats, uniforms } = makeMaterials(c.fragment === "hub" ? "hub" : P.frag, this.textures(c.fragment === "hub" ? "hub" : P.frag), DECODER_COLOR[this.S.codec]);
    const mesh = new THREE.Mesh(parseMesh(data), mats); P.scene.add(mesh);
    P.chunks[name] = { mesh, uniforms, state: "assembling", c };
  }
  foldChunk(P, name) { const k = P.chunks[name]; if (k && k.state !== "folding") k.state = "folding"; }
  animateChunks(P, dt) {
    for (const [name, k] of Object.entries(P.chunks)) {
      const u = k.uniforms.uReveal;
      if (k.state === "assembling") { u.value = Math.min(1, u.value + dt / 1.1); if (u.value >= 1) k.state = "shown"; }
      else if (k.state === "folding") { u.value = Math.max(0, u.value - dt / 0.7); if (u.value <= 0) { P.scene.remove(k.mesh); k.mesh.geometry.dispose(); k.mesh.material.forEach(m => m.dispose()); delete P.chunks[name]; } }
    }
  }
  colliders(P) { const out = [...(P.walls || [])]; for (const k of Object.values(P.chunks)) if (k.uniforms.uReveal.value > 0.5) for (const b of k.c.colliders) out.push(b); return out; }
  stream(P) {                                                                      // the Archive keeps near what you approach
    let budget = 1;
    for (const c of P.streamable) {
      const d = Math.hypot(c.center[0] - this.pos.x, c.center[1] - this.pos.y), have = P.chunks[c.name], allowed = !c.gated || P.unlocked.has(c.name);
      if (allowed && d < LOAD_R && (!have || have.state === "folding") && budget > 0) { this.restoreChunk(P, c.name); budget--; }
      else if (have && d > FOLD_R && !P.pinned.has(c.name)) this.foldChunk(P, c.name);
    }
    if (this.batch && budget > 0 && performance.now() - this.batch.t0 > 300 && !this.batch.done) {   // queue drained: report the batch
      const b = this.batch; b.done = true; b.wall = performance.now() - b.t0 + 1100; b.slow = this.stats.slow - b.slow0;
      ui.card(restoreCard(b));
    }
  }

  // ---------------- places ----------------
  build(frag) {
    const cfg = PLACE[frag], scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(...cfg.fog); scene.add(makeSky(frag));
    scene.add(new THREE.HemisphereLight(...cfg.amb)); const sun = new THREE.DirectionalLight(...cfg.sun); sun.position.set(30, 60, -40); scene.add(sun);
    const P = { frag, scene, chunks: {}, streamable: [], pinned: new Set(), unlocked: new Set(), ents: [], walls: [], drones: [], orbs: [], fx: [] };
    const mine = this.A.chunks.filter(c => c.fragment === frag && c.kind === "mesh" && !c.name.startsWith("guardian"));
    for (const c of mine) { if (c.center) P.streamable.push(c); else { P.pinned.add(c.name); } }
    const R = cfg.R; P.walls.push([-R - 5, -R - 5, R + 5, -R], [-R - 5, R, R + 5, R + 5], [-R - 5, -R, -R, R], [R, -R, R + 5, R]);
    P.particles = makeParticles(frag === "forest" ? 2500 : 1200, { hub: 0x66ccff, city: 0xffaa66, forest: 0xffffff, reactor: 0xff7733, heart: 0xffd27a }[frag], frag === "hub" ? 34 : 160, frag === "forest" ? 0.12 : 0.08);
    scene.add(P.particles); this.places[frag] = P;
    if (frag !== "hub") {                                                          // the return door: always there, behind the spawn
      const [sx, sz, syaw] = cfg.spawn, ex = sx + Math.sin(syaw) * 4, ez = sz + Math.cos(syaw) * 4, door = makePortal(0x9fe8ff, 3.6, 5.2);
      door.position.set(ex, 2.7, ez); door.rotation.y = syaw; door.material.uniforms.uClarity.value = 1; scene.add(door); P.exit = { x: ex, z: ez, mesh: door };
    }
    this["setup_" + frag](P); return P;
  }
  enter(frag) {
    const prev = this.place; if (prev && prev.frag !== "hub") { for (const n of Object.keys(prev.chunks)) this.foldChunk(prev, n); this.leaving = prev; delete this.places[prev.frag]; delete this.texCache[prev.frag]; }
    this.batch = { title: PLACE[frag].title, codec: this.S.codec, n: 0, read: 0, bytes: 0, ms: 0, ok: 0, t0: performance.now(), slow0: this.stats.slow };
    const P = this.places[frag] || this.build(frag); this.place = P;
    for (const n of P.pinned) this.restoreChunk(P, n);
    const [x, z, yaw] = PLACE[frag].spawn; this.pos.set(x, z); this.yaw = yaw; this.pitch = 0;
    this.fx.setScene(P.scene); ambience(frag); P.drones.forEach(d => P.scene.remove(d.obj)); P.drones = []; P.orbs.forEach(o => P.scene.remove(o.obj)); P.orbs = [];
    P.done = P.done || this.keys.has(frag);
    if (this.keys.has(frag)) ui.say("ARCHIVE: You already carry this world's key. Press [E] anywhere — or walk to the door behind you — to return.", 6);
    else if (P.onEnter) P.onEnter(P);
  }
  riftTo(frag) { if (this.tunnel) return; sfx.rift(); this.tunnel = { t: 0, to: frag, swapped: false }; this.fx.glitch.uniforms.uTint.value.set(DECODER_COLOR[this.S.codec]); }   // the tunnel wears the decoder colour

  setup_hub(P) {
    P.core = new THREE.Group(); P.core.position.set(0, 3.2, 0); P.scene.add(P.core);
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 1), new THREE.MeshBasicMaterial({ color: 0x3fb8e8, wireframe: true, transparent: true, opacity: 0.8 }));
    const inner = glowSphere(0x1f6e94, 1.0); P.core.add(shell, inner); P.coreShell = shell;
    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0x8fcfff, 25, 26); const a = i * Math.PI / 3; l.position.set(Math.cos(a) * 12, 9, Math.sin(a) * 12); P.scene.add(l); }
    P.light = new THREE.PointLight(0x7fd8ff, 40, 30); P.light.position.set(0, 4, 0); P.scene.add(P.light);
    P.rifts = RIFTS.map(r => { const m = makePortal(r.color, 4.5, 6.5); m.position.set(r.pos[0], 3.3, r.pos[1]); m.rotation.y = r.rot; P.scene.add(m); return { ...r, mesh: m }; });
    P.walls.push([-2.6, -2.6, 2.6, 2.6]);
    // ARCHIVE LAB in the Station: chests (archive cost), console, duel pedestals
    P.chests = makeChests(P.scene, this.A); for (const c of Object.values(P.chests)) P.walls.push([c.x - c.e / 2, c.z - c.e / 2, c.x + c.e / 2, c.z + c.e / 2]);
    const con = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.1, 6), new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.7, roughness: 0.3 })); con.position.set(0, 0.55, 6.5);
    P.conGlow = glowSphere(0x9fe8ff, 0.28); P.conGlow.position.set(0, 1.4, 6.5); P.scene.add(con, P.conGlow); P.walls.push([-0.7, 5.8, 0.7, 7.2]);
    for (const x of [-4.6, 4.6]) { const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.7, 1.2, 32), new THREE.MeshStandardMaterial({ color: 0x1a2430, metalness: 0.6, roughness: 0.4 }));
      ped.position.set(x, 0.6, 5.6); P.scene.add(ped); P.walls.push([x - 2.5, 3.1, x + 2.5, 8.1]); }
    P.duel = new Duel(this, P.scene); this.ui = ui;
    P.onEnter = () => { if (!this.introDone) { this.introDone = true; ui.say("ARCHIVE: I can return your world. Not all at once. Choose a fragment.", 7); } };
    P.update = (dt) => {
      P.core.scale.setScalar(1 + 0.08 * Math.sin(this.t * 2)); P.coreShell.rotation.y += dt * 0.4; P.coreShell.rotation.x += dt * 0.15; P.light.intensity = 30 + 15 * Math.sin(this.t * 2);
      let near = null;
      for (const r of P.rifts) {
        const d = Math.hypot(r.pos[0] - this.pos.x, r.pos[1] - this.pos.y), sealed = r.to === "heart" && this.keys.size < 3;
        r.mesh.material.uniforms.uTime.value = this.t; r.mesh.material.uniforms.uSealed.value = sealed ? 1 : 0;
        r.mesh.material.uniforms.uColor.value.set(DECODER_COLOR[this.S.codec]).lerp(new THREE.Color(r.color), 0.2);   // decoder colour code
        const pre = this.texCache[r.to] ? 1 : 0; r.mesh.material.uniforms.uClarity.value += ((d < 9 && !sealed ? 0.35 + 0.65 * pre : 0.1) - r.mesh.material.uniforms.uClarity.value) * dt * 2;
        if (d < 9 && !sealed && !this.texCache[r.to] && !this.tunnel) this.textures(r.to);          // pre-restore: the rift sharpens as you approach
        if (d < 4) near = { r, sealed };
      }
      const flow = this.A.flowMBs();
      for (const [d, c] of Object.entries(P.chests)) c.mesh.material.emissiveIntensity = d === this.S.codec ? 0.35 + 0.65 * Math.min(1, flow / 40) + 0.15 * Math.sin(this.t * 3) : 0.08;
      if (P.duel.countdown > 0) { this.pos.y += (13.2 - this.pos.y) * Math.min(1, this.dtv * 1.2); }   // camera pulls back during the countdown
      if (P.duel.awaitReal && this.pressed("KeyR")) P.duel.replayReal();
      P.duel.update(this.dtv); ui.set("duelcap", P.duel.caption());
      P.conGlow.material.color.set(DECODER_COLOR[this.S.codec]);
      const nearCon = Math.hypot(this.pos.x, this.pos.y - 6.5) < 2.4;
      if (nearCon) { ui.hint("[E] ARCHIVE LAB — Portal Duel · Stress Test"); if (this.pressed("KeyE") && this.onLab) this.onLab(); }
      else if (near) {
        ui.hint(near.sealed ? `SEALED — the Heart needs three keys (${this.keys.size}/3)` : `[E] Enter ${PLACE[near.r.to].title}`);
        if (this.pressed("KeyE")) { if (near.sealed) { sfx.wrong(); ui.say("ARCHIVE: The Heart stays closed. Bring me the three keys.", 4); } else this.riftTo(near.r.to); }
      } else ui.hint(this.keys.size === 3 ? "The Heart of the Archive is open (south)." : "Approach a rift.");
    };
  }
  keyItem(P, x, z, label) {
    const k = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), new THREE.MeshBasicMaterial({ color: 0xffe08a })); k.position.set(x, 1.4, z); P.scene.add(k);
    const l = new THREE.PointLight(0xffd27a, 30, 14); l.position.set(x, 2, z); P.scene.add(l);
    P.key = { obj: k, light: l, x, z, label }; ui.say(`ARCHIVE: ${label} restored. Take it.`, 5);
  }
  updateKey(P, dt) {
    if (!P.key) return; P.key.obj.rotation.y += dt * 2; P.key.obj.position.y = 1.4 + 0.25 * Math.sin(this.t * 3);
    if (Math.hypot(P.key.x - this.pos.x, P.key.z - this.pos.y) < 1.6) { this.keys.add(P.frag); sfx.key(); P.scene.remove(P.key.obj); P.scene.remove(P.key.light); P.key = null; P.done = true;
      ui.say(`Key ${this.keys.size}/3. Press [E] anywhere — the Archive will take you back.`, 6); }
  }
  setup_city(P) {
    const cols = [0xffb347, 0x5ee7ff, 0xc77dff, 0x7dff9a], names = ["AMBER", "CYAN", "VIOLET", "GREEN"], order = [2, 0, 3, 1];
    const groups = [["city_block_-1_1", "city_block_0_1"], ["city_block_1_1"], ["city_block_-1_2", "city_block_1_2"], ["city_block_0_2"]];
    P.lanterns = [[-9, -9], [9, -9], [9, 9], [-9, 9]].map(([x, z], i) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 4, 8), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7 })); post.position.set(x, 2, z);
      const lamp = glowSphere(cols[i], 0.45); lamp.position.set(x, 4.2, z); lamp.material.color.multiplyScalar(0.15);
      const light = new THREE.PointLight(cols[i], 0, 22); light.position.set(x, 4.2, z); P.scene.add(post, lamp, light); P.walls.push([x - .4, z - .4, x + .4, z + .4]);
      return { x, z, lamp, light, col: cols[i], lit: false };
    });
    const mono = new THREE.Mesh(new THREE.BoxGeometry(1.2, 5, 0.5), new THREE.MeshStandardMaterial({ color: 0x222233, emissive: 0x000000 })); mono.position.set(0, 2.5, 0); P.scene.add(mono); P.walls.push([-.7, -.4, .7, .4]);
    let step = 0;
    P.onEnter = () => ui.say("ARCHIVE: The city remembers its lights. The echoes on the monolith know the order.", 7);
    P.update = (dt) => {
      const k = Math.floor(this.t * 1.2) % 5; mono.material.emissive.set(k < 4 ? cols[order[k]] : 0x000000).multiplyScalar(0.6);
      let near = null; for (const [i, L] of P.lanterns.entries()) if (Math.hypot(L.x - this.pos.x, L.z - this.pos.y) < 3) near = i;
      const dm = Math.hypot(this.pos.x, this.pos.y);
      if (P.done) ui.hint("Press [E] to return to the Station");
      else if (near !== null) ui.hint(P.lanterns[near].lit ? "This lantern burns." : "[E] Light the lantern");
      else if (dm < 6) ui.hint(`The echoes remember: ${order.map(i => names[i]).join(" → ")}`);
      else ui.hint(step < 4 ? `Lanterns lit ${step}/4 — the monolith shows the order` : "Find the key on the restored street (north).");
      if (this.pressed("KeyE") && near !== null && !P.lanterns[near].lit && step < 4) {
        if (near === order[step]) {
          const L = P.lanterns[near]; L.lit = true; L.lamp.material.color.set(L.col); L.light.intensity = 60; sfx.chime(step);
          for (const n of groups[step]) { P.unlocked.add(n); this.restoreChunk(P, n); P.pinned.add(n); }
          step++; ui.toast(`The Archive restored ${groups[step - 1].length} street${groups[step - 1].length > 1 ? "s" : ""}`);
          if (step === 4) this.keyItem(P, 0, 70, "The Key of Memory");
        } else {
          sfx.wrong(); ui.say("ARCHIVE: Wrong memory. The streets fall apart.", 4);
          for (let s = 0; s < step; s++) for (const n of groups[s]) { P.unlocked.delete(n); P.pinned.delete(n); this.foldChunk(P, n); }
          P.lanterns.forEach(L => { L.lit = false; L.lamp.material.color.set(L.col).multiplyScalar(0.15); L.light.intensity = 0; }); step = 0;
          this.spawnDrones(P, 2);
        }
      }
      this.updateKey(P, dt);
    };
  }
  setup_forest(P) {
    const M = [{ x: 0, z: 0, want: 0 }, { x: 0, z: 24, want: 2 }, { x: -14, z: 24, want: 2 }];
    P.mirrors = M.map((m, i) => { m.state = [1, 0, 3][i];
      const g = new THREE.Group(); const plate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 0.15), new THREE.MeshStandardMaterial({ color: 0xcfefff, metalness: 1, roughness: 0.05 }));
      plate.position.y = 1.6; g.add(plate, new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1, 8), new THREE.MeshStandardMaterial({ color: 0x556677 })));
      g.position.set(m.x, 0, m.z); P.scene.add(g); m.obj = g; P.walls.push([m.x - .5, m.z - .5, m.x + .5, m.z + .5]); return m; });
    const src = glowSphere(0x9ff0ff, 0.6); src.position.set(-14, 1.6, 0); P.scene.add(src);
    const recv = glowSphere(0x3a6a88, 1.1); recv.position.set(-14, 1.6, 56); P.scene.add(recv); P.walls.push([-15, 55, -13, 57]);
    P.beams = Array.from({ length: 5 }, () => { const b = makeBeam(0x9ff0ff); P.scene.add(b); return b; });
    const dirs = { "1,0": [0, 1], "0,1": [1, 0], "-1,0": [0, -1], "0,-1": [-1, 0] };            // '/' state 0
    const dirs2 = { "1,0": [0, -1], "0,-1": [1, 0], "-1,0": [0, 1], "0,1": [-1, 0] };           // '\' state 2
    let solved = false;
    const trace = () => {
      let x = -14, z = 0, dx = 1, dz = 0, seg = 0, hit = false;
      for (let n = 0; n < 5; n++) {
        let best = null, bd = 1e9;
        for (const m of P.mirrors) { const rx = m.x - x, rz = m.z - z, t = rx * dx + rz * dz; if (t > 0.5 && Math.abs(rx * dz - rz * dx) < 0.5 && t < bd) { bd = t; best = m; } }
        const rx = -14 - x, rz = 56 - z, tr = rx * dx + rz * dz; const recvHit = tr > 0.5 && Math.abs(rx * dz - rz * dx) < 0.8 && tr < bd;
        const len = recvHit ? tr : best ? bd : 70, b = P.beams[seg++];
        b.visible = true; b.scale.set(1, len, 1); b.position.set(x + dx * len / 2, 1.6, z + dz * len / 2); b.rotation.set(dz ? Math.PI / 2 : 0, 0, dx ? Math.PI / 2 : 0);
        if (recvHit) { hit = true; break; } if (!best) break;
        x = best.x; z = best.z; const map = best.state === 0 ? dirs : best.state === 2 ? dirs2 : null; if (!map) break; [dx, dz] = map[`${dx},${dz}`];
      }
      for (; seg < P.beams.length; seg++) P.beams[seg].visible = false;
      return hit;
    };
    P.onEnter = () => ui.say("ARCHIVE: The forest froze around its heart. Guide the light through the ice mirrors.", 7);
    P.update = (dt) => {
      const hit = trace(); let near = null; for (const m of P.mirrors) if (Math.hypot(m.x - this.pos.x, m.z - this.pos.y) < 3) near = m;
      if (P.done) ui.hint("Press [E] to return to the Station");
      else if (near && !solved) ui.hint("[E] Turn the mirror");
      else ui.hint(solved ? "The ice melts. The giant tree returns (north)." : "Lead the beam to the frost heart (north-west).");
      if (near && !solved && this.pressed("KeyE")) { near.state = (near.state + 1) % 4; near.obj.rotation.y = near.state * Math.PI / 4 + Math.PI / 4; sfx.chime(near.state); }
      if (hit && !solved) { solved = true; recv.material.color.set(0x9ff0ff); sfx.key(); P.unlocked.add("forest_cell_0_2"); this.restoreChunk(P, "forest_cell_0_2"); P.pinned.add("forest_cell_0_2");
        ui.toast("The Archive restored the giant tree"); setTimeout(() => this.keyItem(P, 0, 70, "The Key of Life"), 1500); this.spawnDrones(P, 2); }
      this.updateKey(P, dt);
    };
    P.mirrors.forEach(m => m.obj.rotation.y = m.state * Math.PI / 4 + Math.PI / 4);
  }
  setup_reactor(P) {
    const press = [2, 3, 1]; let next = 1, timer = 0;
    P.valves = [0, 1, 2].map(b => { const t = 2 * Math.PI * b / 3 + 0.3, x = Math.cos(t) * 11, z = Math.sin(t) * 11;
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.15, 8, 24), new THREE.MeshStandardMaterial({ color: 0xaa3322, metalness: 0.6 })); w.position.set(x, 1.4, z); w.rotation.y = t;
      const lamp = glowSphere(0xff3311, 0.25); lamp.position.set(x, 2.6, z); P.scene.add(w, lamp); P.walls.push([x - .6, z - .6, x + .6, z + .6]); return { x, z, w, lamp, b, open: false }; });
    P.coreLight = new THREE.PointLight(0xff8a3a, 20, 60); P.coreLight.position.set(0, 20, 0); P.scene.add(P.coreLight);
    const reset = (why) => { sfx.wrong(); ui.say(`ARCHIVE: ${why} The bridges collapse.`, 4); next = 1; timer = 0;
      P.valves.forEach(v => { v.open = false; v.lamp.material.color.set(0xff3311); const n = `reactor_bridge_${v.b}`; P.unlocked.delete(n); P.pinned.delete(n); this.foldChunk(P, n); }); };
    P.onEnter = () => ui.say("ARCHIVE: The reactor is dying. Open the valves from lowest pressure to highest — before it cools.", 7);
    P.update = (dt) => {
      let near = null; for (const v of P.valves) if (Math.hypot(v.x - this.pos.x, v.z - this.pos.y) < 3) near = v;
      if (timer > 0) { timer -= dt; if (timer <= 0 && next <= 3) reset("Too slow — the core cooled."); }
      P.coreLight.intensity = 20 + (next - 1) * 40 + 10 * Math.sin(this.t * 6);
      if (P.done) ui.hint("Press [E] to return to the Station");
      else if (near && !near.open) ui.hint(`Pressure gauge: ${press[near.b]}   [E] Open the valve`);
      else ui.hint(next <= 3 ? `Valves open ${next - 1}/3${timer > 0 ? ` — ${Math.ceil(timer)} s left` : ""}` : "The core burns again. Take the key (south of the core).");
      if (near && !near.open && next <= 3 && this.pressed("KeyE")) {
        if (press[near.b] === next) { near.open = true; near.lamp.material.color.set(0x55ff88); sfx.chime(next); const n = `reactor_bridge_${near.b}`; P.unlocked.add(n); this.restoreChunk(P, n); P.pinned.add(n);
          if (next === 1) timer = 45; next++; this.spawnDrones(P, 2); ui.toast("The Archive restored a bridge");
          if (next === 4) { timer = 0; this.keyItem(P, 0, -16, "The Key of Fire"); } }
        else reset("Wrong valve.");
      }
      this.updateKey(P, dt);
    };
  }
  setup_heart(P) {
    P.boss = { phase: -1, hp: 0, cool: 3, group: new THREE.Group(), core: glowSphere(0xffe08a, 2.2) };
    P.boss.core.position.set(0, 10, 0); P.scene.add(P.boss.group, P.boss.core);
    P.bossLight = new THREE.PointLight(0xffc060, 80, 80); P.bossLight.position.set(0, 12, 0); P.scene.add(P.bossLight);
    const nextPhase = () => {
      const B = P.boss; if (B.phase >= 0) this.foldChunk(P, `guardian_phase_${B.phase}`);
      B.phase++; if (B.phase > 2) return this.victory(P);
      B.hp = 25; this.restoreChunk(P, `guardian_phase_${B.phase}`); this.surge = 1;
      ui.say(["ARCHIVE: It wears the city. It is not the city.", "ARCHIVE: Now it wears the ice.", "ARCHIVE: The last form — the reactor's fire. End it."][B.phase], 5);
      this.spawnDrones(P, 2 + B.phase);
    };
    P.onEnter = () => { ui.say("ARCHIVE: The Guardian — a broken restoration of every world. Strike its core.", 6); setTimeout(() => { if (P.boss.phase < 0) nextPhase(); }, 2500); };
    P.hitBoss = () => { const B = P.boss; if (B.phase < 0 || B.phase > 2) return; B.hp--; sfx.hit(); B.core.scale.setScalar(1.25); if (B.hp <= 0) { sfx.boom(); this.burst(P, B.core.position, 0xffd27a, 120); nextPhase(); } };
    P.update = (dt) => {
      const B = P.boss; const ch = B.phase >= 0 ? P.chunks[`guardian_phase_${B.phase}`] : null;
      if (ch) { ch.mesh.rotation.y += dt * (0.4 + B.phase * 0.25); ch.mesh.position.y = Math.sin(this.t) * 0.8; }
      B.core.scale.lerp(new THREE.Vector3(1, 1, 1), dt * 4); B.core.position.y = 10 + Math.sin(this.t) * 0.8;
      if (B.phase >= 0 && B.phase <= 2 && !P.won) {
        B.cool -= dt; if (B.cool <= 0) { B.cool = 3.2 - B.phase * 0.6; const n = 6 + B.phase * 3;
          for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n + this.t; this.orb(P, new THREE.Vector3(0, 9, 0), new THREE.Vector3(Math.cos(a), -0.35, Math.sin(a)).normalize().multiplyScalar(11)); } }
        ui.hint(`GUARDIAN — form ${B.phase + 1}/3 · core ${B.hp}/25 · [LMB/F] fire  [RMB/Q] shield`);
      }
    };
  }
  victory(P) {
    P.won = true; sfx.victory(); ui.say("ARCHIVE: The planet is whole again. Thank you, Keybearer.", 10);
    const L = this.A.log, by = {}; for (const r of L) { const b = by[r.codec] = by[r.codec] || { n: 0, ms: 0, bytes: 0, read: 0 }; b.n++; b.ms += r.ms; b.bytes += r.bytes; b.read += r.read; }
    const rows = Object.entries(by).map(([c, b]) => `<tr><td>${c}</td><td>${b.n}</td><td>${mb(b.read)}</td><td>${mb(b.bytes)}</td><td>${b.ms.toFixed(1)} ms</td></tr>`).join("");
    setTimeout(() => { this.paused = true; document.exitPointerLock?.(); ui.set("endstats", `<table class="bench"><tr><th>Decoder</th><th>Restores</th><th>Read</th><th>Restored</th><th>Decode time</th></tr>${rows}</table>
      <p class="verdict">Every chunk of every world came out of one archive and was checked against its sha256 (${L.filter(r => r.ok).length}/${L.length}). Frames over 20 ms during play: ${this.stats.slow}.</p><p><small>${hwLine()}</small></p>`); ui.show("ending"); }, 6000);
  }

  // ---------------- combat ----------------
  droneMesh() {
    if (!this.droneGeo) { const { data, rec } = this.A.restore("drone", this.S.codec); this.note(rec); this.droneGeo = parseMesh(data); this.droneMats = makeMaterials("hub", this.textures("hub")); this.droneMats.uniforms.uReveal.value = 1; }
    const g = new THREE.Group(); g.add(new THREE.Mesh(this.droneGeo, this.droneMats.mats)); const eye = glowSphere(0xff3344, 0.28); eye.position.z = 0.55; g.add(eye); return g;
  }
  spawnDrones(P, n) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 16 + Math.random() * 8, obj = this.droneMesh();
      obj.position.set(this.pos.x + Math.cos(a) * r, 3 + Math.random() * 2, this.pos.y + Math.sin(a) * r); P.scene.add(obj); this.burst(P, obj.position, 0xff4466, 40);
      P.drones.push({ obj, hp: 3, cool: 1.5 + Math.random() * 2, phase: Math.random() * 6 }); }
  }
  orb(P, from, vel) { const o = glowSphere(0xff5533, 0.3); o.position.copy(from); P.scene.add(o); P.orbs.push({ obj: o, vel, life: 6 }); }
  burst(P, at, color, n) {
    const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), v = []; for (let i = 0; i < n; i++) { p.set([at.x, at.y, at.z], 3 * i); v.push(new THREE.Vector3(Math.random() - .5, Math.random() - .3, Math.random() - .5).multiplyScalar(14)); }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3)); const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 0.35, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    P.scene.add(pts); P.fx.push({ pts, v, life: 1 });
  }
  fire(P) {
    if (this.fireCool > 0) return; this.fireCool = 0.18; sfx.fire();
    const cam = this.fx.camera, dir = new THREE.Vector3(); cam.getWorldDirection(dir); const ray = new THREE.Ray(cam.position.clone(), dir);
    let best = null, bd = 120; const hitSphere = (c, r) => { const t = ray.distanceSqToPoint(c) < r * r ? cam.position.distanceTo(c) : null; return t; };
    for (const d of P.drones) { const t = hitSphere(d.obj.position, 1.1); if (t !== null && t < bd) { bd = t; best = { d }; } }
    if (P.boss && P.boss.phase >= 0) { const t = hitSphere(P.boss.core.position, 2.4); if (t !== null && t < bd) { bd = t; best = { boss: true }; } }
    const end = cam.position.clone().addScaledVector(dir, bd), b = makeBeam(0x9ff0ff); b.material.opacity = 1;
    b.position.copy(cam.position.clone().add(end).multiplyScalar(0.5).add(new THREE.Vector3(0, -0.25, 0))); b.scale.set(0.6, bd, 0.6);
    b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); P.scene.add(b); P.fx.push({ beam: b, life: 0.09 });
    if (best?.d) { best.d.hp--; sfx.hit(); if (best.d.hp <= 0) { sfx.boom(); this.burst(P, best.d.obj.position, 0xff6644, 70); P.scene.remove(best.d.obj); P.drones = P.drones.filter(x => x !== best.d); } }
    if (best?.boss) P.hitBoss();
  }
  combat(P, dt) {
    this.fireCool = (this.fireCool || 0) - dt;
    const shield = (this.down.KeyQ || this.mouse.shield) && this.energy > 5; this.shieldOn = shield; this.energy = Math.min(100, this.energy + (shield ? -35 : 18) * dt);
    if ((this.mouse.fire || this.down.KeyF) && !this.tunnel) this.fire(P); this.mouse.fire = false;
    const me = new THREE.Vector3(this.pos.x, 1.6, this.pos.y);
    for (const d of P.drones) {
      d.phase += dt; const want = me.clone().add(new THREE.Vector3(Math.cos(d.phase * 0.7) * 10, 2.5 + Math.sin(d.phase) * 1.5, Math.sin(d.phase * 0.7) * 10));
      d.obj.position.lerp(want, dt * 0.8); d.obj.lookAt(me); d.obj.children[0].rotation.z += dt * 3;
      d.cool -= dt; if (d.cool <= 0) { d.cool = 2 + Math.random() * 1.5; this.orb(P, d.obj.position.clone(), me.clone().sub(d.obj.position).normalize().multiplyScalar(13)); }
    }
    for (const o of P.orbs) { o.obj.position.addScaledVector(o.vel, dt); o.life -= dt;
      if (o.obj.position.distanceTo(me) < 0.9) { o.life = 0; if (shield) { sfx.shield(); this.energy -= 8; } else { this.hp -= 12; this.hurt = 1; sfx.hurt(); } } }
    P.orbs = P.orbs.filter(o => { if (o.life <= 0 || o.obj.position.y < 0) { P.scene.remove(o.obj); return false; } return true; });
    if (this.hp <= 0) { this.hp = 100; ui.say("ARCHIVE: Your reality fractured. I rebuilt you.", 4); const [x, z, yaw] = PLACE[P.frag].spawn; this.pos.set(x, z); this.yaw = yaw;
      P.drones.forEach(d => P.scene.remove(d.obj)); P.drones = []; }
  }

  // ---------------- frame ----------------
  update(dtReal) {
    const dt = Math.min(dtReal, 0.05), dtv = Math.min(dtReal, 0.25); this.dtv = dtv;   /* dtv: visual clocks keep real time on slow machines */ this.t += dt; this.frameMs += (dtReal * 1000 - this.frameMs) * 0.1; if (dtReal > 0.020) this.stats.slow++;
    const P = this.place; if (!P) return;
    if (!this.paused && !this.tunnel) {
      const sens = 0.0022 * this.S.sens; this.yaw -= this.mouse.dx * sens; this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - this.mouse.dy * sens));
      if (this.down.ArrowLeft) this.yaw += dt * 2.2; if (this.down.ArrowRight) this.yaw -= dt * 2.2;
      const sp = (this.down.ShiftLeft ? 9 : 5.5) * dt, f = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw)), r = new THREE.Vector2(-f.y, f.x); let mv = new THREE.Vector2();
      if (this.down.KeyW || this.down.ArrowUp) mv.add(f); if (this.down.KeyS || this.down.ArrowDown) mv.sub(f); if (this.down.KeyD) mv.add(r); if (this.down.KeyA) mv.sub(r);
      if (mv.lengthSq()) mv.normalize().multiplyScalar(sp);
      const cols = this.colliders(P), blocked = (x, z) => cols.some(b => x > b[0] - .4 && x < b[2] + .4 && z > b[1] - .4 && z < b[3] + .4);
      if (!blocked(this.pos.x + mv.x, this.pos.y)) this.pos.x += mv.x; if (!blocked(this.pos.x, this.pos.y + mv.y)) this.pos.y += mv.y;
      if (P.frag !== "hub" && P.done && this.pressed("KeyE")) this.riftTo("hub");
      if (this.pressed("KeyM")) { const i = (CODECS.indexOf(this.S.codec) + 1) % CODECS.length; this.S.codec = CODECS[i]; ui.toast(`Decoder: ${this.S.codec}`); }
      if (P.update) P.update(dt); this.combat(P, dt);
      if (P.exit) { P.exit.mesh.material.uniforms.uTime.value = this.t; P.exit.mesh.material.uniforms.uColor.value.set(DECODER_COLOR[this.S.codec]);
        if (Math.hypot(P.exit.x - this.pos.x, P.exit.z - this.pos.y) < 3.5) { ui.hint("[E] Return to the Station"); if (this.pressed("KeyE") && !this.tunnel) this.riftTo("hub"); } }
    }
    this.mouse.dx = this.mouse.dy = 0;
    if (P.streamable.length) this.stream(P); else if (this.batch && !this.batch.done && performance.now() - this.batch.t0 > 300) this.stream(P);
    this.animateChunks(P, dtv); if (this.leaving) { this.animateChunks(this.leaving, dtv); if (!Object.keys(this.leaving.chunks).length) this.leaving = null; }
    P.particles.userData.drift(dt); P.particles.position.set(this.pos.x, 0, this.pos.y); P.scene.children[0].material.uniforms.uTime.value = this.t;
    for (const e of P.fx) { e.life -= dt; if (e.pts) { const p = e.pts.geometry.attributes.position; for (let i = 0; i < e.v.length; i++) { p.array[3 * i] += e.v[i].x * dt; p.array[3 * i + 1] += e.v[i].y * dt; p.array[3 * i + 2] += e.v[i].z * dt; e.v[i].y -= 9 * dt; } p.needsUpdate = true; e.pts.material.opacity = Math.max(0, e.life); } }
    P.fx = P.fx.filter(e => { if (e.life <= 0) { P.scene.remove(e.pts || e.beam); return false; } return true; });
    // camera
    const cam = this.fx.camera; cam.position.set(this.pos.x, 1.7, this.pos.y); cam.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    // tunnel (rift travel): 0.6 s into the light, swap, 0.5 s out
    const G = this.fx.glitch.uniforms;
    if (this.tunnel) { const T = this.tunnel; T.t += dtv; if (!T.swapped && T.t > 0.6) { T.swapped = true; this.enter(T.to); }
      G.uTunnel.value = T.t < 0.6 ? T.t / 0.6 : Math.max(0, 1 - (T.t - 0.6) / 0.5); if (T.t > 1.1) { this.tunnel = null; G.uTunnel.value = 0; } }
    // Archive Overload: restore flow and frame stability drive the glitch (cosmetic, can be switched off)
    const flow = this.A.flowMBs(); this.surge = Math.max(0, this.surge - dt * 0.8);
    const stab = Math.max(0, Math.min(1, 1 - (this.frameMs - 17) / 33)), want = Math.min(1, Math.max(0, (flow - 25) / 150) * 0.7 + Math.min(0.25, Math.max(0, (this.frameMs - 40) / 120)) + this.surge * 0.6);   // frame time alone never fills it
    this.overload += (want - this.overload) * dt * 3; G.uOverload.value = this.S.overloadFx ? this.overload : 0;
    this.hurt = Math.max(0, this.hurt - dt * 2); G.uHurt.value = this.hurt;
    ui.bar("flowbar", flow / 200); ui.set("flowtxt", `${flow.toFixed(0)} MB/s`); ui.bar("stabbar", stab); ui.set("stabtxt", `${this.frameMs.toFixed(1)} ms`);
    { let g = 0; const add = (m) => { const geo = m.geometry; for (const k in geo.attributes) g += geo.attributes[k].array.byteLength; if (geo.index) g += geo.index.array.byteLength; };   // bytes the Archive put on the GPU
      for (const pl of [this.places.hub, P]) if (pl) for (const k of Object.values(pl.chunks)) add(k.mesh);
      if (this.places.hub?.duel) for (const s of this.places.hub.duel.sides) s.group.children.forEach(add);
      for (const t of Object.values(this.texCache)) g += t.length * 512 * 512 * 4 * 4 / 3;
      ui.bar("vrambar", g / 128e6); ui.set("vramtxt", `${(g / 1e6).toFixed(0)} MB`); }
    ui.bar("hpbar", this.hp / 100); ui.bar("enbar", this.energy / 100); document.getElementById("shield").classList.toggle("on", !!this.shieldOn);
    ui.set("where", `${PLACE[P.frag].title}<br><small>KEYS ${this.keys.size}/3 · DECODER <b style="color:${DECODER_CSS[this.S.codec]}">${this.S.codec}</b> [M]</small>`);
    if (P.frag !== "hub") ui.set("duelcap", "");
    this.edge = null;
  }
}
