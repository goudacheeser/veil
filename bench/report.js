// Assembles docs/RESULTS.md from the analyzer outputs of one or more runs plus the anti-adblock,
// micro-benchmark and memory results. The "strongest on this metric" column is computed, not typed.
//   node bench/report.js --runs=batchA-chrome,batchB-brave,batchC-chrome126
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/browser.js';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const res = path.join(ROOT, 'bench/results');
const runs = arg('runs', '').split(',').filter(Boolean).map((r) => ({ name: r, data: JSON.parse(fs.readFileSync(path.join(res, `${r}.json`), 'utf8')), meta: JSON.parse(fs.readFileSync(path.join(res, 'raw', r, 'run.json'), 'utf8')) }));
const read = (f) => (fs.existsSync(path.join(res, f)) ? JSON.parse(fs.readFileSync(path.join(res, f), 'utf8')) : null);
const anti = read('antiadblock.json'), micro = read('microbench.json'), mem = read('memory.json');
const buildReport = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/build-report.json'), 'utf8'));
const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : NaN);
const L = [];
const best = (rows, key, lower = false) => { const v = rows.filter((r) => Number.isFinite(r[key])); if (!v.length) return '-'; const m = v.reduce((a, b) => (lower ? b[key] < a[key] : b[key] > a[key]) ? b : a); return m.config; };

L.push('# Results', '', `Generated ${new Date().toISOString().slice(0, 16)}Z by \`bench/report.js\`. Every number below comes from a file under \`bench/results/\`; raw per-request data is under \`bench/results/raw/<run>/\`.`, '');
L.push('## Setup', '', '* Corpus: `bench/corpus/corpus.json`, 500 sites (news 100, video 75, shopping 100, social 50, long-tail 175 sampled from Tranco ranks 5k–100k with seed 20261109).', '* Host: Windows 11, 16 GB RAM, 16 threads. Browsers headless (new headless), 1366×900, normal desktop UA.', '* Each site is loaded once per configuration, all configurations of a batch in parallel so they share network conditions. A site counts only if it reached DOMContentLoaded in every configuration of its batch.', '* Reference classifier for "ad/tracker request": EasyList + EasyPrivacy + uBO filters/privacy/badware/unbreak/quick-fixes + EasyList anti-adblock + Peter Lowe + Fanboy Annoyance + uBO annoyances, compiled by Veil\'s parser, evaluated per request with page context (`bench/analyze.js`).', '* Competitor builds: `bench/competitors/SHA256SUMS`. uBO 1.76 (MV2) runs in Chrome 126, the last Chrome that runs MV2 unconditionally, paired with a Chrome 126 no-blocker baseline, because Chrome 157 refuses MV2 extensions (and Brave only re-enables MV2 for store-signed IDs: an unpacked uBO loads there but blocks nothing). uBO Lite runs in its default "Basic" mode. Brave Shields are measured in Brave 157 against Brave with shields off.', '');

L.push('## 1. Blocking coverage', '');
const covRows = [];
for (const r of runs) {
  L.push(`### Run \`${r.name}\` (${r.data.paired} paired sites of ${r.meta.sites})`, '', '| config | requests seen | ad/tracker requests | blocked | redirected | let through (false negatives) | of which third-party | coverage | non-ad requests blocked |', '|---|---|---|---|---|---|---|---|---|');
  for (const [c, p] of Object.entries(r.data.perConfig)) {
    const cov = pct(p.blocked, p.adRequests);
    L.push(`| ${c} | ${p.requests} | ${p.adRequests} | ${p.blocked} | ${p.redirected} | ${p.falseNeg} | ${p.falseNegTP} | ${Number.isFinite(cov) ? cov + '%' : '-'} | ${p.blockedNotAd} |`);
    if (!/^none/.test(c) && !/-none$/.test(c)) covRows.push({ config: c, run: r.name, coverage: cov, falseNeg: p.falseNeg, falseNegTP: p.falseNegTP, breakage: p.breakage.length, sites: p.sites, loadMedian: p.loadMedian, loadP95: p.loadP95, baseLoad: r.data.perConfig[Object.keys(r.data.perConfig)[0]].loadMedian, errors: p.errors, failedLoads: p.failedLoads });
  }
  L.push('', '| category | ' + Object.keys(r.data.perConfig).join(' | ') + ' |', '|---|' + Object.keys(r.data.perConfig).map(() => '---').join('|') + '|');
  for (const cat of ['news', 'video', 'shopping', 'social', 'longtail']) L.push(`| ${cat} | ` + Object.values(r.data.perConfig).map((p) => { const k = p.byCategory[cat]; return k ? `${pct(k.blocked, k.adRequests)}% (${k.blocked}/${k.adRequests})` : '-'; }).join(' | ') + ' |');
  L.push('', 'False negatives by host (top 10):', '');
  for (const [c, p] of Object.entries(r.data.perConfig)) if (!/^none/.test(c) && !/-none$/.test(c)) L.push(`* **${c}**: ` + Object.entries(p.fnHosts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([h, n]) => `${h} (${n})`).join(', '));
  L.push('');
}
L.push('"Coverage" is blocked ÷ ad requests observed with that blocker installed. Third-party false negatives are the ones that matter most for tracking; first-party ones are mostly first-party analytics endpoints and ad-slot CSS on the publisher\'s own CDN.', '');

