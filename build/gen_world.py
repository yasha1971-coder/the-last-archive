#!/usr/bin/env python3
"""THE LAST ARCHIVE - world generator. Writes every world piece ("chunk") as a raw binary + manifest.json.
Chunk kinds:
  mesh: [u32 magic 'MESH', u32 nverts, u32 nidx, u32 ngroups] [groups: u32 start, u32 count, u32 material] x ngroups
        [f32 pos x3 * nverts][f32 normal x3 * nverts][f32 uv x2 * nverts][u32 index * nidx]
  tex:  [u32 magic 'TEXS', u32 count, u32 size] [RGBA8 size*size] x count
Everything is deterministic (seeded); the packer compresses these bytes three ways and the game restores them."""
import numpy as np, json, os, struct, hashlib, math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chunks"); os.makedirs(OUT, exist_ok=True)
TS = 512                                                           # texture size
manifest = {"chunks": [], "fragments": {}}

# ---------------- textures ----------------
def vnoise(rng, size, cells):
    g = rng.random((cells + 1, cells + 1)).astype(np.float32)
    x = np.linspace(0, cells, size, endpoint=False, dtype=np.float32)
    xi = x.astype(int); xf = x - xi; xf = xf * xf * (3 - 2 * xf)
    a = g[np.ix_(xi, xi)]; b = g[np.ix_(xi, xi + 1)]; c = g[np.ix_(xi + 1, xi)]; d = g[np.ix_(xi + 1, xi + 1)]
    return (a * (1 - xf)[None, :] + b * xf[None, :]) * (1 - xf)[:, None] + (c * (1 - xf)[None, :] + d * xf[None, :]) * xf[:, None]
def fbm(rng, size, base=4, oct=5):
    s = np.zeros((size, size), np.float32); amp = 0.5; tot = 0
    for o in range(oct): s += amp * vnoise(rng, size, base << o); tot += amp; amp *= 0.5
    return s / tot
def rgba(r, g, b, a=None):
    a = np.ones_like(r) if a is None else a
    img = np.stack([r, g, b, a], -1); return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)
