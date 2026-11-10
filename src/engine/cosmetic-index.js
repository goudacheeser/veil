// Cosmetic / scriptlet / site-flag lookups over the binary index.
import { SEC, EXC_BIT } from './constants.js';
import { BinReader } from './binary.js';
import { hash } from './tokens.js';
import { hostnameSuffixes } from './url.js';

export class CosmeticIndex {
  constructor(reader) {
    this.r = reader;
    this.specific = reader.u32(SEC.COSM_SPECIFIC);
    this.byId = reader.u32(SEC.COSM_ID);
    this.byClass = reader.u32(SEC.COSM_CLASS);
    this.any = reader.u32(SEC.COSM_ANY);
    this.procedural = reader.u32(SEC.COSM_PROCEDURAL);
    this.scriptletTable = reader.u32(SEC.SCRIPTLETS);
    this.flags = reader.u32(SEC.SITE_FLAGS);
    this._any = null;
  }

  // Iterate (keyStrId, value) pairs stored under hostname & its parents (plus entity forms).
  *pairs(table, hostname, entity) {
    for (const host of [hostname, entity]) {
      if (!host) continue;
      for (const h of hostnameSuffixes(host)) {
        const range = BinReader.lookup(table, hash(h));
        if (!range) continue;
        for (let k = range[0]; k < range[1]; k += 2) {
          if (this.r.string(table[k]) !== h) continue; // hash collision guard
          yield table[k + 1];
        }
      }
    }
  }

  siteFlags(hostname, entity) {
    let f = 0;
    for (const v of this.pairs(this.flags, hostname, entity)) f |= v;
    return f;
  }

  // -> { hide: string[], procedural: object[], exceptions: Set<string> }
  specificFor(hostname, entity) {
    const hide = new Set(), exceptions = new Set();
    for (const v of this.pairs(this.specific, hostname, entity)) {
      const sel = this.r.string(v & ~EXC_BIT);
      if (v & EXC_BIT) exceptions.add(sel); else hide.add(sel);
    }
    for (const e of exceptions) hide.delete(e);
    const procedural = [];
    for (const v of this.pairs(this.procedural, hostname, entity)) {
      const json = this.r.string(v & ~EXC_BIT);
      if (v & EXC_BIT) exceptions.add(json); else procedural.push(json);
    }
    return { hide: [...hide], procedural: procedural.filter((p) => !exceptions.has(p)).map((p) => JSON.parse(p)), exceptions };
  }

  genericAny() {
    if (!this._any) this._any = Array.from(this.any, (id) => this.r.string(id));
    return this._any;
  }

  // Generic selectors whose key id/class appears in `ids` / `classes`, minus per-site exceptions.
  generic(ids, classes, exceptions) {
    const out = [];
    const take = (table, keys) => {
      for (const key of keys) {
        const range = BinReader.lookup(table, hash(key));
        if (!range) continue;
        for (let k = range[0]; k < range[1]; k++) {
          const sel = this.r.string(table[k]);
          if (!exceptions || !exceptions.has(sel)) out.push(sel);
        }
      }
    };
    take(this.byId, ids);
    take(this.byClass, classes);
    return out;
  }

  // -> [[name, ...args], ...]
  scriptletsFor(hostname, entity) {
    const list = [], exc = new Set();
    let excAll = false;
    for (const v of this.pairs(this.scriptletTable, hostname, entity)) {
      const s = this.r.string(v & ~EXC_BIT);
      if (v & EXC_BIT) { if (s === '[]') excAll = true; else exc.add(s); } else list.push(s);
    }
    if (excAll) return [];
    return [...new Set(list)].filter((s) => !exc.has(s)).map((s) => JSON.parse(s));
  }
}
