// Service worker. Kept stateless: everything it needs is either in chrome.storage or in the bundled
// binary indexes, which are re-opened (not re-parsed) on each wake-up.
import { BinReader } from '../engine/binary.js';
import { SEC, TYPE, CHROME_TYPE, SITE } from '../engine/constants.js';
import { CosmeticIndex } from '../engine/cosmetic-index.js';
import { NetworkMatcher } from '../engine/matcher.js';
import { Psl } from '../engine/psl.js';
import { hostnameOf, entityOf, isThirdParty } from '../engine/url.js';
import { parseList } from '../engine/parser.js';
import { toDnrRule } from '../engine/dnr.js';
import { SCRIPTLETS, helpers } from '../content/scriptlets.js';
import { checkForUpdates, applyUpdateRules } from './updater.js';

const ID = { USER: 1, USER_MAX: 9999, SITE: 10000, SITE_MAX: 19999, UPDATE: 20000 };
const DEFAULTS = { groups: null, disabledSites: [], userFilters: '', logger: false, updater: { enabled: false, url: '' }, netlog: [] };

let build, settings, indexes = new Map(), userRules = null;
const timing = { rehydrateMs: 0, lookups: 0, lookupMs: 0 };

async function loadBuild() {
  if (!build) build = await (await fetch(chrome.runtime.getURL('build.json'))).json();
  return build;
}
async function loadSettings() {
  if (settings) return settings;
  const stored = await chrome.storage.local.get(null);
  settings = { ...DEFAULTS, ...stored };
  if (!settings.groups) { const b = await loadBuild(); settings.groups = Object.fromEntries(Object.entries(b.groups).map(([g, v]) => [g, v.enabled])); }
  return settings;
}
async function saveSettings(patch) { Object.assign(settings, patch); await chrome.storage.local.set(patch); }

// ---- index rehydration (zero-parse: wrap the ArrayBuffer and go) ----
async function index(group, kind) {
  const key = `${group}.${kind}`;
  let p = indexes.get(key);
  if (!p) {
    p = (async () => {
      const t = performance.now();
      const buf = await (await fetch(chrome.runtime.getURL(`index/${key}.bin`))).arrayBuffer();
      const r = new BinReader(buf, SEC.STRINGS);
      const out = kind === 'cosmetic' ? { reader: r, cosmetic: new CosmeticIndex(r), psl: new Psl(r) } : { reader: r, matcher: new NetworkMatcher(r), psl: new Psl(r) };
      timing.rehydrateMs += performance.now() - t;
      return out;
    })();
    indexes.set(key, p);
  }
  return p;
}
async function enabledGroups() { const s = await loadSettings(); return Object.keys(s.groups).filter((g) => s.groups[g]); }

function siteDisabled(hostname) {
  return settings.disabledSites.some((d) => hostname === d || hostname.endsWith('.' + d));
}

// ---- cosmetic lookups for content scripts ----
async function cosmeticFor(hostname) {
  const t = performance.now();
  await loadSettings();
  if (siteDisabled(hostname)) return { disabled: true };
  const res = { hide: [], procedural: [], exceptions: [], flags: 0 };
  for (const g of await enabledGroups()) {
    const { cosmetic, psl } = await index(g, 'cosmetic');
    const entity = entityOf(hostname, psl);
    res.flags |= cosmetic.siteFlags(hostname, entity);
    const s = cosmetic.specificFor(hostname, entity);
    res.hide.push(...s.hide); res.procedural.push(...s.procedural); res.exceptions.push(...s.exceptions);
  }
  const u = await userCosmetic(hostname);
  res.hide.push(...u.hide); res.procedural.push(...u.procedural);
  if (res.flags & SITE.NO_COSMETIC) return { disabled: true };
  if (res.flags & SITE.NO_SPECIFIC) { res.hide = u.hide; res.procedural = u.procedural; }
  res.noGeneric = !!(res.flags & SITE.NO_GENERIC);
  if (settings.benchmark) res.bench = true;
  timing.lookups++; timing.lookupMs += performance.now() - t;
  return res;
}
async function genericFor(hostname, ids, classes, exceptions) {
  const out = [];
  const exc = new Set(exceptions);
  for (const g of await enabledGroups()) {
    const { cosmetic } = await index(g, 'cosmetic');
    out.push(...cosmetic.generic(ids, classes, exc));
  }
  return out;
}

