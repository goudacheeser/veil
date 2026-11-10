// Public-suffix lookups over the PSL pair-table in the binary index (no decode on load).
import { SEC } from './constants.js';
import { BinReader } from './binary.js';
import { hash } from './tokens.js';

export class Psl {
  constructor(reader) { this.r = reader; this.t = reader.u32(SEC.PSL); }
  has(rule) {
    const range = BinReader.lookup(this.t, hash(rule));
    if (!range) return false;
    for (let k = range[0]; k < range[1]; k += 2) if (this.r.string(this.t[k]) === rule) return true;
    return false;
  }
}
