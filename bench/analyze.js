// Turns raw harness records into the results tables. Every request each blocker let through is
// classified by the reference engine (EasyList + EasyPrivacy + uBO filters + Fanboy/uBO annoyances,
// compiled by Veil's own parser) so all blockers are judged against the same yardstick.
//   node bench/analyze.js --run=<name>   (default: newest run)
import fs from 'node:fs';
import path from 'node:path';
import { compile, parsePsl } from '../src/engine/compile.js';
import { BinReader } from '../src/engine/binary.js';
import { SEC, CHROME_TYPE, TYPE } from '../src/engine/constants.js';
import { NetworkMatcher } from '../src/engine/matcher.js';
import { Psl } from '../src/engine/psl.js';
import { hostnameOf, entityOf, isThirdParty } from '../src/engine/url.js';
import { ROOT } from './lib/browser.js';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const rawRoot = path.join(ROOT, 'bench/results/raw');
const runName = arg('run', fs.readdirSync(rawRoot).filter((d) => fs.existsSync(path.join(rawRoot, d, 'run.json'))).sort().at(-1));
const dir = path.join(rawRoot, runName);
const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
const records = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'run.json').map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));

// reference engine
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/lists.json'), 'utf8'));
const refNames = cfg.lists.filter((l) => !l.local).map((l) => l.name); // public lists only: Veil's own defaults are not the yardstick
const lists = refNames.map((n) => ({ name: n, text: fs.readFileSync(path.join(ROOT, 'third_party/lists', `${n}.txt`), 'utf8') }));
const psl = parsePsl(fs.readFileSync(path.join(ROOT, 'third_party/public_suffix_list.dat'), 'utf8'));
const ref = compile(lists, { psl });
const reader = new BinReader(ref.networkBin, SEC.STRINGS);
const matcher = new NetworkMatcher(reader);
const P = new Psl(reader);
const CDP_TYPE = { Document: 'main_frame', Stylesheet: 'stylesheet', Image: 'image', Media: 'media', Font: 'font', Script: 'script', TextTrack: 'other', XHR: 'xmlhttprequest', Fetch: 'xmlhttprequest', EventSource: 'other', WebSocket: 'websocket', Manifest: 'other', Ping: 'ping', CSPViolationReport: 'csp_report', Preflight: 'other', Other: 'other', Prefetch: 'other', SignedExchange: 'other' };

function classify(req, pageUrl, docAllowed) {
  if (!/^https?:/.test(req.url)) return 'none';
  if (docAllowed) return 'none';
  const hostname = hostnameOf(req.url);
  const src = hostnameOf(req.initiator || req.doc || pageUrl) || hostnameOf(pageUrl);
  const typeName = CDP_TYPE[req.type] || 'other';
  if (typeName === 'main_frame' && req.frame === undefined) return 'none';
  const type = CHROME_TYPE[typeName] || TYPE.other;
  const ctx = { url: req.url.toLowerCase(), urlRaw: req.url, hostname, entity: entityOf(hostname, P), type, srcHostname: src, srcEntity: entityOf(src, P), thirdParty: isThirdParty(hostname, src, P) };
  return matcher.match(ctx).action;
}

const configs = run.configs;
const bySite = new Map();
for (const r of records) { if (!bySite.has(r.site)) bySite.set(r.site, {}); bySite.get(r.site)[r.config] = r; }
// only sites where every config loaded count toward coverage/performance (keeps comparisons paired)
const paired = [...bySite.values()].filter((s) => configs.every((c) => s[c] && s[c].loadOk));

const perConfig = {};
for (const c of configs) perConfig[c] = { sites: 0, requests: 0, adRequests: 0, blocked: 0, redirected: 0, falseNeg: 0, falseNegTP: 0, blockedNotAd: 0, bytes: 0, loads: [], dcls: [], errors: 0, failedLoads: 0, byCategory: {}, fnHosts: new Map(), breakage: [] };
for (const r of records) if (!r.loadOk) perConfig[r.config].failedLoads++;

