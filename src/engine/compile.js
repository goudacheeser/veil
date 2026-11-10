// Turns parsed lists into: the binary index, per-list DNR rulesets, MAIN-world scriptlet bundles,
// and a report of everything that could not be expressed.
import { F, SEC, EXC_BIT, TYPE } from './constants.js';
import { BinWriter } from './binary.js';
import { parseList } from './parser.js';
import { hash, patternTokens, ANY_TOKEN } from './tokens.js';
import { toDnrRule } from './dnr.js';

export const MAX_RULES_PER_RULESET = 30000;
export const MAX_REGEX_RULES = 1000;

export function compile(lists, { psl = [], meta = {} } = {}) {
  const w = new BinWriter();   // network.bin
  const cw = new BinWriter();  // cosmetic.bin (loaded on every page, kept small)
  const unsupported = [];
  const parsed = lists.map((l) => {
    const p = parseList(l.text, { name: l.name });
    for (const u of p.unsupported) unsupported.push({ list: l.name, ...u });
    return { ...l, ...p };
  });

  // ---- network ----
  const badKeys = new Set();
  for (const p of parsed) for (const f of p.network) if (f.badfilter) badKeys.add(badKey(f.raw));
  const netFilters = [];           // unique filters (first list wins)
  const netKeys = new Map();
  const knownLines = new Set();
  for (const p of parsed) {
    p.netIds = [];
    for (const f of p.network) {
      knownLines.add(hash(f.raw.trim()));
      if (f.badfilter) continue;
      const key = f.raw;
      if (badKeys.has(key)) continue;
      let id = netKeys.get(key);
      if (id === undefined) { id = netFilters.length; netKeys.set(key, id); netFilters.push(f); p.netIds.push(id); }
    }
  }

  // domain lists: dedupe by content; id 0 = none
  const domainListIds = new Map([['', 0]]);
  const domainListEntries = [[]];
  const domainList = (d) => {
    if (!d || (!d.include.length && !d.exclude.length)) return 0;
    const key = d.include.join('|') + '~' + d.exclude.join('|');
    let id = domainListIds.get(key);
    if (id === undefined) {
      id = domainListEntries.length;
      domainListIds.set(key, id);
      domainListEntries.push([...d.include.map((x) => w.str(x)), ...d.exclude.map((x) => w.str(x) | EXC_BIT)]);
    }
    return id;
  };

  // token frequency (pass 1) then best-token choice (pass 2)
  const freq = new Map();
  const filterTokens = netFilters.map((f) => {
    const toks = f.regex !== null ? [] : patternTokens(f.pattern.toLowerCase(), { anchorStart: f.anchorStart || f.anchorHost, anchorEnd: f.anchorEnd || f.pattern.endsWith('^') });
    for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);
    return toks;
  });
  const blockBuckets = new Map(), allowBuckets = new Map();
  const rec = new Uint32Array(netFilters.length * 6);
  netFilters.forEach((f, i) => {
    let best = null, bestN = Infinity;
    for (const t of filterTokens[i]) { const n = freq.get(t); if (n < bestN) { bestN = n; best = t; } }
    const tokenHash = best === null ? ANY_TOKEN : hash(best);
    // modifiers ($removeparam, $csp, $redirect-rule) never block, so they stay out of the decision index
    const isModifier = f.removeparam !== null || f.csp !== null || f.redirectRule;
    if (!isModifier) {
      const buckets = f.exception ? allowBuckets : blockBuckets;
      if (!buckets.has(tokenHash)) buckets.set(tokenHash, []);
      buckets.get(tokenHash).push(i);
    }

    let flags = 0, pattern = f.pattern;
    if (f.exception) flags |= F.EXCEPTION;
    if (f.important) flags |= F.IMPORTANT;
    if (f.regex !== null) { flags |= F.REGEX; pattern = f.regex; }
    if (f.anchorHost) flags |= F.ANCHOR_HOST;
    if (f.anchorStart) flags |= F.ANCHOR_START;
    if (f.anchorEnd) flags |= F.ANCHOR_END;
    if (f.party === 3) flags |= F.THIRD_PARTY;
    if (f.party === 1) flags |= F.FIRST_PARTY;
    if (f.matchCase) flags |= F.MATCH_CASE;
    if (f.redirect && !f.redirectRule) flags |= F.REDIRECT;
    if (f.removeparam !== null) flags |= F.REMOVEPARAM;
    if (f.csp !== null) flags |= F.CSP;
    if (f.regex === null) {
      if (f.anchorHost && /^[a-z0-9.-]+\^$/.test(pattern) && !f.anchorEnd) { flags |= F.HOST_ONLY; pattern = pattern.slice(0, -1); }
      else if (!f.anchorHost && !/[*^]/.test(pattern)) flags |= F.PLAIN;
    }
    rec[i * 6] = w.str(pattern);
    rec[i * 6 + 1] = (flags & 0xffff) | ((f.types & 0xffff) << 16);
    rec[i * 6 + 2] = domainList(f.domains);
    rec[i * 6 + 3] = domainList(f.to);
    rec[i * 6 + 4] = w.str(f.redirect || f.csp || (f.removeparam ?? ''));
    rec[i * 6 + 5] = w.str(f.raw);
  });
  w.setSection(SEC.NET_RECORDS, rec);
  w.setSection(SEC.NET_BLOCK_TOKENS, BinWriter.table(blockBuckets));
  w.setSection(SEC.NET_ALLOW_TOKENS, BinWriter.table(allowBuckets));
  {
    const offs = [0];
    for (const e of domainListEntries) offs.push(offs.at(-1) + e.length);
    w.setSection(SEC.DOMAIN_LISTS, Uint32Array.from([domainListEntries.length, ...offs, ...domainListEntries.flat()]));
  }

  // site flags from $elemhide/$generichide/$specifichide exceptions
  const siteFlags = new Map();
  for (const f of netFilters) {
    if (!f.exception || !f.siteFlags) continue;
    const hosts = [];
    if (f.anchorHost && /^[a-z0-9.*-]+\^?$/.test(f.pattern)) hosts.push(f.pattern.replace(/\^$/, ''));
    else if (!f.pattern && f.domains) hosts.push(...f.domains.include);
    else { unsupported.push({ line: f.raw, reason: 'cosmetic exception with path pattern' }); continue; }
    for (const h of hosts) addPair(siteFlags, cw, h, f.siteFlags);
  }
  cw.setSection(SEC.SITE_FLAGS, pairTable(siteFlags));

  // ---- cosmetic ----
  const globalExc = new Set();
  const specific = new Map(), procedural = new Map();
  const byId = new Map(), byClass = new Map(), any = new Set();
  const cosmeticSeen = new Set();
  const allCosmetic = [];
  for (const p of parsed) for (const c of p.cosmetic) {
    knownLines.add(hash(c.raw.trim()));
    const key = c.raw;
    if (cosmeticSeen.has(key)) continue;
    cosmeticSeen.add(key);
    allCosmetic.push(c);
    if (c.exception && c.generic && !c.domains.exclude.length) globalExc.add(c.ops ? JSON.stringify({ css: c.selector, ops: c.ops }) : c.selector);
  }
  let genericCount = 0;
  for (const c of allCosmetic) {
    const value = c.ops ? JSON.stringify({ css: c.selector, ops: c.ops }) : c.selector;
    if (globalExc.has(value)) continue;
    const table = c.ops ? procedural : specific;
    const strId = cw.str(value);
    if (c.generic && !c.exception) {
      genericCount++;
      const k = genericKey(c.selector);
      if (k.id) addTo(byId, hash(k.id), strId);
      else if (k.cls) addTo(byClass, hash(k.cls), strId);
      else any.add(strId);
      for (const d of c.domains.exclude) addPair(specific, cw, d, strId | EXC_BIT);
      continue;
    }
    for (const d of c.domains.include) addPair(table, cw, d, c.exception ? strId | EXC_BIT : strId);
    if (!c.exception) for (const d of c.domains.exclude) addPair(table, cw, d, strId | EXC_BIT);
  }
  cw.setSection(SEC.COSM_SPECIFIC, pairTable(specific));
  cw.setSection(SEC.COSM_PROCEDURAL, pairTable(procedural));
  cw.setSection(SEC.COSM_ID, BinWriter.table(byId));
  cw.setSection(SEC.COSM_CLASS, BinWriter.table(byClass));
  cw.setSection(SEC.COSM_ANY, Uint32Array.from(any));

  // ---- scriptlets ----  bundles: name -> Map(host -> args[][])
  const bundles = new Map();
  const scriptletExc = [];
  const scriptletSeen = new Set();
  for (const p of parsed) for (const s of p.scriptlets) {
    knownLines.add(hash(s.raw.trim()));
    if (scriptletSeen.has(s.raw)) continue;
    scriptletSeen.add(s.raw);
    if (s.exception) { scriptletExc.push(s); continue; }
    for (const d of s.domains.include) {
      if (d.includes('*')) { unsupported.push({ line: s.raw, reason: 'entity domain in scriptlet' }); continue; }
      if (!bundles.has(s.name)) bundles.set(s.name, new Map());
      const m = bundles.get(s.name);
      if (!m.has(d)) m.set(d, []);
      m.get(d).push({ args: s.args, exclude: s.domains.exclude });
    }
  }
  // exceptions: name -> Map(host -> args[][]) ; an empty args list means "all scriptlets of that name"
  const bundleExc = new Map();
  const scriptletTable = new Map();
  for (const e of scriptletExc) for (const d of e.domains.include) {
    if (d.includes('*')) continue;
    const names = e.name ? [e.name] : [...bundles.keys()];
    for (const name of names) {
      if (!bundleExc.has(name)) bundleExc.set(name, new Map());
      const m = bundleExc.get(name);
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(e.args);
    }
    addPair(scriptletTable, cw, d, cw.str(e.name ? JSON.stringify([e.name, ...e.args]) : '[]') | EXC_BIT);
  }
  for (const [name, m] of bundles) for (const [host, entries] of m) for (const e of entries) addPair(scriptletTable, cw, host, cw.str(JSON.stringify([name, ...e.args])));
  cw.setSection(SEC.SCRIPTLETS, pairTable(scriptletTable));

  // ---- psl, known lines, meta ----
  for (const wr of [w, cw]) {
    const pslTable = new Map();
    for (const rule of psl) addPair(pslTable, wr, rule, 1);
    wr.setSection(SEC.PSL, pairTable(pslTable));
  }
  w.setSection(SEC.KNOWN_LINES, Uint32Array.from([...knownLines].sort((a, b) => a - b)));

  // ---- DNR ----
  const rulesets = {};
  const dnrSkipped = [];
  const regexCandidates = [];
  for (const p of parsed) {
    const rules = [];
    for (const id of p.netIds) {
      const f = netFilters[id];
      const r = toDnrRule(f, 0);
      if (r.skip) { dnrSkipped.push({ list: p.name, line: f.raw, reason: r.skip }); continue; }
      const outRules = r.extra ? [r.rule, r.extra] : [r.rule];
      for (const rule of outRules) {
        if (rule.condition.regexFilter) regexCandidates.push({ list: p.name, rule, f });
        else rules.push(rule);
      }
    }
    rulesets[p.name] = rules;
  }
  regexCandidates.sort((a, b) => (b.f.exception + b.f.important) - (a.f.exception + a.f.important));
  regexCandidates.forEach((c, i) => {
    if (i < MAX_REGEX_RULES - 50) rulesets[c.list].push(c.rule);
    else dnrSkipped.push({ list: c.list, line: c.f.raw, reason: 'regex rule budget exhausted' });
  });
  for (const rules of Object.values(rulesets)) rules.forEach((r, i) => { r.id = i + 1; });

  const stats = {
    lists: parsed.map((p) => ({ name: p.name, lines: p.lines, network: p.network.length, cosmetic: p.cosmetic.length, scriptlets: p.scriptlets.length, unsupported: p.unsupported.length, dnrRules: rulesets[p.name].length })),
    networkFilters: netFilters.length, cosmeticFilters: allCosmetic.length, genericCosmetic: genericCount, genericAny: any.size,
    scriptletBundles: bundles.size, scriptletHosts: [...bundles.values()].reduce((n, m) => n + m.size, 0),
    dnrRules: Object.values(rulesets).reduce((n, r) => n + r.length, 0), dnrSkipped: dnrSkipped.length, unsupported: unsupported.length,
  };
  const metaJson = JSON.stringify({ ...meta, stats });
  w.setSection(SEC.META, Uint32Array.from([w.str(metaJson)]));
  cw.setSection(SEC.META, Uint32Array.from([cw.str(metaJson)]));

  return { networkBin: w.finish(SEC.STRINGS), cosmeticBin: cw.finish(SEC.STRINGS), rulesets, bundles, bundleExc, unsupported, dnrSkipped, stats };
}

function badKey(raw) { return raw.replace(/,badfilter|\$badfilter(,|$)/, (m, g) => (g === ',' ? '$' : '')); }
function addTo(map, k, v) { if (!map.has(k)) map.set(k, []); map.get(k).push(v); }
function addPair(map, w, key, value) { addTo(map, hash(key), w.str(key)); map.get(hash(key)).push(value); }
function pairTable(map) { return BinWriter.table(map); }

// Key a generic selector by an id or class that must be present in the DOM for it to match.
export function genericKey(sel) {
  let depth = 0, quote = null;
  let id = null, cls = null;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (depth === 0 && (c === '#' || c === '.')) {
      const m = /^(?:\\.|[\w-])+/.exec(sel.slice(i + 1));
      if (!m) continue;
      const name = m[0].replace(/\\(.)/g, '$1');
      if (c === '#') { if (!id) id = name; } else if (!cls) cls = name;
      i += m[0].length;
    }
  }
  return id ? { id } : cls ? { cls } : {};
}

export function parsePsl(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
}