// ---- user filters: parsed on demand, network part -> dynamic DNR rules ----
async function userParsed() {
  await loadSettings();
  if (!userRules || userRules.src !== settings.userFilters) userRules = { src: settings.userFilters, ...parseList(settings.userFilters, { name: 'user' }) };
  return userRules;
}
async function userCosmetic(hostname) {
  const u = await userParsed();
  const hide = [], procedural = [];
  const applies = (d) => d.include.some((x) => hostname === x || hostname.endsWith('.' + x)) && !d.exclude.some((x) => hostname === x || hostname.endsWith('.' + x));
  for (const c of u.cosmetic) {
    if (c.exception) continue;
    if (c.generic ? c.domains.exclude.every((x) => hostname !== x && !hostname.endsWith('.' + x)) : applies(c.domains)) (c.ops ? procedural : hide).push(c.ops ? { css: c.selector, ops: c.ops } : c.selector);
  }
  return { hide, procedural };
}
async function syncDynamicRules() {
  const u = await userParsed();
  const rules = [];
  const errors = [];
  for (const f of u.network) {
    const r = toDnrRule(f, ID.USER + rules.length);
    if (r.skip) { errors.push(`${f.raw}: ${r.skip}`); continue; }
    rules.push(r.rule); if (r.extra) rules.push({ ...r.extra, id: ID.USER + rules.length });
    if (rules.length >= ID.USER_MAX) { errors.push('too many user network filters'); break; }
  }
  for (const x of u.unsupported) errors.push(`${x.line}: ${x.reason}`);
  // site toggles: let everything through for disabled sites
  settings.disabledSites.forEach((site, i) => {
    const id = ID.SITE + i * 2;
    rules.push({ id, priority: 1000, action: { type: 'allowAllRequests' }, condition: { requestDomains: [site], resourceTypes: ['main_frame', 'sub_frame'] } });
    rules.push({ id: id + 1, priority: 1000, action: { type: 'allow' }, condition: { initiatorDomains: [site] } });
  });
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const remove = existing.filter((r) => r.id < ID.UPDATE).map((r) => r.id);
  try { await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: remove, addRules: rules }); }
  catch (e) { errors.push(`dynamic rules rejected: ${e.message}`); await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: remove, addRules: [] }); }
  await chrome.storage.local.set({ userFilterErrors: errors });
  return errors;
}

// ---- static rulesets + registered scriptlet/css content scripts follow the group settings ----
async function syncRulesets() {
  const b = await loadBuild(), s = await loadSettings();
  const enable = [], disable = [];
  for (const r of b.rulesets) (s.groups[r.group] ? enable : disable).push(r.id);
  await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: enable, disableRulesetIds: disable });
}
const hostPatterns = (hosts) => hosts.map((h) => `*://*.${h}/*`);
async function syncContentScripts() {
  const b = await loadBuild(), s = await loadSettings();
  const existing = (await chrome.scripting.getRegisteredContentScripts()).map((x) => x.id);
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing });
  const exclude = hostPatterns(s.disabledSites);
  const scripts = [];
  for (const g of Object.keys(s.groups)) {
    if (!s.groups[g]) continue;
    for (const sl of b.scriptlets[g] || []) {
      scripts.push({ id: sl.id, js: [sl.file], matches: hostPatterns(sl.hosts), excludeMatches: exclude.length ? exclude : undefined, runAt: 'document_start', world: 'MAIN', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: true });
    }
    scripts.push({ id: `${g}.generic-css`, css: [`index/${g}.generic.css`], matches: ['http://*/*', 'https://*/*'], excludeMatches: [...exclude, ...hostPatterns(b.noGenericHosts)], runAt: 'document_start', allFrames: true, persistAcrossSessions: true });
  }
  // Chrome rejects the whole batch on one bad pattern, so register in chunks and drop offenders
  for (let i = 0; i < scripts.length; i += 50) {
    const chunk = scripts.slice(i, i + 50);
    try { await chrome.scripting.registerContentScripts(chunk); }
    catch (e) { for (const sc of chunk) { try { await chrome.scripting.registerContentScripts([sc]); } catch (err) { console.warn('register failed', sc.id, err.message); } } }
  }
}

