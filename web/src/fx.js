// fx.js - the GPU side: renderer, bloom, the Overload glitch, the portal transition, skies, particles, beams.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const GlitchShader = {
  uniforms: { tDiffuse: { value: null }, uOverload: { value: 0 }, uTunnel: { value: 0 }, uTint: { value: new THREE.Color(0x9fe8ff) }, uTime: { value: 0 }, uHurt: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uOverload, uTunnel, uTime, uHurt; uniform vec3 uTint; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv; float o = uOverload;
      float band = step(0.985 - o * 0.08, h(vec2(floor(uv.y * 60.0), floor(uTime * 12.0))));
      uv.x += band * (h(vec2(uTime, uv.y)) - 0.5) * 0.08 * o;
      vec2 c = uv - 0.5; float r = length(c), a = atan(c.y, c.x);
      uv = mix(uv, 0.5 + c * (1.0 - uTunnel * 0.35 * (1.0 - r)), uTunnel);
      vec3 col = vec3(texture2D(tDiffuse, uv + vec2(o * 0.006, 0.0)).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - vec2(o * 0.006, 0.0)).b);
      col += (h(uv * 400.0 + uTime) - 0.5) * 0.12 * o;
      float streak = pow(0.5 + 0.5 * sin(a * 24.0 + 2.0 / (r + 0.05) - uTime * 14.0), 3.0) * (0.3 + r);
      col = mix(col, uTint * (0.35 + 1.4 * streak), uTunnel * 0.85);
      col = mix(col, vec3(1.0, 0.1, 0.05), uHurt * 0.35 * smoothstep(0.3, 0.75, r));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class FX {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 900);
    this.scene = new THREE.Scene();
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera); this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.55, 0.72); this.composer.addPass(this.bloom);
    this.glitch = new ShaderPass(GlitchShader); this.composer.addPass(this.glitch);
    this.composer.addPass(new OutputPass());
    this.quality = "high"; this.resize(); addEventListener("resize", () => this.resize());
  }
  setQuality(q) { this.quality = q; this.resize(); this.bloom.strength = q === "ultra" ? 1.15 : q === "low" ? 0.6 : 0.9; }
  resize() {
    const dpr = this.quality === "ultra" ? Math.min(devicePixelRatio * 1.5, 3) : this.quality === "low" ? 0.6 : Math.min(devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(innerWidth, innerHeight); this.composer.setPixelRatio(dpr); this.composer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
  }
  setScene(s) { this.scene = s; this.renderPass.scene = s; }
  render(t) { this.glitch.uniforms.uTime.value = t; this.composer.render(); }
}

// procedural sky domes (no data: shaders)
const SKY = {
  hub:     "vec3 c = vec3(0.01, 0.015, 0.03) + vec3(0.02, 0.05, 0.08) * pow(max(d.y, 0.0), 0.4);",
  city:    `vec3 c = mix(vec3(0.05, 0.02, 0.10), vec3(0.18, 0.06, 0.22), pow(1.0 - max(d.y, 0.0), 3.0));
            float s = step(0.9985, h(floor(d.xz * 400.0 / max(d.y, 0.05)))) * step(0.05, d.y); c += s * 0.9;
            float m1 = smoothstep(0.9985, 0.9992, dot(d, normalize(vec3(0.0, 0.32, 1.0)))); c += vec3(0.95, 0.92, 0.82) * m1 + vec3(0.25, 0.22, 0.3) * smoothstep(0.97, 1.0, dot(d, normalize(vec3(0.0, 0.32, 1.0))));
            float m2 = smoothstep(0.99955, 0.9998, dot(d, normalize(vec3(0.35, 0.42, 1.0)))); c += vec3(0.9, 0.4, 0.3) * m2;`,
  forest:  `vec3 c = mix(vec3(0.22, 0.30, 0.42), vec3(0.02, 0.04, 0.10), pow(max(d.y, 0.0), 0.6));
            float au = exp(-pow((d.y - 0.35 - 0.08 * sin(d.x * 6.0 + uTime * 0.2)) * 10.0, 2.0)); c += vec3(0.1, 0.9, 0.5) * au * 0.6;`,
  reactor: "vec3 c = vec3(0.02, 0.02, 0.025) + vec3(0.25, 0.08, 0.02) * pow(max(d.y, 0.0), 6.0);",
  heart:   `vec3 c = mix(vec3(0.25, 0.14, 0.03), vec3(0.02, 0.01, 0.0), pow(max(d.y, 0.0), 0.5));
            c += vec3(1.0, 0.7, 0.3) * pow(0.5 + 0.5 * sin(atan(d.z, d.x) * 7.0 + uTime * 0.3), 8.0) * 0.15;`,
};
export function makeSky(frag) {
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { uTime: { value: 0 } },
    vertexShader: "varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform float uTime; varying vec3 vD; float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){ vec3 d = normalize(vD); ${SKY[frag]} gl_FragColor = vec4(c, 1.0); }` });
  const s = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), m); s.frustumCulled = false; return s;
}
// drifting embers / snow / sparks
export function makeParticles(n, color, spread, size) {
  const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { p[3 * i] = (Math.random() - 0.5) * spread; p[3 * i + 1] = Math.random() * 30; p[3 * i + 2] = (Math.random() - 0.5) * spread; }
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  pts.userData.drift = (dt) => { for (let i = 0; i < n; i++) { p[3 * i + 1] -= dt * (0.6 + (i % 7) * 0.15); p[3 * i] += Math.sin(i + p[3 * i + 1]) * dt * 0.3; if (p[3 * i + 1] < 0) p[3 * i + 1] = 30; } g.attributes.position.needsUpdate = true; };
  pts.frustumCulled = false; return pts;
}
// portal / rift surface: swirl, clarity = how much of the destination the Archive already restored
export function makePortal(color, w = 4, h = 6) {
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uClarity: { value: 0 }, uSealed: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform float uTime, uClarity, uSealed; uniform vec3 uColor; varying vec2 vUv;
      void main(){ vec2 c = vUv - 0.5; c.x *= 0.7; float r = length(c), a = atan(c.y, c.x);
        float sw = 0.5 + 0.5 * sin(a * 6.0 + r * (30.0 - 20.0 * uClarity) - uTime * 4.0);
        float edge = smoothstep(0.5, 0.42, r) * (0.35 + 0.65 * sw);
        vec3 col = mix(uColor * edge * 0.6, uColor * (0.25 + 0.55 * sw) * smoothstep(0.5, 0.05, r), uClarity) * 0.75;
        col = mix(col, vec3(0.6, 0.05, 0.05) * edge, uSealed);
        gl_FragColor = vec4(col, smoothstep(0.5, 0.45, r)); }` });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
}
export function makeBeam(color) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  return new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 8, 1, true), m);
}
export function glowSphere(color, r) { return new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({ color })); }