def tile_tex(kind, seed):
    rng = np.random.default_rng(seed); n = fbm(rng, TS); y, x = np.mgrid[0:TS, 0:TS].astype(np.float32) / TS
    z = np.zeros_like(n); o = np.ones_like(n)
    if kind == "brick":
        row = (y * 16).astype(int); off = (row % 2) * 0.5; mort = ((y * 16) % 1 < 0.08) | (((x * 8 + off) % 1) < 0.05)
        v = 0.45 + 0.35 * n; return rgba(np.where(mort, 0.3, v * 1.1), np.where(mort, 0.3, v * 0.55), np.where(mort, 0.3, v * 0.45))
    if kind in ("facade", "facade_e"):
        wx, wy = (x * 4) % 1, (y * 8) % 1; win = (wx > 0.2) & (wx < 0.8) & (wy > 0.25) & (wy < 0.85)
        lit = (rng.random((8, 4)) > 0.55)[(y * 8).astype(int) % 8, (x * 4).astype(int) % 4]
        if kind == "facade_e": e = np.where(win & lit, 1.0, 0.0) * (0.8 + 0.2 * n); return rgba(e * 1.0, e * 0.8, e * 0.45)
        v = 0.35 + 0.25 * n; return rgba(np.where(win, 0.06, v), np.where(win, 0.08, v * 0.97), np.where(win, 0.12, v * 0.93))
    if kind == "asphalt":
        v = 0.10 + 0.10 * n; line = (np.abs(x - 0.5) < 0.012) & ((y * 6) % 1 < 0.5); return rgba(np.where(line, 0.8, v), np.where(line, 0.7, v), np.where(line, 0.3, v * 1.05))
    if kind == "metal":
        v = 0.30 + 0.15 * n + 0.05 * np.sin(y * 300); pan = ((x * 4) % 1 < 0.01) | ((y * 4) % 1 < 0.01); return rgba(np.where(pan, 0.1, v), np.where(pan, 0.1, v * 1.02), np.where(pan, 0.1, v * 1.08))
    if kind == "concrete": v = 0.40 + 0.30 * n; return rgba(v, v * 0.98, v * 0.94)
    if kind == "bark":
        v = 0.25 + 0.2 * (0.5 + 0.5 * np.sin(x * 60 + n * 8)); return rgba(v * 0.6, v * 0.55, v * 0.6)
    if kind == "snow": v = 0.82 + 0.15 * n; return rgba(v, v * 1.0, v * 1.04)
    if kind == "ice": v = 0.55 + 0.4 * np.abs(np.sin((x + y) * 20 + n * 6)); return rgba(v * 0.55, v * 0.8, v)
    if kind == "needles": v = 0.25 + 0.3 * n; s = (n > 0.6).astype(np.float32); return rgba(v * 0.35 + s * 0.6, v * 0.55 + s * 0.6, v * 0.45 + s * 0.65)
    if kind == "rock": v = 0.30 + 0.35 * n; return rgba(v * 0.85, v * 0.88, v * 0.95)
    if kind in ("crystal", "crystal_e"):
        f = np.abs(np.sin(x * 25 + n * 9)) * np.abs(np.cos(y * 31 - n * 7)); return rgba(0.3 + 0.7 * f, 0.6 + 0.4 * f, 0.9 + 0.1 * f)
    if kind == "hazard":
        st = (((x + y) * 8) % 1 < 0.5); v = 0.3 * n; return rgba(np.where(st, 0.9, 0.08) + v * 0.1, np.where(st, 0.7, 0.08) + v * 0.1, np.where(st, 0.05, 0.08))
    if kind in ("glow", "glow_e"):
        f = 0.5 + 0.5 * np.sin(y * 40 + n * 4); return rgba(0.1 + 0.5 * f, 0.6 + 0.4 * f, 0.7 + 0.3 * f)
    if kind == "grating":
        g = ((x * 32) % 1 < 0.15) | ((y * 32) % 1 < 0.15); v = 0.25 + 0.1 * n; return rgba(np.where(g, v * 1.4, 0.04), np.where(g, v * 1.4, 0.04), np.where(g, v * 1.5, 0.05))
    if kind in ("gold", "gold_e"):
        f = np.abs(np.sin(x * 18 + n * 6)) * np.abs(np.cos(y * 22 - n * 5)); return rgba(0.6 + 0.4 * f, 0.45 + 0.35 * f, 0.15 + 0.2 * f)
    if kind == "stone": v = 0.18 + 0.2 * n; return rgba(v, v * 0.95, v * 1.05)
    if kind in ("hull", "hull_e"):
        v = 0.25 + 0.2 * n; seam = ((x * 6) % 1 < 0.02) | ((y * 3) % 1 < 0.02); e = seam.astype(np.float32)
        if kind == "hull_e": return rgba(e * 0.2, e * 0.9, e * 1.0)
        return rgba(v, v * 1.05, v * 1.15)
    raise ValueError(kind)

