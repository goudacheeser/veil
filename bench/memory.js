// Memory and CPU footprint at 10 / 50 / 200 open tabs. All tabs load the same local page (so page
// content is identical across configurations) and we sample the working set and CPU time of every
// process belonging to the browser instance, split into the extension process and the rest.
//   node bench/memory.js --configs=none,veil,ubol,adguard,ghostery --tabs=10,50,200
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, ROOT } from './lib/browser.js';
import { serve } from './lib/server.js';
import { CONFIGS } from './configs.js';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const configNames = arg('configs', 'none,veil,ubol,adguard,ghostery').split(',').filter((c) => CONFIGS[c] && CONFIGS[c].available !== false);
const tabCounts = arg('tabs', '10,50,200').split(',').map(Number);

// a page with enough DOM (ids, classes, mutations) to exercise cosmetic filtering
const pageDir = fs.mkdtempSync(path.join(ROOT, 'bench/.profiles/mem-'));
fs.writeFileSync(path.join(pageDir, 'index.html'), `<!doctype html><html><head><title>mem</title></head><body>
<div id="app"></div><script>
const app=document.getElementById('app');const cls=['header','nav','content','sidebar','ad-slot','promo','banner','card','row','col','widget','sponsored','footer'];
for(let i=0;i<1500;i++){const d=document.createElement('div');d.id='n'+i;d.className=cls[i%cls.length]+' x'+(i%97);d.textContent='node '+i;app.appendChild(d);}
let k=0;setInterval(()=>{const d=document.createElement('span');d.className='dyn'+(k++%50);d.textContent='.';app.appendChild(d);if(k>400)app.firstChild.remove();},250);
</script></body></html>`);
const srv = await serve({ '*': pageDir }, 8089);

function processes(userDataDir) {
  const ps = execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${userDataDir.replace(/\\/g, '\\\\').replace(/'/g, "''")}*' } | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p) { [pscustomobject]@{ pid=$_.ProcessId; ws=$p.WorkingSet64; pws=$p.PrivateMemorySize64; cpu=$p.TotalProcessorTime.TotalMilliseconds; cmd=$_.CommandLine } } } | ConvertTo-Json -Compress`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const arr = ps.trim() ? JSON.parse(ps) : [];
  return Array.isArray(arr) ? arr : [arr];
}
function summarize(list) {
  const ext = list.filter((p) => /--extension-process/.test(p.cmd));
  const sum = (l, k) => l.reduce((n, p) => n + (p[k] || 0), 0);
  return { processes: list.length, totalPrivateMB: +(sum(list, 'pws') / 1048576).toFixed(0), totalWorkingSetMB: +(sum(list, 'ws') / 1048576).toFixed(0), extensionProcessPrivateMB: +(sum(ext, 'pws') / 1048576).toFixed(0), extensionProcessCpuMs: +sum(ext, 'cpu').toFixed(0), totalCpuMs: +sum(list, 'cpu').toFixed(0) };
}

const results = {};
for (const name of configNames) {
  const cfg = CONFIGS[name];
  const l = { ...cfg.launch };
  if (typeof l.profile === 'function') l.profile = l.profile();
  const { browser, userDataDir } = await launch(l);
  if (cfg.setup) await cfg.setup(browser);
  await new Promise((r) => setTimeout(r, cfg.warmupMs || 3000));
  results[name] = { idle: summarize(processes(userDataDir)) };
  let open = 0;
  for (const n of tabCounts) {
    while (open < n) {
      const batch = Math.min(10, n - open);
      await Promise.all(Array.from({ length: batch }, async (_, i) => { const p = await browser.newPage(); try { await p.goto(`http://127.0.0.1:8089/?t=${open + i}`, { waitUntil: 'load', timeout: 30000 }); } catch {} }));
      open += batch;
    }
    await new Promise((r) => setTimeout(r, 8000));
    results[name][`tabs${n}`] = summarize(processes(userDataDir));
    console.log(name, n, JSON.stringify(results[name][`tabs${n}`]));
  }
  await browser.close().catch(() => {});
}
await srv.close();
fs.writeFileSync(path.join(ROOT, 'bench/results/memory.json'), JSON.stringify({ tabCounts, results, note: 'same local page in every tab; all tabs share one renderer per site so content-script memory lands in that renderer; extension process = service worker + extension pages' }, null, 1));
const cols = ['idle', ...tabCounts.map((n) => `tabs${n}`)];
console.log('\n| config | ' + cols.map((c) => `${c} total private MB (ext process MB)`).join(' | ') + ' |\n|---|' + cols.map(() => '---').join('|') + '|');
for (const c of configNames) console.log(`| ${c} | ` + cols.map((k) => `${results[c][k].totalPrivateMB} (${results[c][k].extensionProcessPrivateMB})`).join(' | ') + ' |');
