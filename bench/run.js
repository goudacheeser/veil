// Benchmark harness. For every site in the corpus, loads the page once per blocker configuration,
// all configurations in parallel so network conditions are shared, and records every request
// (with its fate), navigation timing, errors and breakage proxies into bench/results/raw/<run>/.
//   node bench/run.js --configs=none,veil,ubol --limit=50 --category=news --run=name --concurrency=2
import fs from 'node:fs';
import path from 'node:path';
import { launch, extensionWorker, ROOT } from './lib/browser.js';
import { CONFIGS } from './configs.js';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const configNames = arg('configs', 'none,veil,ubol,adguard,ghostery').split(',').filter((c) => CONFIGS[c] && CONFIGS[c].available !== false);
const limit = Number(arg('limit', 500));
const category = arg('category', '');
const concurrency = Number(arg('concurrency', 2));
const runName = arg('run', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
const timeoutMs = Number(arg('timeout', 35000));
const settleMs = 3000;
const outDir = path.join(ROOT, 'bench/results/raw', runName);
fs.mkdirSync(outDir, { recursive: true });

const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench/corpus/corpus.json'), 'utf8')).sites.filter((s) => !category || s.category === category).slice(0, limit);
console.log(`run ${runName}: ${corpus.length} sites × ${configNames.join(',')}`);

const browsers = {};
for (const name of configNames) {
  const cfg = CONFIGS[name];
  const l = { ...cfg.launch };
  if (typeof l.profile === 'function') l.profile = l.profile();
  const { browser } = await launch(l);
  if (cfg.setup) await cfg.setup(browser);
  await new Promise((r) => setTimeout(r, cfg.warmupMs || 2000));
  browsers[name] = browser;
  console.log(`  ${name}: ${await browser.version()}`);
}
// warm-up page so first-navigation costs (extension index load etc.) are excluded
await Promise.all(configNames.map(async (n) => { const p = await browsers[n].newPage(); try { await p.goto('https://example.com/', { timeout: 20000 }); } catch {} await p.close(); }));

async function measure(name, site) {
  const browser = browsers[name];
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 });
  await cdp.send('Performance.enable');
  const requests = new Map();
  const rec = { site: site.domain, category: site.category, config: name, started: Date.now(), requests: [], errors: 0, consoleErrors: 0 };
  cdp.on('Network.requestWillBeSent', (e) => {
    if (!requests.has(e.requestId)) requests.set(e.requestId, { url: e.request.url, type: e.type, initiator: e.initiator?.url || e.documentURL || '', doc: e.documentURL || '', frame: e.frameId, fate: 'pending', status: 0, bytes: 0 });
    else requests.get(e.requestId).redirectTo = e.request.url;
  });
  cdp.on('Network.responseReceived', (e) => { const r = requests.get(e.requestId); if (r) { r.status = e.response.status; r.fromCache = e.response.fromDiskCache || e.response.fromServiceWorker; if (e.response.url.startsWith('chrome-extension://')) r.fate = 'redirected'; } });
  cdp.on('Network.loadingFinished', (e) => { const r = requests.get(e.requestId); if (r) { if (r.fate === 'pending') r.fate = 'loaded'; r.bytes = e.encodedDataLength; } });
  cdp.on('Network.loadingFailed', (e) => { const r = requests.get(e.requestId); if (r) { r.fate = e.blockedReason || e.errorText === 'net::ERR_BLOCKED_BY_CLIENT' ? 'blocked' : (e.canceled ? 'canceled' : 'failed'); r.error = e.errorText; } });
  page.on('pageerror', () => rec.errors++);
  page.on('console', (m) => { if (m.type() === 'error') rec.consoleErrors++; });
  const t0 = Date.now();
  try {
    // heavy pages can hold `load` open for a minute (long-polling); wait for DOMContentLoaded, then give `load` a bounded chance
    await page.goto(`https://${site.domain}/`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    rec.loadOk = true;
    try { await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000, polling: 250 }); rec.loadEvent = true; } catch { rec.loadEvent = false; }
  } catch (e) { rec.loadOk = false; rec.loadError = e.message.split('\n')[0]; }
  rec.wallMs = Date.now() - t0;
  await new Promise((r) => setTimeout(r, settleMs));
  try {
    rec.page = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const vids = [...document.querySelectorAll('video')];
      const text = document.body ? document.body.innerText : '';
      return {
        url: location.href, title: document.title, domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, responseStart: nav.responseStart, transfer: nav.transferSize,
        resources: performance.getEntriesByType('resource').length,
        textLength: text.length, scrollHeight: document.documentElement.scrollHeight, iframes: document.querySelectorAll('iframe').length,
        videos: vids.length, videosPlayable: vids.filter((v) => v.readyState >= 2).length, videosPlaying: vids.filter((v) => !v.paused && !v.ended && v.readyState > 2).length,
        images: document.images.length, brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).length,
        loginLink: !!document.querySelector('a[href*="login" i],a[href*="signin" i],a[href*="sign-in" i],button[class*="login" i]'),
        comments: !!document.querySelector('[id*="comment" i],[class*="comment" i]'),
        hasBody: !!document.body && document.body.children.length > 0,
      };
    });
  } catch (e) { rec.page = { error: e.message.split('\n')[0] }; }
  try {
    const m = await cdp.send('Performance.getMetrics');
    rec.metrics = Object.fromEntries(m.metrics.filter((x) => /TaskDuration|ScriptDuration|LayoutDuration|RecalcStyleDuration|JSHeapUsedSize|Nodes|Documents/.test(x.name)).map((x) => [x.name, x.value]));
  } catch {}
  try { await page.screenshot({ path: path.join(outDir, `${site.domain}.${name}.jpg`), type: 'jpeg', quality: 35, clip: { x: 0, y: 0, width: 1366, height: 900 } }); } catch {}
  if (name === 'veil') {
    try {
      const w = await extensionWorker(browser, 'background/sw.js', 3000);
      rec.veil = await w.evaluate((u) => globalThis.veilHandle({ type: 'benchStats', url: u }), rec.page?.url || `https://${site.domain}/`);
      rec.veilTiming = await w.evaluate(() => ({ ...globalThis.veilTiming }));
    } catch (e) { rec.veilError = e.message; }
  }
  rec.requests = [...requests.values()];
  await page.close().catch(() => {});
  return rec;
}

let i = 0, done = 0;
async function worker() {
  while (i < corpus.length) {
    const site = corpus[i++];
    const results = await Promise.all(configNames.map((n) => measure(n, site).catch((e) => ({ site: site.domain, category: site.category, config: n, fatal: e.message }))));
    for (const r of results) fs.writeFileSync(path.join(outDir, `${site.domain}.${r.config}.json`), JSON.stringify(r));
    done++;
    const brief = results.map((r) => `${r.config}:${r.loadOk ? (r.requests?.filter((q) => q.fate === 'blocked').length ?? '?') + 'b/' + (r.requests?.length ?? '?') : 'FAIL'}`).join(' ');
    console.log(`[${done}/${corpus.length}] ${site.domain} ${brief}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
for (const b of Object.values(browsers)) await b.close().catch(() => {});
fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify({ run: runName, configs: configNames, sites: corpus.length, category, finished: new Date().toISOString(), chrome: await Promise.resolve('see per-record'), labels: Object.fromEntries(configNames.map((n) => [n, CONFIGS[n].label])) }, null, 1));
console.log('done →', outDir);