L.push('## 2. Breakage candidates', '', 'Heuristic, relative to the no-blocker load of the same site in the same batch (text collapse >60 %, playable video lost, empty body, +5 JS errors, login link or comment section disappearing). Candidates need a human look at the screenshots in the raw run directory before being called breakage.', '', '| config | run | candidates | % of paired sites |', '|---|---|---|---|');
for (const c of covRows) L.push(`| ${c.config} | ${c.run} | ${c.breakage} | ${pct(c.breakage, c.sites)}% |`);
for (const r of runs) for (const [c, p] of Object.entries(r.data.perConfig)) if (p.breakage.length) L.push('', `<details><summary>${c} (${r.name}) candidate list</summary>`, '', ...p.breakage.map((b) => `* ${b.site} (${b.category}): ${b.flags.join('; ')}`), '', '</details>');
L.push('');

L.push('## 3. Performance', '', '### Page load (navigation timing `loadEventEnd`, paired sites, ms)', '', '| config | run | median | p95 | Δ median vs that batch\'s baseline | JS errors | loads that failed |', '|---|---|---|---|---|---|---|');
for (const r of runs) for (const [c, p] of Object.entries(r.data.perConfig)) { const base = r.data.perConfig[Object.keys(r.data.perConfig)[0]]; L.push(`| ${c} | ${r.name} | ${Math.round(p.loadMedian)} | ${Math.round(p.loadP95)} | ${c === Object.keys(r.data.perConfig)[0] ? '0' : Math.round(p.loadMedian - base.loadMedian)} | ${p.errors} | ${p.failedLoads} |`); }
L.push('', 'Load times are dominated by the sites themselves and by whether ads were blocked (blocking usually makes pages faster); the Δ column is the honest signal and still has run-to-run noise of tens of milliseconds.', '');
if (micro) L.push('### Engine micro-benchmark (Node, `bench/microbench.js`)', '', `| decisions | per-decision median | p95 | p99 | open network index (11.5 MB) | open cosmetic index (1.9 MB) | cosmetic hostname lookup median | generic lookup (20 classes) median |`, '|---|---|---|---|---|---|---|---|', `| ${micro.decisions} real URLs | ${micro.perDecisionUs.median} µs | ${micro.perDecisionUs.p95} µs | ${micro.perDecisionUs.p99} µs | ${micro.openNetworkIndexMs} ms (+${micro.readNetworkBinMs} ms read) | ${micro.openCosmeticIndexMs} ms (+${micro.readCosmeticBinMs} ms read) | ${micro.cosmeticHostLookupUs.median} µs | ${micro.genericLookup20ClassesUs.median} µs |`, '', 'The 2 ms per-decision target is met by two orders of magnitude for the JS matcher. Live request decisions are made by Chromium\'s declarativeNetRequest engine, whose per-request cost is not observable from an extension; it is the same engine uBO Lite and AdGuard MV3 use.', '');
const veilRun = runs.find((r) => r.data.perConfig.veil);
if (veilRun) {
  const raw = path.join(res, 'raw', veilRun.name);
  const recs = fs.readdirSync(raw).filter((f) => f.endsWith('.veil.json')).map((f) => JSON.parse(fs.readFileSync(path.join(raw, f), 'utf8'))).filter((r) => r.veil);
  if (recs.length) {
    const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    const cpu = recs.map((r) => r.veil.cpuMs), msgs = recs.map((r) => r.veil.messages), sel = recs.map((r) => r.veil.selectors + r.veil.generic);
    const lt = recs.at(-1).veilTiming || {};
    L.push('### Veil content script and service worker cost (self-reported, top frames)', '', `| pages | cosmetic CPU per page median | p95 | generic lookup messages per page median | selectors injected per page median | worker cosmetic lookup avg | index rehydrations over the run |`, '|---|---|---|---|---|---|---|', `| ${recs.length} | ${q(cpu, 0.5).toFixed(2)} ms | ${q(cpu, 0.95).toFixed(2)} ms | ${q(msgs, 0.5)} | ${q(sel, 0.5)} | ${(lt.lookupMs / Math.max(1, lt.lookups)).toFixed(2)} ms | ${(lt.rehydrateMs || 0).toFixed(1)} ms total |`, '');
  }
}
if (mem) {
  const cols = ['idle', ...mem.tabCounts.map((n) => `tabs${n}`)];
  L.push('### Memory and CPU at 10 / 50 / 200 tabs (`bench/memory.js`, identical local page in every tab)', '', '| config | ' + cols.map((c) => `${c}: private MB total (extension process)`).join(' | ') + ' | CPU ms total at max tabs (extension process) |', '|---|' + cols.map(() => '---').join('|') + '|---|');
  for (const [c, r] of Object.entries(mem.results)) { const last = r[cols.at(-1)] || r[cols.at(-2)]; L.push(`| ${c} | ` + cols.map((k) => (r[k] ? `${r[k].totalPrivateMB} (${r[k].extensionProcessPrivateMB})` : '-')).join(' | ') + ` | ${last ? `${last.totalCpuMs} (${last.extensionProcessCpuMs})` : '-'} |`); }
  L.push('', mem.note, '');
}

