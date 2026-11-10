// Engine micro-benchmark: index open (rehydrate) time and per-request decision cost of the JS
// matcher, over real request URLs recorded by the harness (or a synthetic set if none exist).
//   node bench/microbench.js [--run=<name>]
import fs from 'node:fs';
import path from 'node:path';
import { BinReader } from '../src/engine/binary.js';
import { SEC, CHROME_TYPE, TYPE } from '../src/engine/constants.js';
import { NetworkMatcher } from '../src/engine/matcher.js';
import { CosmeticIndex } from '../src/engine/cosmetic-index.js';
import { Psl } from '../src/engine/psl.js';
import { hostnameOf, entityOf, isThirdParty } from '../src/engine/url.js';
import { ROOT, DIST } from './lib/browser.js';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const rawRoot = path.join(ROOT, 'bench/results/raw');
const runName = arg('run', fs.existsSync(rawRoot) ? fs.readdirSync(rawRoot).sort().at(-1) : null);
let reqs = [];
if (runName) {
  for (const f of fs.readdirSync(path.join(rawRoot, runName)).filter((f) => f.endsWith('.none.json'))) {
    const r = JSON.parse(fs.readFileSync(path.join(rawRoot, runName, f), 'utf8'));
    for (const q of r.requests || []) if (/^https?:/.test(q.url)) reqs.push({ url: q.url, type: q.type, src: r.page?.url || `https://${r.site}/` });
  }
}
if (reqs.length < 1000) { console.log('no recorded requests found; using synthetic URLs'); for (let i = 0; i < 20000; i++) reqs.push({ url: `https://cdn${i % 50}.example${i % 700}.com/static/js/${i}/app.js?x=${i}`, type: 'Script', src: 'https://www.site.com/' }); }
const CDP_TYPE = { Document: 'main_frame', Stylesheet: 'stylesheet', Image: 'image', Media: 'media', Font: 'font', Script: 'script', XHR: 'xmlhttprequest', Fetch: 'xmlhttprequest', WebSocket: 'websocket', Ping: 'ping' };

const t0 = performance.now();
const netBuf = fs.readFileSync(path.join(DIST, 'index/core.network.bin'));
const t1 = performance.now();
const reader = new BinReader(netBuf, SEC.STRINGS);
const matcher = new NetworkMatcher(reader);
const P = new Psl(reader);
const t2 = performance.now();
const cosBuf = fs.readFileSync(path.join(DIST, 'index/core.cosmetic.bin'));
const t3 = performance.now();
const cr = new BinReader(cosBuf, SEC.STRINGS); const ci = new CosmeticIndex(cr); const cp = new Psl(cr);
const t4 = performance.now();

const ctxs = reqs.map((r) => { const hostname = hostnameOf(r.url), src = hostnameOf(r.src); return { url: r.url.toLowerCase(), urlRaw: r.url, hostname, entity: entityOf(hostname, P), type: CHROME_TYPE[CDP_TYPE[r.type] || 'other'] || TYPE.other, srcHostname: src, srcEntity: entityOf(src, P), thirdParty: isThirdParty(hostname, src, P) }; });
for (const c of ctxs) matcher.match(c); // warm (lazy regex compilation, JIT)
const times = new Float64Array(ctxs.length);
let blocked = 0;
const tAll = performance.now();
for (let i = 0; i < ctxs.length; i++) { const s = performance.now(); if (matcher.match(ctxs[i]).action === 'block') blocked++; times[i] = performance.now() - s; }
const total = performance.now() - tAll;
const sorted = Float64Array.from(times).sort();
const pick = (p) => sorted[Math.floor(p * (sorted.length - 1))];

// cosmetic lookup cost for the hostnames in the corpus
const hosts = [...new Set(ctxs.map((c) => c.srcHostname))].filter(Boolean);
const ct = [];
for (const h of hosts) { const s = performance.now(); ci.siteFlags(h, entityOf(h, cp)); ci.specificFor(h, entityOf(h, cp)); ct.push(performance.now() - s); }
ct.sort((a, b) => a - b);
const gt = [];
const classes = ['header', 'nav', 'content', 'ad', 'ad-slot', 'sidebar', 'promo', 'banner', 'sponsored', 'footer', 'row', 'col', 'btn', 'card', 'adsbygoogle', 'widget', 'menu', 'link', 'image', 'text'];
for (let i = 0; i < 2000; i++) { const s = performance.now(); ci.generic(['main', 'top-ad'], classes, new Set()); gt.push(performance.now() - s); }
gt.sort((a, b) => a - b);

const out = {
  decisions: ctxs.length, blockedByReference: blocked,
  readNetworkBinMs: +(t1 - t0).toFixed(2), openNetworkIndexMs: +(t2 - t1).toFixed(2), networkBinMB: +(netBuf.length / 1e6).toFixed(2),
  readCosmeticBinMs: +(t3 - t2).toFixed(2), openCosmeticIndexMs: +(t4 - t3).toFixed(2), cosmeticBinMB: +(cosBuf.length / 1e6).toFixed(2),
  perDecisionUs: { median: +(pick(0.5) * 1000).toFixed(2), p95: +(pick(0.95) * 1000).toFixed(2), p99: +(pick(0.99) * 1000).toFixed(2), mean: +(total / ctxs.length * 1000).toFixed(2) },
  cosmeticHostLookupUs: { hosts: hosts.length, median: +(ct[ct.length >> 1] * 1000).toFixed(1), p95: +(ct[Math.floor(ct.length * 0.95)] * 1000).toFixed(1) },
  genericLookup20ClassesUs: { median: +(gt[gt.length >> 1] * 1000).toFixed(1), p95: +(gt[Math.floor(gt.length * 0.95)] * 1000).toFixed(1) },
  node: process.version,
};
console.log(JSON.stringify(out, null, 1));
fs.mkdirSync(path.join(ROOT, 'bench/results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'bench/results/microbench.json'), JSON.stringify(out, null, 1));