for (const site of paired) {
  const base = site[configs[0]];
  for (const c of configs) {
    const r = site[c];
    const pc = perConfig[c];
    pc.sites++;
    const pageUrl = r.page?.url || `https://${r.site}/`;
    const h = hostnameOf(pageUrl);
    const docAllowed = !!matcher.matchDocument(pageUrl, h, entityOf(h, P));
    const cat = pc.byCategory[r.category] ||= { sites: 0, adRequests: 0, blocked: 0, falseNeg: 0 };
    cat.sites++;
    for (const q of r.requests) {
      if (q.type === 'Document' && q.url === pageUrl) continue;
      pc.requests++;
      pc.bytes += q.bytes || 0;
      const verdict = classify(q, pageUrl, docAllowed);
      const stopped = q.fate === 'blocked' || q.fate === 'redirected';
      if (verdict === 'block') {
        pc.adRequests++; cat.adRequests++;
        if (stopped) { pc.blocked++; cat.blocked++; if (q.fate === 'redirected') pc.redirected++; }
        else if (q.fate === 'loaded' || q.fate === 'failed' || q.fate === 'pending') {
          pc.falseNeg++; cat.falseNeg++;
          if (isThirdParty(hostnameOf(q.url), h, P)) pc.falseNegTP++;
          const hn = hostnameOf(q.url); pc.fnHosts.set(hn, (pc.fnHosts.get(hn) || 0) + 1);
        }
      } else if (stopped) pc.blockedNotAd++;
    }
    if (r.page?.load) pc.loads.push(r.page.load);
    if (r.page?.domContentLoaded) pc.dcls.push(r.page.domContentLoaded);
    pc.errors += r.errors || 0;
    // breakage proxies relative to the no-blocker baseline
    if (c !== configs[0] && base.page && r.page) {
      const flags = [];
      if (base.page.textLength > 2000 && r.page.textLength < base.page.textLength * 0.4) flags.push(`text ${base.page.textLength}→${r.page.textLength}`);
      if (base.page.videosPlayable > 0 && r.page.videosPlayable === 0 && r.page.videos > 0) flags.push('video not playable');
      if (base.page.hasBody && !r.page.hasBody) flags.push('empty body');
      if ((r.errors || 0) >= (base.errors || 0) + 5) flags.push(`js errors ${base.errors}→${r.errors}`);
      if (base.page.loginLink && !r.page.loginLink) flags.push('login link gone');
      if (base.page.comments && !r.page.comments) flags.push('comment section gone');
      if (flags.length) pc.breakage.push({ site: r.site, category: r.category, flags });
    }
  }
}