// ---- runtime scriptlets (user filters, list updates) injected at navigation commit ----
const helpersSrc = `(${helpers.toString()})()`;
function runScriptlets(list) {
  // runs in the page's MAIN world; `list` = [[name, implSource, ...args]]
  const H = (0, eval)(arguments[1]);
  for (const [name, src, ...args] of list) { try { (0, eval)(`(${src})`)(H, ...args); } catch (e) {} }
}
async function injectRuntimeScriptlets(details) {
  const u = await userParsed();
  const hostname = hostnameOf(details.url);
  if (!hostname || siteDisabled(hostname)) return;
  const list = [];
  for (const s of u.scriptlets) {
    if (s.exception || !SCRIPTLETS[s.name]) continue;
    if (s.domains.include.some((d) => hostname === d || hostname.endsWith('.' + d))) list.push([s.name, SCRIPTLETS[s.name].toString(), ...s.args]);
  }
  if (!list.length) return;
  try { await chrome.scripting.executeScript({ target: { tabId: details.tabId, frameIds: [details.frameId] }, world: 'MAIN', injectImmediately: true, func: runScriptlets, args: [list, helpersSrc] }); } catch {}
}
chrome.webNavigation.onCommitted.addListener((d) => { if (/^https?:/.test(d.url)) injectRuntimeScriptlets(d); });

// ---- logger (webRequest observation only while the logger page is open) ----
const log = new Map(); // tabId -> entries
const benchStats = new Map(); // url -> content-script stats, only when storage.benchmark is set
let loggerOn = false;
async function classify(details) {
  const url = details.url, hostname = hostnameOf(url);
  const src = details.initiator || details.documentUrl || '';
  const srcHost = hostnameOf(src) || hostname;
  const type = CHROME_TYPE[details.type] || TYPE.other;
  const groups = await enabledGroups();
  let result = { action: 'none' };
  for (const g of groups) {
    const { matcher, psl } = await index(g, 'network');
    const ctx = { url: url.toLowerCase(), urlRaw: url, hostname, entity: entityOf(hostname, psl), type, srcHostname: srcHost, srcEntity: entityOf(srcHost, psl), thirdParty: isThirdParty(hostname, srcHost, psl) };
    const t = performance.now();
    const r = matcher.match(ctx);
    timing.matchMs = (timing.matchMs || 0) + performance.now() - t; timing.matches = (timing.matches || 0) + 1;
    if (r.action === 'block' && r.important) { result = r; break; }
    if (r.action === 'block' && result.action !== 'allow') result = r;
    if (r.action === 'allow') result = r;
  }
  return result;
}
function onRequest(details) {
  if (details.tabId < 0) return;
  const entry = { id: details.requestId, t: Date.now(), url: details.url, type: details.type, initiator: details.initiator || '', status: 'observed', match: null };
  if (!log.has(details.tabId)) log.set(details.tabId, []);
  const arr = log.get(details.tabId);
  arr.push(entry); if (arr.length > 2000) arr.splice(0, arr.length - 2000);
  classify(details).then((r) => { entry.match = r; });
}
function onError(details) {
  const arr = log.get(details.tabId);
  const e = arr && arr.find((x) => x.id === details.requestId);
  if (e) e.status = details.error === 'net::ERR_BLOCKED_BY_CLIENT' ? 'blocked' : `error:${details.error}`;
}
function onCompleted(details) { const arr = log.get(details.tabId); const e = arr && arr.find((x) => x.id === details.requestId); if (e) e.status = details.statusCode === 307 && details.redirectUrl?.startsWith('chrome-extension:') ? 'redirected' : 'allowed'; }
function setLogger(on) {
  if (on === loggerOn) return;
  loggerOn = on;
  const filter = { urls: ['<all_urls>'] };
  if (on) { chrome.webRequest.onBeforeRequest.addListener(onRequest, filter); chrome.webRequest.onErrorOccurred.addListener(onError, filter); chrome.webRequest.onCompleted.addListener(onCompleted, filter); }
  else { chrome.webRequest.onBeforeRequest.removeListener(onRequest); chrome.webRequest.onErrorOccurred.removeListener(onError); chrome.webRequest.onCompleted.removeListener(onCompleted); }
}
if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    const arr = log.get(info.request.tabId);
    const e = arr && arr.find((x) => x.id === info.request.requestId);
    if (e) e.dnr = `${info.rule.rulesetId}#${info.rule.ruleId}`;
  });
}

