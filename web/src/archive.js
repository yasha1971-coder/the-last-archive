// archive.js - THE ARCHIVE: one data blob, three ways to restore every chunk (ACEAPEX / zstd / LZ4HC), each restore
// timed around the decoder call only and verified by sha256. Read bytes are exact: for ACEAPEX the compressed span of
// the 256 KiB blocks that cover the chunk (from the archive's block table), for zstd/LZ4 the chunk's own frame.
export const CODECS = ["ACEAPEX", "zstd", "LZ4HC"];
export const DECODER_COLOR = { ACEAPEX: 0x3fd8ff, zstd: 0xffa53a, LZ4HC: 0xd65bff };
export const DECODER_CSS = { ACEAPEX: "#3fd8ff", zstd: "#ffa53a", LZ4HC: "#d65bff" };
export const CODEC_NOTE = { ACEAPEX: "ACEAPEX fast 8, region read", zstd: "zstd 1.5.7 level 19, one frame per chunk", LZ4HC: "LZ4 1.10 HC level 12, one block per chunk" };

export class Archive {
  constructor(M, blob) {
    this.M = M;
    const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength), end = blob.byteLength;
    const axLen = dv.getUint32(end - 24, true), zLen = dv.getUint32(end - 20, true), lLen = dv.getUint32(end - 16, true), mLen = dv.getUint32(end - 12, true);
    if (Number(dv.getBigUint64(end - 8, true)) !== 0x324C415453414C) throw new Error("not an Archive blob");
    this.meta = JSON.parse(new TextDecoder().decode(blob.subarray(axLen + zLen + lLen, axLen + zLen + lLen + mLen)));
    this.chunks = this.meta.chunks; this.byName = Object.fromEntries(this.chunks.map(c => [c.name, c]));
    this.base = M._malloc(axLen + zLen + lLen); M.HEAPU8.set(blob.subarray(0, axLen + zLen + lLen), this.base);
    this.axLen = axLen; this.zLen = zLen; this.lLen = lLen;
    if (M._ax_open(this.base, axLen) !== 0) throw new Error("ACEAPEX archive refused by the decoder");
    const nb = dv.getUint32(24, true), bs = dv.getUint32(20, true);                 // fast-profile header: block size, block count
    this.bs = bs; this.blockOff = []; for (let i = 0; i <= nb; i++) this.blockOff.push(Number(dv.getBigUint64(68 + 8 * i, true)));
    const max = Math.max(...this.chunks.map(c => c.raw[1])); this.scratch = M._malloc(max); this.shaOut = M._malloc(32);
    this.log = []; this.flowWindow = [];                                             // every restore, for HUD / cards / stats
  }
  readBytes(c, codec) {
    if (codec === "zstd") return c.zstd[1]; if (codec === "LZ4HC") return c.lz4[1];
    const b0 = Math.floor(c.raw[0] / this.bs), b1 = Math.floor((c.raw[0] + c.raw[1] - 1) / this.bs);
    return this.blockOff[b1 + 1] - this.blockOff[b0];
  }
  restore(name, codec, verify = true) {
    const c = typeof name === "string" ? this.byName[name] : name, M = this.M, n = c.raw[1];
    let r; const t0 = performance.now();
    if (codec === "ACEAPEX") r = M._ax_region(this.scratch, c.raw[0], n);
    else if (codec === "zstd") r = M._zstd_dec(this.base + this.axLen + c.zstd[0], c.zstd[1], this.scratch, n);
    else r = M._lz4_dec(this.base + this.axLen + this.zLen + c.lz4[0], c.lz4[1], this.scratch, n);
    const ms = performance.now() - t0;
    if (r !== n) throw new Error(`${codec}: chunk ${c.name} failed to restore (${r})`);
    let ok = null;
    if (verify) { M._sha256(this.scratch, n, this.shaOut); const h = M.HEAPU8.subarray(this.shaOut, this.shaOut + 32);
      let hex = ""; for (let i = 0; i < 32; i++) hex += h[i].toString(16).padStart(2, "0"); ok = hex === c.sha256; }
    const data = M.HEAPU8.slice(this.scratch, this.scratch + n);                    // copy out of the wasm heap
    const rec = { name: c.name, fragment: c.fragment, codec, ms, read: this.readBytes(c, codec), bytes: n, ok, t: performance.now() };
    this.log.push(rec); this.flowWindow.push(rec);
    return { data, rec };
  }
  verifyBytes(c, bytes) {                                                         // sha256 of bytes restored elsewhere (workers)
    const M = this.M; M.HEAPU8.set(bytes, this.scratch); M._sha256(this.scratch, bytes.length, this.shaOut); const h = M.HEAPU8.subarray(this.shaOut, this.shaOut + 32);
    let hex = ""; for (let i = 0; i < 32; i++) hex += h[i].toString(16).padStart(2, "0"); return hex === c.sha256;
  }
  flowMBs() { const now = performance.now(); this.flowWindow = this.flowWindow.filter(r => now - r.t < 1000); return this.flowWindow.reduce((s, r) => s + r.bytes, 0) / 1e6; }
}
