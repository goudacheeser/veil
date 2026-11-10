// Network request matcher over the binary index. In the extension this backs the logger and the
// filter-list update diff; real-time blocking is done by declarativeNetRequest. The benchmark
// harness uses it as the reference classifier.
import { F, SEC, TYPE } from './constants.js';
import { BinReader } from './binary.js';
import { tokenizeUrl } from './tokens.js';
import { hostnameSuffixes } from './url.js';

export const REC = 6; // u32 words per filter record
// record: [patternStr, flags | types<<16, domainListId, toListId, modifierStr, rawStr]

const RE_ESCAPE = /[.+?${}()|[\]\\/]/g;
export function patternToRegExp(pattern, flags) {
  let re = pattern.replace(RE_ESCAPE, '\\$&').replace(/\*/g, '.*').replace(/\^/g, '(?:[^\\w.%-]|$)');
  if (flags & F.ANCHOR_HOST) re = '^[a-z][a-z0-9.+-]*:\\/+(?!\\/)(?:[^/?#]*\\.)?' + re;
  else if (flags & F.ANCHOR_START) re = '^' + re;
  if (flags & F.ANCHOR_END) re += '$';
  return new RegExp(re, flags & F.MATCH_CASE ? '' : 'i');
}

export class NetworkMatcher {
  constructor(reader) {
    this.r = reader;
    this.rec = reader.u32(SEC.NET_RECORDS);
    this.blockTokens = reader.u32(SEC.NET_BLOCK_TOKENS);
    this.allowTokens = reader.u32(SEC.NET_ALLOW_TOKENS);
    this.domainLists = reader.u32(SEC.DOMAIN_LISTS);
    this.count = this.rec.length / REC;
    this.compiled = new Array(this.count);
    this.domainSets = new Map();
    this.tokens = [];
  }

  domainSet(listId) {
    let ds = this.domainSets.get(listId);
    if (!ds) {
      const dl = this.domainLists;
      const start = dl[1 + listId], end = dl[1 + listId + 1];
      const base = 2 + dl[0];
      ds = { inc: new Set(), exc: new Set() };
      for (let i = base + start; i < base + end; i++) {
        const v = dl[i];
        (v & 0x80000000 ? ds.exc : ds.inc).add(this.r.string(v & 0x7fffffff));
      }
      this.domainSets.set(listId, ds);
    }
    return ds;
  }

  static hostInSet(set, hostname, entity) {
    for (const h of hostnameSuffixes(hostname)) if (set.has(h)) return true;
    if (entity) for (const h of hostnameSuffixes(entity)) if (set.has(h)) return true;
    return false;
  }

  testFilter(i, ctx) {
    const w = this.rec[i * REC + 1];
    const flags = w & 0xffff, types = w >>> 16;
    if ((types & ctx.type) === 0) return false;
    if (flags & F.THIRD_PARTY && !ctx.thirdParty) return false;
    if (flags & F.FIRST_PARTY && ctx.thirdParty) return false;
    const dl = this.rec[i * REC + 2];
    if (dl) {
      const ds = this.domainSet(dl);
      if (ds.inc.size && !NetworkMatcher.hostInSet(ds.inc, ctx.srcHostname, ctx.srcEntity)) return false;
      if (ds.exc.size && NetworkMatcher.hostInSet(ds.exc, ctx.srcHostname, ctx.srcEntity)) return false;
    }
    const tl = this.rec[i * REC + 3];
    if (tl) {
      const ds = this.domainSet(tl);
      if (ds.inc.size && !NetworkMatcher.hostInSet(ds.inc, ctx.hostname, ctx.entity)) return false;
      if (ds.exc.size && NetworkMatcher.hostInSet(ds.exc, ctx.hostname, ctx.entity)) return false;
    }
    const pattern = this.r.string(this.rec[i * REC]);
    if (flags & F.HOST_ONLY) {
      const h = ctx.hostname;
      return h === pattern || (h.length > pattern.length && h.endsWith(pattern) && h.charCodeAt(h.length - pattern.length - 1) === 46);
    }
    const url = flags & F.MATCH_CASE ? ctx.urlRaw : ctx.url;
    if (flags & F.PLAIN) {
      if (flags & F.ANCHOR_START) return flags & F.ANCHOR_END ? url === pattern : url.startsWith(pattern);
      if (flags & F.ANCHOR_END) return url.endsWith(pattern);
      return url.includes(pattern);
    }
    let re = this.compiled[i];
    if (!re) {
      try { re = flags & F.REGEX ? new RegExp(pattern, flags & F.MATCH_CASE ? '' : 'i') : patternToRegExp(pattern, flags); }
      catch { re = /$^/; }
      this.compiled[i] = re;
    }
    return re.test(url);
  }

  scan(table, ctx, wantImportant) {
    const toks = this.tokens;
    let found = -1;
    for (let t = 0; t < toks.length; t++) {
      const range = BinReader.lookup(table, toks[t]);
      if (!range) continue;
      for (let k = range[0]; k < range[1]; k++) {
        const i = table[k];
        if (this.testFilter(i, ctx)) {
          if (!wantImportant || this.rec[i * REC + 1] & F.IMPORTANT) return i;
          if (found === -1) found = i;
        }
      }
    }
    return found;
  }

  // ctx: { url (lowercased), urlRaw, hostname, entity, type (bit), srcHostname, srcEntity, thirdParty }
  match(ctx) {
    tokenizeUrl(ctx.url, this.tokens);
    const b = this.scan(this.blockTokens, ctx, true);
    if (b === -1) return { action: 'none', filter: -1 };
    if (this.rec[b * REC + 1] & F.IMPORTANT) return this.result('block', b);
    const a = this.scan(this.allowTokens, ctx, false);
    if (a !== -1) return this.result('allow', a, b);
    return this.result('block', b);
  }

  // Does an @@…$document exception cover this page? (then nothing on it is blocked)
  matchDocument(pageUrl, hostname, entity) {
    const ctx = { url: pageUrl.toLowerCase(), urlRaw: pageUrl, hostname, entity, type: TYPE.document, srcHostname: hostname, srcEntity: entity, thirdParty: false };
    tokenizeUrl(ctx.url, this.tokens);
    const a = this.scan(this.allowTokens, ctx, false);
    return a === -1 ? null : this.result('allow', a);
  }

  result(action, i, blockedBy = -1) {
    const w = this.rec[i * REC + 1];
    const out = { action, filter: i, raw: this.r.string(this.rec[i * REC + 5]), important: !!(w & F.IMPORTANT) };
    if (w & F.REDIRECT) out.redirect = this.r.string(this.rec[i * REC + 4]);
    if (blockedBy !== -1) out.overrode = this.r.string(this.rec[blockedBy * REC + 5]);
    return out;
  }
}
