// Renders the comparison charts in docs/charts/*.svg from the scored benchmark results.
// Static SVG (GitHub shows README images without scripts), light and dark via prefers-color-scheme.
//   node bench/charts.js
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/browser.js';

const res = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'bench/results', f), 'utf8'));
const A = res('batchA-chrome.json').perConfig, B = res('batchB-brave.json').perConfig, C = res('batchC-chrome126.json').perConfig;
const mem = res('memory.json').results;
const out = path.join(ROOT, 'docs/charts');
fs.mkdirSync(out, { recursive: true });

// one entry per blocker: [label, batch note, perConfig record, baseline record]
const BLOCKERS = [
  ['Veil', '', A.veil, A.none],
  ['uBlock Origin Lite', '', A.ubol, A.none],
  ['Ghostery', '', A.ghostery, A.none],
  ['AdGuard MV3', '', A.adguard, A.none],
  ['uBlock Origin (MV2)', 'Chrome 126 batch', C.ubo, C.none126],
  ['Brave Shields', 'Brave batch', B.brave, B['brave-none']],
];

const W = 720, LABEL_W = 210, VALUE_W = 70, ROW = 34, BAR_H = 20, TOP = 78, BOTTOM = 40;

function chart({ file, title, subtitle, rows, format, note }) {
  // rows: [{ label, sub, value, highlight }], already in display order
  const max = Math.max(...rows.map((r) => r.value));
  const plotW = W - LABEL_W - VALUE_W - 24;
  const H = TOP + rows.length * ROW + BOTTOM;
  const x0 = LABEL_W;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const bars = rows.map((r, i) => {
    const y = TOP + i * ROW + (ROW - BAR_H) / 2;
    const w = Math.max(2, (r.value / max) * plotW);
    const rad = Math.min(4, w);
    // square at the baseline, 4px rounded data-end
    const d = `M${x0},${y}h${w - rad}a${rad},${rad} 0 0 1 ${rad},${rad}v${BAR_H - 2 * rad}a${rad},${rad} 0 0 1 -${rad},${rad}h-${w - rad}z`;
    const cy = y + BAR_H / 2;
    const label = r.sub
      ? `<text class="lbl${r.highlight ? ' hi' : ''}" x="${x0 - 12}" y="${cy - 4}" text-anchor="end">${esc(r.label)}</text><text class="sub" x="${x0 - 12}" y="${cy + 12}" text-anchor="end">${esc(r.sub)}</text>`
      : `<text class="lbl${r.highlight ? ' hi' : ''}" x="${x0 - 12}" y="${cy + 4}" text-anchor="end">${esc(r.label)}</text>`;
    return `<g><title>${esc(r.label)}${r.sub ? ` (${esc(r.sub)})` : ''}: ${esc(format(r.value))}</title>${label}<path class="${r.highlight ? 'bar-hi' : 'bar'}" d="${d}"/><text class="val${r.highlight ? ' hi' : ''}" x="${x0 + w + 8}" y="${cy + 4}">${esc(format(r.value))}</text></g>`;
  }).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
<title id="t">${esc(title)}</title>
<desc id="d">${esc(subtitle)}. ${rows.map((r) => `${r.label}${r.sub ? ` (${r.sub})` : ''}: ${format(r.value)}`).join('; ')}.</desc>
<style>
  .surface { fill: #fcfcfb; }
  .title { fill: #0b0b0b; font-size: 17px; font-weight: 600; }
  .subtitle, .note { fill: #52514e; font-size: 12.5px; }
  .lbl { fill: #52514e; font-size: 13px; }
  .lbl.hi, .val.hi { fill: #0b0b0b; font-weight: 600; }
  .sub { fill: #898781; font-size: 11px; }
  .val { fill: #52514e; font-size: 13px; font-variant-numeric: tabular-nums; }
  .bar { fill: #c3c2b7; }
  .bar-hi { fill: #2a78d6; }
  .axis { stroke: #c3c2b7; stroke-width: 1; }
  @media (prefers-color-scheme: dark) {
    .surface { fill: #1a1a19; }
    .title, .lbl.hi, .val.hi { fill: #f0efec; }
    .subtitle, .note, .lbl, .val { fill: #c3c2b7; }
    .bar { fill: #5c5b57; }
    .bar-hi { fill: #3987e5; }
    .axis { stroke: #383835; }
  }
</style>
<rect class="surface" width="${W}" height="${H}" rx="8"/>
<text class="title" x="20" y="32">${esc(title)}</text>
<text class="subtitle" x="20" y="54">${esc(subtitle)}</text>
<line class="axis" x1="${x0}" x2="${x0}" y1="${TOP - 4}" y2="${TOP + rows.length * ROW + 4}"/>
${bars}
<text class="note" x="20" y="${H - 14}">${esc(note)}</text>
</svg>
`;
  fs.writeFileSync(path.join(out, file), svg);
  return file;
}

const rows = (fn, order) => {
  const r = BLOCKERS.map(([label, sub, p, base]) => ({ label, sub, value: fn(p, base, label), highlight: label === 'Veil' }));
  return r.sort((a, b) => (order === 'desc' ? b.value - a.value : a.value - b.value));
};
const pct1 = (v) => `${v.toFixed(1)}%`;
const SRC = 'Source: bench/results, 500-site corpus, paired loads. Batches differ in browser; see docs/RESULTS.md.';

const files = [
  chart({ file: 'coverage.svg', title: 'Blocking coverage', subtitle: 'Share of ad and tracker requests blocked (higher is better)', rows: rows((p) => (100 * p.blocked) / p.adRequests, 'desc'), format: pct1, note: SRC }),
  chart({ file: 'trackers-let-through.svg', title: 'Third-party trackers let through', subtitle: 'Ad/tracker requests to other domains that loaded anyway, all sites (fewer is better)', rows: rows((p) => p.falseNegTP, 'asc'), format: (v) => v.toLocaleString('en-US'), note: SRC }),
  chart({ file: 'breakage.svg', title: 'Breakage candidates', subtitle: 'Sites flagged by the breakage heuristic, % of paired sites (fewer is better; heuristic flags, reviewed in BREAKAGE_REVIEW)', rows: rows((p) => (100 * p.breakage.length) / p.sites, 'asc'), format: pct1, note: SRC }),
  chart({ file: 'load-speedup.svg', title: 'Page load speed-up', subtitle: 'Median loadEventEnd, % faster than the same batch with no blocker (higher is better)', rows: rows((p, base) => (100 * (base.loadMedian - p.loadMedian)) / base.loadMedian, 'desc'), format: pct1, note: SRC }),
];

// memory: Chrome 157 batch only (uBO MV2 and Brave were not part of the memory run)
const memRows = [['Veil', 'veil'], ['uBlock Origin Lite', 'ubol'], ['AdGuard MV3', 'adguard'], ['Ghostery', 'ghostery']]
  .map(([label, k]) => ({ label, sub: '', value: mem[k].tabs200.totalPrivateMB - mem.none.tabs200.totalPrivateMB, highlight: label === 'Veil' }))
  .sort((a, b) => a.value - b.value);
files.push(chart({ file: 'memory-200-tabs.svg', title: 'Memory overhead at 200 tabs', subtitle: 'Extra private memory over Chrome with no blocker, same page in every tab (lower is better)', rows: memRows, format: (v) => `${v.toLocaleString('en-US')} MB`, note: 'Source: bench/results/memory.json. Chrome 157; uBO (MV2) and Brave were not in the memory run.' }));

console.log(files.join('\n'));