const q = (arr, p) => { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : 'n/a');
const base = perConfig[configs[0]];
const lines = [];
lines.push(`# Benchmark results: run ${runName}`, '', `Sites in corpus run: ${bySite.size} (${paired.length} loaded in every configuration and are used for paired comparisons). Reference classifier: ${refNames.join(', ')} compiled with Veil's engine; a request counts as an ad/tracker request if the reference engine would block it in that page context.`, '', `Labels: ${configs.map((c) => `**${c}** = ${run.labels?.[c] || c}`).join('; ')}`, '');
lines.push('## 1. Blocking coverage', '', '| config | requests seen | ad/tracker requests | blocked | redirected (surrogate) | let through (false negatives) | coverage | non-ad requests blocked |', '|---|---|---|---|---|---|---|---|');
for (const c of configs) { const p = perConfig[c]; lines.push(`| ${c} | ${p.requests} | ${p.adRequests} | ${p.blocked} | ${p.redirected} | ${p.falseNeg} (${p.falseNegTP} third-party) | ${pct(p.blocked, p.adRequests)} | ${p.blockedNotAd} |`); }
lines.push('', 'Coverage = blocked ÷ ad requests observed in that configuration. A blocker that stops an ad script also prevents the requests that script would have made, so "requests seen" differs per configuration; the baseline column shows how many ad requests a page makes with nothing installed.', '');
lines.push('### Coverage by category', '', '| category | ' + configs.map((c) => `${c} (blocked/ad reqs)`).join(' | ') + ' |', '|---|' + configs.map(() => '---').join('|') + '|');
for (const cat of ['news', 'video', 'shopping', 'social', 'longtail']) lines.push(`| ${cat} | ` + configs.map((c) => { const k = perConfig[c].byCategory[cat]; return k ? `${pct(k.blocked, k.adRequests)} (${k.blocked}/${k.adRequests}, ${k.sites} sites)` : '-'; }).join(' | ') + ' |');
lines.push('', '### Top hosts let through per config (false negatives)', '');
for (const c of configs.slice(1)) lines.push(`- **${c}**: ` + [...perConfig[c].fnHosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([h, n]) => `${h} (${n})`).join(', '));
lines.push('', '## 2. Breakage candidates (heuristic, needs manual confirmation)', '', 'Flags compare each blocker against the no-blocker load of the same site: visible text collapsing, video elements that were playable without a blocker, missing body, a jump in JS errors, login link or comment section disappearing. These are candidates, not confirmed breakage; see raw screenshots in the run directory.', '', '| config | candidates | % of paired sites | sites |', '|---|---|---|---|');
for (const c of configs.slice(1)) { const p = perConfig[c]; lines.push(`| ${c} | ${p.breakage.length} | ${pct(p.breakage.length, p.sites)} | ${p.breakage.slice(0, 15).map((b) => `${b.site} [${b.flags.join('; ')}]`).join('<br>')} |`); }
lines.push('', '## 3. Page load time (navigation timing, paired sites)', '', '| config | loadEventEnd median (ms) | p95 | DOMContentLoaded median | p95 | Δ median vs baseline | bytes transferred | JS errors | failed loads |', '|---|---|---|---|---|---|---|---|---|');
for (const c of configs) { const p = perConfig[c]; lines.push(`| ${c} | ${q(p.loads, 0.5).toFixed(0)} | ${q(p.loads, 0.95).toFixed(0)} | ${q(p.dcls, 0.5).toFixed(0)} | ${q(p.dcls, 0.95).toFixed(0)} | ${(q(p.loads, 0.5) - q(base.loads, 0.5)).toFixed(0)} | ${(p.bytes / 1e6).toFixed(1)} MB | ${p.errors} | ${p.failedLoads} |`); }
const veilRecs = records.filter((r) => r.config === 'veil' && r.veil);
if (veilRecs.length) {
  const cpu = veilRecs.map((r) => r.veil.cpuMs), msgs = veilRecs.map((r) => r.veil.messages);
  const lt = veilRecs.at(-1).veilTiming || {};
  lines.push('', '### Veil content-script cost (self-reported per page, top frame)', '', `| pages | cosmetic CPU median (ms) | p95 | generic lookups/page median | service-worker cosmetic lookup avg (ms) | index rehydrations total (ms) |`, '|---|---|---|---|---|---|', `| ${veilRecs.length} | ${q(cpu, 0.5).toFixed(2)} | ${q(cpu, 0.95).toFixed(2)} | ${q(msgs, 0.5)} | ${(lt.lookupMs / Math.max(1, lt.lookups)).toFixed(2)} | ${(lt.rehydrateMs || 0).toFixed(1)} |`);
}
lines.push('', `Raw data: \`bench/results/raw/${runName}/\` (one JSON per site×config with every request and its fate, plus screenshots).`);
const out = lines.join('\n');
fs.mkdirSync(path.join(ROOT, 'bench/results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'bench/results', `${runName}.md`), out);
fs.writeFileSync(path.join(ROOT, 'bench/results', `${runName}.json`), JSON.stringify({ run: runName, configs, paired: paired.length, perConfig: Object.fromEntries(configs.map((c) => { const p = perConfig[c]; return [c, { ...p, fnHosts: Object.fromEntries(p.fnHosts), loads: undefined, dcls: undefined, loadMedian: q(p.loads, 0.5), loadP95: q(p.loads, 0.95), dclMedian: q(p.dcls, 0.5) }]; })) }, null, 1));
console.log(out);
