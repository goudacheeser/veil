// Opt-in filter-list updater. Flow: fetch the signed lists.lock.json from the configured base URL,
// verify its Ed25519 signature with the key bundled at build time, fetch each list, verify sha256
// against the lock, then compile only the lines the bundled index does not already know into
// dynamic DNR rules. Every request the extension makes is recorded and shown in the options page.
import { parseList } from '../engine/parser.js';
import { toDnrRule } from '../engine/dnr.js';
import { hash } from '../engine/tokens.js';
import { BinReader } from '../engine/binary.js';
import { SEC } from '../engine/constants.js';

const MAX_DYNAMIC = 30000, MAX_UNSAFE = 5000;

async function sha256Hex(buf) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function checkForUpdates(settings, build) {
  const netlog = [];
  const get = async (url) => {
    const t = Date.now();
    const res = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'follow' });
    const buf = await res.arrayBuffer();
    netlog.push({ t, url, status: res.status, bytes: buf.byteLength });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return buf;
  };
  if (!settings.updater?.enabled || !settings.updater.url) return { skipped: 'updater disabled', netlog };
  const base = settings.updater.url.replace(/\/?$/, '/');

  const keyInfo = await (await fetch(chrome.runtime.getURL('updater-key.json'))).json();
  const key = await crypto.subtle.importKey('spki', Uint8Array.from(atob(keyInfo.spki), (c) => c.charCodeAt(0)), { name: 'Ed25519' }, false, ['verify']);
  const lockBuf = await get(base + 'lists.lock.json');
  const sig = Uint8Array.from(atob(new TextDecoder().decode(await get(base + 'lists.lock.sig')).trim()), (c) => c.charCodeAt(0));
  if (!(await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, lockBuf))) throw new Error('lists.lock.json signature invalid');
  const lock = JSON.parse(new TextDecoder().decode(lockBuf));

  const known = new Map();
  for (const g of Object.keys(build.groups)) {
    const buf = await (await fetch(chrome.runtime.getURL(`index/${g}.network.bin`))).arrayBuffer();
    known.set(g, new BinReader(buf, SEC.STRINGS).u32(SEC.KNOWN_LINES));
  }
  const isKnown = (arr, h) => { let lo = 0, hi = arr.length - 1; while (lo <= hi) { const m = (lo + hi) >>> 1; if (arr[m] === h) return true; if (arr[m] < h) lo = m + 1; else hi = m - 1; } return false; };

  const newLines = [];
  const summary = [];
  for (const l of lock.lists) {
    if (!settings.groups[l.group]) continue;
    const buf = await get(l.url);
    const h = await sha256Hex(buf);
    if (h !== l.sha256) { summary.push(`${l.name}: hash mismatch, ignored`); continue; }
    const bundled = build.lists.find((x) => x.name === l.name);
    if (bundled && bundled.sha256 === h) { summary.push(`${l.name}: unchanged`); continue; }
    const text = new TextDecoder().decode(buf);
    let added = 0;
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t[0] === '!' || t[0] === '[') continue;
      if (!isKnown(known.get(l.group), hash(t))) { newLines.push(t); added++; }
    }
    summary.push(`${l.name}: ${added} new lines`);
  }
  const parsed = parseList(newLines.join('\n'), { name: 'update' });
  const rules = [];
  let unsafe = 0;
  for (const f of parsed.network) {
    const r = toDnrRule(f, 0);
    if (r.skip) continue;
    const isUnsafe = r.rule.action.type === 'redirect' || r.rule.action.type === 'modifyHeaders';
    if (isUnsafe && ++unsafe > MAX_UNSAFE) continue;
    rules.push(r.rule);
    if (rules.length >= MAX_DYNAMIC - 10000) break;
  }
  // cosmetic/scriptlet deltas are not applied at runtime (needs index rebuild); see docs/LIMITATIONS.md
  return { summary, newLines: newLines.length, rules, cosmeticDelta: parsed.cosmetic.length + parsed.scriptlets.length, netlog };
}

export async function applyUpdateRules(rules, baseId) {
  const existing = (await chrome.declarativeNetRequest.getDynamicRules()).filter((r) => r.id >= baseId).map((r) => r.id);
  rules.forEach((r, i) => { r.id = baseId + i; });
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing, addRules: rules });
}