# ---------------- geometry builder ----------------
class Mesh:
    def __init__(s): s.p, s.n, s.uv, s.idx, s.mat = [], [], [], [], []
    def _add(s, P, N, UV, I, m):
        base = sum(len(a) for a in s.p); s.p.append(P); s.n.append(N); s.uv.append(UV); s.idx.append(I + base); s.mat.append(np.full(len(I) // 3, m, np.int32))
    def box(s, c, sz, m, uvs=1.0, rot=0.0):
        cx, cy, cz = c; hx, hy, hz = sz[0] / 2, sz[1] / 2, sz[2] / 2
        F = [((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]), ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)]),
             ((1, 0, 0), [(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)]), ((-1, 0, 0), [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)]),
             ((0, 1, 0), [(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)]), ((0, -1, 0), [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)])]
        cr, sr = math.cos(rot), math.sin(rot); P, N, UV, I = [], [], [], []
        for fi, (nrm, vs) in enumerate(F):
            ext = (sz[0] if nrm[0] == 0 else sz[2], sz[1] if nrm[1] == 0 else sz[2])
            for k, (a, b, d) in enumerate(vs):
                x, y, z = a * hx, b * hy, d * hz; P.append((cx + x * cr - z * sr, cy + y, cz + x * sr + z * cr))
                N.append((nrm[0] * cr - nrm[2] * sr, nrm[1], nrm[0] * sr + nrm[2] * cr))
                UV.append(((k in (1, 2)) * ext[0] / uvs, (k in (2, 3)) * ext[1] / uvs))
            o = fi * 4; I += [o, o + 1, o + 2, o, o + 2, o + 3]
        s._add(np.array(P, np.float32), np.array(N, np.float32), np.array(UV, np.float32), np.array(I, np.uint32), m)
    def cyl(s, c, r0, r1, h, m, seg=12, uvs=1.0):
        cx, cy, cz = c; P, N, UV, I = [], [], [], []
        for i in range(seg + 1):
            a = 2 * math.pi * i / seg; ca, sa = math.cos(a), math.sin(a); sl = (r0 - r1) / max(h, 1e-6); nl = math.sqrt(1 + sl * sl)
            for j, (r, y) in enumerate(((r0, 0), (r1, h))):
                P.append((cx + ca * r, cy + y, cz + sa * r)); N.append((ca / nl, sl / nl, sa / nl)); UV.append((i / seg * 2 * math.pi * max(r0, r1) / uvs, y / uvs))
        for i in range(seg): o = 2 * i; I += [o, o + 2, o + 1, o + 1, o + 2, o + 3]
        s._add(np.array(P, np.float32), np.array(N, np.float32), np.array(UV, np.float32), np.array(I, np.uint32), m)
    def rock(s, c, r, m, rng, seg=10):
        cx, cy, cz = c; P, N, UV, I = [], [], [], []
        for i in range(seg + 1):
            th = math.pi * i / seg
            for j in range(seg + 1):
                ph = 2 * math.pi * j / seg; d = (math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph))
                k = r * (0.75 + 0.5 * rng.random()); P.append((cx + d[0] * k, cy + d[1] * k * 0.7, cz + d[2] * k)); N.append(d); UV.append((j / seg * 3, i / seg * 2))
        for i in range(seg):
            for j in range(seg): o = i * (seg + 1) + j; I += [o, o + seg + 1, o + 1, o + 1, o + seg + 1, o + seg + 2]
        s._add(np.array(P, np.float32), np.array(N, np.float32), np.array(UV, np.float32), np.array(I, np.uint32), m)
    def torus(s, c, R, r, m, seg=48, sseg=12, axis="y"):
        cx, cy, cz = c; P, N, UV, I = [], [], [], []
        for i in range(seg + 1):
            u = 2 * math.pi * i / seg
            for j in range(sseg + 1):
                v = 2 * math.pi * j / sseg; nx, ny, nz = math.cos(u) * math.cos(v), math.sin(v), math.sin(u) * math.cos(v)
                px, py, pz = (R + r * math.cos(v)) * math.cos(u), r * math.sin(v), (R + r * math.cos(v)) * math.sin(u)
                if axis == "x": px, py, pz, nx, ny, nz = py, px, pz, ny, nx, nz
                P.append((cx + px, cy + py, cz + pz)); N.append((nx, ny, nz)); UV.append((i / seg * 8, j / sseg))
        for i in range(seg):
            for j in range(sseg): o = i * (sseg + 1) + j; I += [o, o + sseg + 1, o + 1, o + 1, o + sseg + 1, o + sseg + 2]
        s._add(np.array(P, np.float32), np.array(N, np.float32), np.array(UV, np.float32), np.array(I, np.uint32), m)
    def write(s, name, frag, kind, colliders=(), extra=None):
        if not s.p: return
        P, N, UV, I, M = np.concatenate(s.p), np.concatenate(s.n), np.concatenate(s.uv), np.concatenate(s.idx), np.concatenate(s.mat)
        order = np.argsort(M, kind="stable"); tri = I.reshape(-1, 3)[order].reshape(-1); M = M[order]   # group triangles by material
        groups = [];
        for m in np.unique(M): w = np.nonzero(M == m)[0]; groups.append((int(w[0]) * 3, len(w) * 3, int(m)))
        hdr = struct.pack("<4I", 0x4853454D, len(P), len(tri), len(groups)) + b"".join(struct.pack("<3I", *g) for g in groups)
        data = hdr + P.astype("<f4").tobytes() + N.astype("<f4").tobytes() + UV.astype("<f4").tobytes() + tri.astype("<u4").tobytes()
        emit(name, frag, kind, data, colliders, extra, len(P))