// ---- messaging ----
async function handle(msg) {
    switch (msg.type) {
      case 'cosmetic': return cosmeticFor(msg.hostname);
      case 'generic': return genericFor(msg.hostname, msg.ids, msg.classes, msg.exceptions);
      case 'settings': return { ...(await loadSettings()), build: await loadBuild(), timing, errors: (await chrome.storage.local.get('userFilterErrors')).userFilterErrors || [] };
      case 'setGroups': await saveSettings({ groups: msg.groups }); await syncRulesets(); await syncContentScripts(); indexes.clear(); return true;
      case 'setUserFilters': await saveSettings({ userFilters: msg.text }); userRules = null; return syncDynamicRules();
      case 'addUserFilter': { await loadSettings(); const text = settings.userFilters.trimEnd() + (settings.userFilters.trim() ? '\n' : '') + msg.filter + '\n'; await saveSettings({ userFilters: text }); userRules = null; return syncDynamicRules(); }
      case 'toggleSite': {
        await loadSettings();
        const set = new Set(settings.disabledSites);
        set.has(msg.hostname) ? set.delete(msg.hostname) : set.add(msg.hostname);
        await saveSettings({ disabledSites: [...set] });
        await syncDynamicRules(); await syncContentScripts();
        return !set.has(msg.hostname);
      }
      case 'bench': await loadSettings(); settings.benchmark = !!msg.on; return true;
      case 'benchReport': benchStats.set(msg.url, msg.stats); return true;
      case 'benchStats': return benchStats.get(msg.url) || [...benchStats.entries()].find(([k]) => k.startsWith(msg.url.replace(/[/]$/, '')))?.[1] || null;
      case 'siteState': { await loadSettings(); return { enabled: !siteDisabled(msg.hostname) }; }
      case 'logger': setLogger(msg.on); await saveSettings({ logger: msg.on }); return true;
      case 'getLog': return log.get(msg.tabId) || [];
      case 'clearLog': log.delete(msg.tabId); return true;
      case 'pick': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/picker.js'] });
        return true;
      }
      case 'checkUpdates': { await loadSettings(); const res = await checkForUpdates(settings, build || await loadBuild()); if (res.rules) await applyUpdateRules(res.rules, ID.UPDATE); await saveSettings({ netlog: [...settings.netlog.slice(-50), ...res.netlog] }); return res; }
      case 'setUpdater': await saveSettings({ updater: msg.updater }); return true;
      default: return null;
    }
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => { handle(msg).then(reply, (e) => reply({ error: e.message })); return true; });
// test/benchmark hook: lets a CDP session drive the worker without the messaging layer
globalThis.veilHandle = handle;
globalThis.veilTiming = timing;

chrome.runtime.onInstalled.addListener(async () => { await loadSettings(); await syncRulesets(); await syncContentScripts(); await syncDynamicRules(); });
chrome.runtime.onStartup.addListener(async () => { await loadSettings(); if (settings.logger) setLogger(true); });
chrome.tabs.onRemoved.addListener((id) => log.delete(id));
loadSettings().then(() => { if (settings.logger) setLogger(true); });