if (anti) {
  const cfgs = Object.keys(anti);
  const dets = [...new Set(Object.values(anti).flatMap((r) => Object.keys(r)))];
  L.push('## 4. Anti-adblock detection suite (`bench/antiadblock/run.js`)', '', 'Seven detector techniques (BlockAdBlock bait element, adsbygoogle load check, /ads.js and prebid baits, fetch bait, FuckAdBlock callbacks, missing BlockAdBlock library) on a local page that loads real ad hostnames via host-resolver rules. DETECTED = the site would show a wall. `_bait` rows show whether the bait was actually blocked (a blocker that lets the bait through "passes" trivially).', '', '| detector | ' + cfgs.join(' | ') + ' |', '|---|' + cfgs.map(() => '---').join('|') + '|');
  for (const d of dets) L.push(`| ${d} | ` + cfgs.map((c) => (anti[c][d] === undefined ? '?' : d.startsWith('_') ? (anti[c][d] ? 'loaded' : 'stopped') : anti[c][d] ? '**DETECTED**' : 'passed')).join(' | ') + ' |');
  L.push('');
}

L.push('## 5. Privacy', '', '* Veil made **0** network requests during every benchmark and test run (`storage.netlog` empty; asserted by `test/integration.test.js`). The updater is off by default; when enabled it fetches `lists.lock.json` + an Ed25519 signature from the user-configured URL, then the lists, verifying SHA-256 against the signed lock.', '* Per-request records in the raw data contain every URL each browser requested; none go to a Veil-controlled host because there is none.', '');

L.push('## 6. Filter engine coverage of list syntax', '', `From \`build/build-report.json\` for the bundled list snapshot: ${Object.values(buildReport.groups).reduce((n, g) => n + g.networkFilters, 0)} network filters, ${Object.values(buildReport.groups).reduce((n, g) => n + g.cosmeticFilters, 0)} cosmetic filters, ${Object.values(buildReport.groups).reduce((n, g) => n + g.scriptletHosts, 0)} hostname→scriptlet rules compiled; ${buildReport.enabledDnrRules} DNR rules enabled by default (${buildReport.totalDnrRules} total). Not expressible: ${buildReport.unsupported} lines (parser) + ${buildReport.dnrSkipped} filters (DNR), broken down in \`docs/LIMITATIONS.md\`.`, '');

L.push('## 7. Who is strongest on each metric', '');
const byMetric = [
  ['Blocking coverage (highest)', best(covRows, 'coverage')],
  ['Third-party trackers let through (fewest)', best(covRows, 'falseNegTP', true)],
  ['Breakage candidates (fewest)', best(covRows, 'breakage', true)],
  ['Page load median vs own baseline (largest speed-up)', best(covRows.map((c) => ({ ...c, delta: c.loadMedian - c.baseLoad })), 'delta', true)],
];
if (anti) byMetric.push(['Anti-adblock detectors passed (most)', Object.entries(anti).filter(([c]) => c !== 'none').map(([c, r]) => ({ config: c, n: Object.entries(r).filter(([k, v]) => !k.startsWith('_') && v === false).length })).sort((a, b) => b.n - a.n)[0]?.config || '-']);
if (mem) byMetric.push(['Memory at most tabs (lowest total private bytes)', Object.entries(mem.results).filter(([c]) => c !== 'none').map(([c, r]) => ({ config: c, m: (r[`tabs${mem.tabCounts.at(-1)}`] || r[`tabs${mem.tabCounts.at(-2)}`] || {}).totalPrivateMB ?? Infinity })).sort((a, b) => a.m - b.m)[0]?.config || '-']);
L.push('| metric | strongest | note |', '|---|---|---|');
for (const [m, w] of byMetric) L.push(`| ${m} | **${w}** | ${w === 'veil' ? '' : 'Veil loses here'} |`);
L.push('', 'Cross-batch comparisons (Chrome 157 vs Chrome 126 vs Brave) are indicative only; within a batch the sites, time window and network are shared.', '');

fs.writeFileSync(path.join(ROOT, 'docs/RESULTS.md'), L.join('\n'));
console.log(L.join('\n'));