def emit(name, frag, kind, data, colliders=(), extra=None, nverts=0):
    open(os.path.join(OUT, name + ".bin"), "wb").write(data)
    c = {"name": name, "fragment": frag, "kind": kind, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "colliders": [list(map(float, b)) for b in colliders], "verts": nverts}
    if extra: c.update(extra)
    manifest["chunks"].append(c)
def textures(frag, kinds, seed):
    data = struct.pack("<3I", 0x53584554, len(kinds), TS) + b"".join(tile_tex(k, seed + i).tobytes() for i, k in enumerate(kinds))
    emit(frag + "_textures", frag, "tex", data, extra={"kinds": kinds})

# ---------------- fragments ----------------
def hub():
    textures("hub", ["metal", "grating", "hull", "hull_e", "glow", "glow_e"], 10)
    m = Mesh(); R = 18
    m.box((0, -0.5, 0), (2 * R, 1, 2 * R), 1, 2)                                     # floor
    for a in range(16):                                                              # ring wall panels + ribs
        t = 2 * math.pi * a / 16; x, z = math.cos(t) * R, math.sin(t) * R
        m.box((x, 6, z), (7.2, 12, 1), 2, 3, rot=-t + math.pi / 2); m.box((x * 0.97, 6, z * 0.97), (0.6, 12, 0.6), 0, 1, rot=-t)
    m.box((0, 12.5, 0), (2 * R, 1, 2 * R), 0, 4)
    for k in range(5): m.torus((0, 0.6 + k * 0.05, 0), 3.2 + k * 0.6, 0.12, 4 if k % 2 else 0, seg=64, sseg=10)   # archive pedestal rings
    m.cyl((0, 0, 0), 2.8, 2.2, 1.2, 0, seg=32)
    m.write("hub_hall", "hub", "mesh", colliders=[(-R - 2, -R - 2, R + 2, -R), (-R - 2, R, R + 2, R + 2), (-R - 2, -R, -R, R), (R, -R, R + 2, R), (-3, -3, 3, 3)])
