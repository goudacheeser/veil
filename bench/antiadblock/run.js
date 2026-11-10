// Runs the detector suite page against each blocker configuration and reports which detectors
// fired. "detected" means the page would show an anti-adblock wall.
//   node bench/antiadblock/run.js [--configs none,veil,ubol,adguard,ghostery]
import fs from 'node:fs';
import path from 'node:path';
import { launch, extensionWorker, DIST, ROOT } from '../lib/browser.js';
import { serve, RESOLVER_RULE } from '../lib/server.js';
import { CONFIGS } from '../configs.js';

const HOSTS = ['adtest.test', 'pagead2.googlesyndication.com'];
const want = (process.argv.find((a) => a.startsWith('--configs=')) || '--configs=none,veil,ubol,adguard,ghostery').slice(10).split(',');
fs.writeFileSync(path.join(ROOT, 'bench/antiadblock/pages/blockadblock.js'), '/* stands in for the real BlockAdBlock CDN script */ window.blockAdBlock = { __real: true, onDetected(){return this}, onNotDetected(){return this}, check(){return true}, setOption(){return this} };');

const srv = await serve({ 'adtest.test': path.join(ROOT, 'bench/antiadblock/pages'), '*': path.join(ROOT, 'bench/antiadblock/ads') }, 80);
const out = {};
for (const name of want) {
  const cfg = CONFIGS[name];
  const { browser } = await launch({ ...cfg.launch, args: [...(cfg.launch.args || []), RESOLVER_RULE(HOSTS)] });
  try {
    if (cfg.setup) await cfg.setup(browser);
    await new Promise((r) => setTimeout(r, cfg.warmupMs || 1500));
    const page = await browser.newPage();
    await page.goto('http://adtest.test/', { waitUntil: 'load', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1500));
    out[name] = await page.evaluate(() => window.__results);
  } catch (e) { out[name] = { error: e.message }; }
  await browser.close();
  console.log(name, JSON.stringify(out[name]));
}
await srv.close();
fs.mkdirSync(path.join(ROOT, 'bench/results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'bench/results/antiadblock.json'), JSON.stringify(out, null, 1));
const names = [...new Set(Object.values(out).flatMap((r) => Object.keys(r)))];
console.log('\n| detector | ' + want.join(' | ') + ' |\n|---|' + want.map(() => '---').join('|') + '|');
for (const d of names) console.log(`| ${d} | ${want.map((c) => (out[c][d] === undefined ? '?' : d.startsWith('_') ? (out[c][d] ? 'loaded' : 'stopped') : out[c][d] ? 'DETECTED' : 'passed')).join(' | ')} |`);
console.log('\nDETECTED = the page would show an anti-adblock wall. Rows starting with _bait show whether the bait resource reached the network (loaded = not blocked).');
