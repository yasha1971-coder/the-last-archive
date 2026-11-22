// assets.js - restored bytes -> GPU objects. Mesh chunks become BufferGeometry with material groups; texture chunks become
// mipmapped DataTextures. Every material gets the "assembly" shader: vertices fly in from voxel cells as uReveal goes 0 -> 1
// (and back out when the Archive folds a chunk away).
import * as THREE from "three";

// per fragment: texture kinds in generator order, and which of them glow (additive, picked up by bloom)
export const FRAG_MATS = {
  hub:     { kinds: ["metal", "grating", "hull", "hull_e", "glow", "glow_e"], glow: [3, 5] },
  city:    { kinds: ["brick", "facade", "facade_e", "asphalt", "metal", "concrete"], glow: [2] },
  forest:  { kinds: ["bark", "snow", "ice", "needles", "rock", "crystal_e"], glow: [5] },
  reactor: { kinds: ["metal", "hazard", "glow_e", "grating", "hull", "glow"], glow: [2] },
  heart:   { kinds: ["gold", "gold_e", "stone", "crystal", "ice", "metal"], glow: [1] },
};

export function parseTextures(data) {
  const dv = new DataView(data.buffer, data.byteOffset), count = dv.getUint32(4, true), size = dv.getUint32(8, true), out = [];
  for (let i = 0; i < count; i++) {
    const px = data.subarray(12 + i * size * size * 4, 12 + (i + 1) * size * size * 4);
    const t = new THREE.DataTexture(px, size, size, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.needsUpdate = true; out.push(t);
  }
  return out;
}
export function parseMesh(data) {
  const dv = new DataView(data.buffer, data.byteOffset), nv = dv.getUint32(4, true), ni = dv.getUint32(8, true), ng = dv.getUint32(12, true);
  const g = new THREE.BufferGeometry(); let o = 16; const groups = [];
  for (let i = 0; i < ng; i++, o += 12) groups.push([dv.getUint32(o, true), dv.getUint32(o + 4, true), dv.getUint32(o + 8, true)]);
  const buf = data.buffer, b0 = data.byteOffset + o;
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buf, b0, nv * 3), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(buf, b0 + nv * 12, nv * 3), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(buf, b0 + nv * 24, nv * 2), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, b0 + nv * 32, ni), 1));
  for (const [s, c, m] of groups) g.addGroup(s, c, m);
  g.computeBoundingSphere(); return g;
}
function assembly(mat, uniforms) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uReveal = uniforms.uReveal; sh.uniforms.uGlow = uniforms.uGlow;
    sh.vertexShader = "uniform float uReveal;\n" + sh.vertexShader.replace("#include <begin_vertex>", `
      vec3 transformed = position;
      vec3 vox = floor(position * 0.5) * 2.0 + 1.0;
      float h = fract(sin(dot(vox, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      float tt = clamp(uReveal * 1.7 - h * 0.7, 0.0, 1.0); tt = tt * tt * (3.0 - 2.0 * tt);
      transformed = mix(vox + vec3(0.0, (1.0 - tt) * (4.0 + 10.0 * h), 0.0), position, tt);`);
    sh.fragmentShader = "uniform float uReveal; uniform vec3 uGlow;\n" + sh.fragmentShader.replace("#include <opaque_fragment>",
      "outgoingLight += uGlow * pow(1.0 - uReveal, 1.5) * 2.5;\n#include <opaque_fragment>");
  };
  return mat;
}
// one material set per chunk (each chunk assembles on its own clock)
export function makeMaterials(frag, textures, glow = 0x3fd8ff) {
  const spec = FRAG_MATS[frag], uniforms = { uReveal: { value: 0 }, uGlow: { value: new THREE.Color(glow) } };   // glow: hex or THREE.Color
  const mats = spec.kinds.map((k, i) => spec.glow.includes(i)
    ? assembly(new THREE.MeshBasicMaterial({ map: textures[i], blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, color: 0xffffff }), uniforms)
    : assembly(new THREE.MeshStandardMaterial({ map: textures[i], roughness: k === "ice" || k === "metal" || k === "hull" ? 0.35 : 0.85, metalness: k === "metal" || k === "hull" || k === "grating" ? 0.6 : 0.05 }), uniforms));
  return { mats, uniforms };
}