def city():
    textures("city", ["brick", "facade", "facade_e", "asphalt", "metal", "concrete"], 20)
    rng = np.random.default_rng(1)
    roads = Mesh(); roads.box((0, -0.05, 0), (240, 0.1, 240), 3, 12)
    roads.write("city_ground", "city", "mesh")
    blocks = [(bx, bz) for bx in range(-2, 3) for bz in range(-2, 3) if (bx, bz) != (0, 0)]
    gated = {(-1, 1), (0, 1), (1, 1), (0, 2), (-1, 2), (1, 2)}                      # streets restored by the lantern puzzle
    for (bx, bz) in blocks:
        m = Mesh(); col = []; cx, cz = bx * 44, bz * 44
        m.box((cx, 0.15, cz), (34, 0.3, 34), 5, 4)                                   # sidewalk slab
        for k in range(rng.integers(3, 6)):
            w, d = rng.uniform(8, 14), rng.uniform(8, 14); h = rng.uniform(10, 55); x = cx + rng.uniform(-10, 10); z = cz + rng.uniform(-10, 10)
            mat = 1 if rng.random() < 0.65 else 0
            m.box((x, h / 2, z), (w, h, d), mat, 6); col.append((x - w / 2, z - d / 2, x + w / 2, z + d / 2))
            if mat == 1: m.box((x, h / 2, z), (w + 0.04, h, d + 0.04), 2, 6)          # emissive window layer (additive)
            for b in range(int(h / 4)):                                              # ledges / balconies
                m.box((x, 2 + b * 4, z + d / 2 + 0.4), (w * 0.9, 0.25, 0.8), 4, 2)
            m.cyl((x, h, z), 0.15, 0.05, rng.uniform(3, 9), 4, seg=6)                # antenna
            for r in range(30):                                                      # rubble
                m.box((x + rng.uniform(-w, w), 0.3, z + rng.uniform(-d, d)), (rng.uniform(.3, 1.4),) * 3, 5, 1, rot=rng.uniform(0, 3))
        for l in range(4): m.cyl((cx + (l % 2 * 2 - 1) * 16, 0, cz + (l // 2 * 2 - 1) * 16), 0.15, 0.1, 6, 4, seg=8)    # street lamps
        m.write(f"city_block_{bx}_{bz}", "city", "mesh", colliders=col, extra={"center": [cx, cz], "gated": (bx, bz) in gated})
def forest():
    textures("forest", ["bark", "snow", "ice", "needles", "rock", "crystal_e"], 30)
    rng = np.random.default_rng(2)
    g = Mesh(); g.box((0, -0.05, 0), (220, 0.1, 220), 1, 8); g.write("forest_ground", "forest", "mesh")
    for gx in range(-2, 3):
        for gz in range(-2, 3):
            m = Mesh(); col = []; cx, cz = gx * 40, gz * 40
            if (gx, gz) == (0, 2):                                                   # the frozen giant tree (restored by the mirror puzzle)
                m.cyl((cx, 0, cz), 4, 2.5, 30, 0, seg=24, uvs=3); col.append((cx - 4, cz - 4, cx + 4, cz + 4))
                for k in range(5): m.cyl((cx, 10 + k * 5, cz), 16 - k * 2.6, 0.5, 8, 3, seg=24, uvs=4)
                m.write(f"forest_cell_{gx}_{gz}", "forest", "mesh", colliders=col, extra={"center": [cx, cz], "gated": True}); continue
            if (gx, gz) == (0, 0): continue
            for t in range(rng.integers(10, 18)):
                x, z = cx + rng.uniform(-18, 18), cz + rng.uniform(-18, 18); h = rng.uniform(6, 14)
                m.cyl((x, 0, z), 0.5, 0.3, h * 0.5, 0, seg=10); col.append((x - .6, z - .6, x + .6, z + .6))
                for k in range(3): m.cyl((x, h * 0.3 + k * h * 0.22, z), (3.2 - k * 0.8) * h / 10, 0.05, h * 0.35, 3, seg=12, uvs=2)
            for r in range(6): m.rock((cx + rng.uniform(-18, 18), 0.3, cz + rng.uniform(-18, 18)), rng.uniform(0.8, 2.2), 4, rng)
            for s in range(10): m.cyl((cx + rng.uniform(-18, 18), 0, cz + rng.uniform(-18, 18)), rng.uniform(.2, .6), 0.02, rng.uniform(1, 4), 2, seg=6)
            m.write(f"forest_cell_{gx}_{gz}", "forest", "mesh", colliders=col, extra={"center": [cx, cz], "gated": False})
def reactor():
    textures("reactor", ["metal", "hazard", "glow_e", "grating", "hull", "glow"], 40)
    rng = np.random.default_rng(3)
    h = Mesh(); R = 60
    h.box((0, -0.5, 0), (2 * R, 1, 2 * R), 3, 3)
    for a in range(24):
        t = 2 * math.pi * a / 24; x, z = math.cos(t) * R, math.sin(t) * R; h.box((x, 15, z), (16, 30, 1.5), 4, 4, rot=-t + math.pi / 2)
    h.cyl((0, 0, 0), 7, 6, 26, 0, seg=40, uvs=4); h.torus((0, 26, 0), 9, 1.2, 2, seg=64)
    for k in range(6): h.torus((0, 4 + k * 4, 0), 8.5, 0.35, 2 if k % 2 else 1, seg=64)
    h.write("reactor_hall", "reactor", "mesh", colliders=[(-R - 2, -R - 2, R + 2, -R), (-R - 2, R, R + 2, R + 2), (-R - 2, -R, -R, R), (R, -R, R + 2, R), (-7, -7, 7, 7)])
    for s in range(8):                                                               # pipe sectors (streamed by distance)
        m = Mesh(); t0 = 2 * math.pi * s / 8
        for p in range(14):
            t = t0 + rng.uniform(0, 2 * math.pi / 8); r = rng.uniform(16, 55); y = rng.uniform(1, 25)
            m.cyl((math.cos(t) * r, 0, math.sin(t) * r), 0.6, 0.6, y, 0, seg=14); m.torus((math.cos(t) * r, y, math.sin(t) * r), 1.2, 0.3, 5, seg=24, sseg=8)
            m.box((math.cos(t) * r, 0.5, math.sin(t) * r), (2.4, 1, 2.4), 1, 1)
        m.write(f"reactor_sector_{s}", "reactor", "mesh", colliders=[], extra={"center": [math.cos(t0 + .4) * 35, math.sin(t0 + .4) * 35], "gated": False})
    for b in range(3):                                                               # catwalk bridges restored by valves
        m = Mesh(); t = 2 * math.pi * b / 3 + 0.3
        for k in range(16): m.box((math.cos(t) * (12 + k * 2.6), 8, math.sin(t) * (12 + k * 2.6)), (2.6, 0.3, 3.2), 3, 1, rot=-t)
        m.write(f"reactor_bridge_{b}", "reactor", "mesh", extra={"center": [math.cos(t) * 30, math.sin(t) * 30], "gated": True})
def heart():
    textures("heart", ["gold", "gold_e", "stone", "crystal", "ice", "metal"], 50)
    rng = np.random.default_rng(4); m = Mesh(); R = 40
    m.cyl((0, -2, 0), R, R, 2, 2, seg=64, uvs=6)
    for k in range(12): t = 2 * math.pi * k / 12; m.cyl((math.cos(t) * (R - 3), 0, math.sin(t) * (R - 3)), 1.6, 0.4, rng.uniform(10, 22), 0, seg=6, uvs=2)
    m.write("heart_arena", "heart", "mesh", colliders=[])
    for ph, (mat, shape) in enumerate([(5, "box"), (4, "shard"), (5, "ring")]):      # the Guardian, one body per phase
        g = Mesh()
        for k in range(140):
            a, b = rng.uniform(0, 2 * math.pi), rng.uniform(-1, 1); r = rng.uniform(2.5, 7); p = (math.cos(a) * r * math.sqrt(1 - b * b), 10 + b * r, math.sin(a) * r * math.sqrt(1 - b * b))
            if shape == "box": g.box(p, (rng.uniform(.6, 2),) * 3, mat if k % 4 else 2, 1, rot=a)
            elif shape == "shard": g.cyl(p, rng.uniform(.3, .8), 0.02, rng.uniform(1.5, 4), mat, seg=5)
            else: g.torus(p, rng.uniform(.6, 1.4), 0.15, mat, seg=20, sseg=6)
        g.rock((0, 10, 0), 2.2, 1, rng, seg=16)
        g.write(f"guardian_phase_{ph}", "heart", "mesh", extra={"phase": ph})
def drone():
    m = Mesh(); rng = np.random.default_rng(5)
    m.rock((0, 0, 0), 0.6, 0, rng, seg=8); m.torus((0, 0, 0), 1.0, 0.08, 1, seg=24, sseg=6); m.torus((0, 0, 0), 1.0, 0.08, 1, seg=24, sseg=6, axis="x")
    m.write("drone", "hub", "mesh")

hub(); drone(); city(); forest(); reactor(); heart()
tot = sum(c["bytes"] for c in manifest["chunks"])
json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=0)
print(f"{len(manifest['chunks'])} chunks, {tot} B raw, {sum(c['verts'] for c in manifest['chunks'])} vertices")
