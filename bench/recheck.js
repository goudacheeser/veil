// Re-checks breakage candidates one browser at a time (no parallel loads, so no rate-limit walls).
//   node bench/recheck.js site1 site2 ...
import fs from 'node:fs';
import path from 'node:path';
import { launch, DIST, ROOT } from './lib/browser.js';

const out = path.join(ROOT, 'bench/results/recheck');
fs.mkdirSync(out, { recursive: true });
const results = {};
for (const site of process.argv.slice(2)) {
  results[site] = {};
  for (const [name, opts] of [['none', {}], ['veil', { extensions: [DIST] }]]) {
    const { browser } = await launch(opts);
    await new Promise((r) => setTimeout(r, 2500));
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
    let loadError = null;
    try { await page.goto(`https://${site}/`, { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch (e) { loadError = e.message.split('\n')[0]; }
    await new Promise((r) => setTimeout(r, 8000));
    const info = await page.evaluate(() => ({
      url: location.href, title: document.title, text: document.body ? document.body.innerText.length : 0,
      links: document.links.length, images: document.images.length,
      firstText: document.body ? document.body.innerText.trim().slice(0, 200).replace(/\s+/g, ' ') : '',
    })).catch((e) => ({ error: e.message }));
    await page.screenshot({ path: path.join(out, `${site}.${name}.jpg`), type: 'jpeg', quality: 50 }).catch(() => {});
    results[site][name] = { loadError, errors, ...info };
    console.log(site, name, JSON.stringify({ loadError, errors: errors.length, text: info.text, links: info.links, images: info.images, title: info.title }));
    await browser.close();
  }
}
fs.writeFileSync(path.join(out, 'recheck.json'), JSON.stringify(results, null, 1));
