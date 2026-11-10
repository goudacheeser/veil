// Compact binary index. Everything is Uint32-aligned so the reader works directly on views over
// the ArrayBuffer: no parsing step on load, which is what makes service-worker rehydration cheap.
//
// Layout:  'VEIL' u32 version u32 nSections { u32 id, u32 byteOffset, u32 byteLength }*  sections…
// STRINGS: u32 count, u32 byteOffsets[count+1], utf8 bytes
// TABLE  : u32 count, u32 hashes[count] (sorted, unique), u32 valueOffsets[count+1], u32 values[]
export const MAGIC = 0x4c494556; // 'VEIL' little-endian
export const VERSION = 1;

export class BinWriter {
  constructor() {
    this.strings = new Map([['', 0]]);
    this.stringList = [''];
    this.sections = new Map();
  }
  str(s) {
    let id = this.strings.get(s);
    if (id === undefined) { id = this.stringList.length; this.strings.set(s, id); this.stringList.push(s); }
    return id;
  }
  setSection(id, u32) { this.sections.set(id, u32 instanceof Uint32Array ? u32 : Uint32Array.from(u32)); }

  // entries: Map<hash, number[]>
  static table(entries) {
    const hashes = [...entries.keys()].sort((a, b) => a - b);
    let total = 0;
    for (const h of hashes) total += entries.get(h).length;
    const out = new Uint32Array(1 + hashes.length * 2 + 1 + total);
    out[0] = hashes.length;
    let off = 0, vi = 2 + hashes.length * 2;
    for (let i = 0; i < hashes.length; i++) {
      out[1 + i] = hashes[i];
      out[1 + hashes.length + i] = off;
      for (const v of entries.get(hashes[i])) out[vi++] = v;
      off += entries.get(hashes[i]).length;
    }
    out[1 + hashes.length * 2] = off;
    return out;
  }

  finish(stringsSectionId) {
    const enc = new TextEncoder();
    const bytes = this.stringList.map((s) => enc.encode(s));
    const offsets = new Uint32Array(bytes.length + 1);
    let total = 0;
    for (let i = 0; i < bytes.length; i++) { offsets[i] = total; total += bytes[i].length; }
    offsets[bytes.length] = total;
    const strSec = new Uint8Array(4 + offsets.byteLength + ((total + 3) & ~3));
    new DataView(strSec.buffer).setUint32(0, bytes.length, true);
    strSec.set(new Uint8Array(offsets.buffer), 4);
    let p = 4 + offsets.byteLength;
    for (const b of bytes) { strSec.set(b, p); p += b.length; }

    const secs = [[stringsSectionId, strSec], ...[...this.sections].map(([id, u32]) => [id, new Uint8Array(u32.buffer, u32.byteOffset, u32.byteLength)])];
    const headerLen = 12 + secs.length * 12;
    let size = headerLen;
    for (const [, b] of secs) size += (b.byteLength + 3) & ~3;
    const out = new Uint8Array(size);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, MAGIC, true); dv.setUint32(4, VERSION, true); dv.setUint32(8, secs.length, true);
    let off = headerLen;
    secs.forEach(([id, b], i) => {
      dv.setUint32(12 + i * 12, id, true); dv.setUint32(16 + i * 12, off, true); dv.setUint32(20 + i * 12, b.byteLength, true);
      out.set(b, off);
      off += (b.byteLength + 3) & ~3;
    });
    return out;
  }
}

export class BinReader {
  constructor(buffer, stringsSectionId) {
    this.buf = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const dv = new DataView(this.buf);
    if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a VEIL index');
    if (dv.getUint32(4, true) !== VERSION) throw new Error('index version mismatch');
    const n = dv.getUint32(8, true);
    this.sections = new Map();
    for (let i = 0; i < n; i++) {
      this.sections.set(dv.getUint32(12 + i * 12, true), [dv.getUint32(16 + i * 12, true), dv.getUint32(20 + i * 12, true)]);
    }
    const [so, sl] = this.sections.get(stringsSectionId);
    this.strCount = dv.getUint32(so, true);
    this.strOffsets = new Uint32Array(this.buf, so + 4, this.strCount + 1);
    this.strBytes = new Uint8Array(this.buf, so + 4 + (this.strCount + 1) * 4, sl - 4 - (this.strCount + 1) * 4);
    this.strCache = new Array(this.strCount);
    this.dec = new TextDecoder();
  }
  has(id) { return this.sections.has(id); }
  u32(id) {
    const s = this.sections.get(id);
    if (!s) return new Uint32Array(0);
    return new Uint32Array(this.buf, s[0], s[1] >>> 2);
  }
  string(id) {
    let s = this.strCache[id];
    if (s === undefined) {
      s = this.dec.decode(this.strBytes.subarray(this.strOffsets[id], this.strOffsets[id + 1]));
      this.strCache[id] = s;
    }
    return s;
  }
  // Binary search a TABLE for `hash`; returns [valuesStart, valuesEnd) indexes into `t`, or null.
  static lookup(t, hash) {
    const n = t[0];
    let lo = 0, hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const v = t[1 + mid];
      if (v === hash) { const base = 2 + n * 2; return [base + t[1 + n + mid], base + t[1 + n + mid + 1]]; }
      if (v < hash) lo = mid + 1; else hi = mid - 1;
    }
    return null;
  }
}
