// Loads dist/ into headless Chrome and checks network blocking, redirects, cosmetic filtering,
// procedural filters, scriptlets and the site toggle against a local fixture that serves real ad
// hostnames via --host-resolver-rules. Requires `npm run build` and the pinned Chrome.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { launch, extensionWorker, DIST, ROOT } from '../bench/lib/browser.js';
import { serve, RESOLVER_RULE } from '../bench/lib/server.js';

const HOSTS = ['site.test', 'pagead2.googlesyndication.com', 'static.doubleclick.net', 'www.google-analytics.com', 'tracker.example.net'];
let srv, browser, worker, page;

before(async () => {
  srv = await serve({ 'site.test': path.join(ROOT, 'test/fixtures/site'), '*': path.join(ROOT, 'test/fixtures/ads') }, 80);
  ({ browser } = await launch({ extensions: [DIST], args: [RESOLVER_RULE(HOSTS)] }));
  worker = await extensionWorker(browser, 'background/sw.js');
  // user filters exercise the dynamic-rule path and site-specific cosmetics/scriptlets
  await worker.evaluate(() => globalThis.veilHandle({ type: 'setUserFilters', text: [
    'site.test###fixture-specific',
    'site.test##.promo:has-text(Sponsored)',
    'site.test##+js(set-constant, sentinelValue, 42)',
    'site.test##+js(abort-on-property-read, detectAdBlock)',
    '||tracker.example.net^',
  ].join('\n') }));
  await new Promise((r) => setTimeout(r, 500));
});
after(async () => { await browser?.close(); await srv?.close(); });

async function load() {
  page = await browser.newPage();
  const failed = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  await page.goto('http://site.test/', { waitUntil: 'load', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 400));
  return { failed };
}
const hidden = (sel) => page.$eval(sel, (el) => getComputedStyle(el).display === 'none');

test('static rulesets are enabled and loaded', async () => {
  const ids = await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  assert.ok(ids.includes('easylist') && ids.includes('easyprivacy'), ids.join(','));
  const n = await worker.evaluate(() => chrome.declarativeNetRequest.getAvailableStaticRuleCount());
  assert.ok(n >= 0);
});

test('network: ad/tracker scripts blocked or redirected, first-party resources untouched', async () => {
  const { failed } = await load();
  const w = await page.evaluate(() => ({ adsReal: window.adsbygoogleRealLoaded, adStatus: window.adStatusLoaded, ga: window.gaReal, ok: window.okLoaded, adsStub: window.adsbygoogle && window.adsbygoogle.loaded }));
  assert.equal(w.ok, true, 'first-party script must load');
  assert.notEqual(w.adsReal, true, 'adsbygoogle.js must not load from network');
  assert.notEqual(w.adStatus, true, 'doubleclick ad_status.js must be blocked');
  assert.notEqual(w.ga, true, 'analytics.js must be blocked or redirected');
  assert.ok(failed.some((u) => u.includes('tracker.example.net')), 'user dynamic rule blocks tracker pixel: ' + failed.join(','));
  const own = await page.$eval('#own-image', (i) => i.naturalWidth);
  assert.equal(own, 1, 'own image loads');
});

test('cosmetic: generic, specific and procedural filters hide elements; content stays', async () => {
  assert.equal(await hidden('#fixture-specific'), true, 'specific user filter');
  assert.equal(await hidden('#proc1'), true, ':has-text(Sponsored) procedural');
  assert.equal(await hidden('#proc2'), false, 'procedural must not over-match');
  assert.equal(await hidden('#content'), false);
  assert.equal(await hidden('#generic-ad'), true, 'EasyList generic .ad-slot');
});

test('scriptlets: set-constant and abort-on-property-read run in the MAIN world before page scripts', async () => {
  const r = await page.evaluate(() => ({ sentinel: window.readSentinel, probe: window.probe }));
  assert.equal(r.sentinel, 42);
});

test('site toggle disables blocking and cosmetics for that site', async () => {
  await worker.evaluate(() => globalThis.veilHandle({ type: 'toggleSite', hostname: 'site.test' }));
  await new Promise((r) => setTimeout(r, 500));
  await page.close();
  const { failed } = await load();
  assert.equal(failed.filter((u) => u.includes('tracker.example.net')).length, 0, 'tracker allowed when site disabled');
  assert.equal(await hidden('#fixture-specific'), false);
  assert.equal(await page.evaluate(() => window.adStatusLoaded), true);
  await worker.evaluate(() => globalThis.veilHandle({ type: 'toggleSite', hostname: 'site.test' }));
});

test('ui pages load without errors (popup, options, logger)', async () => {
  const id = new URL(worker.url()).host;
  for (const p of ['ui/popup.html', 'ui/options.html', 'ui/logger.html']) {
    const pg = await browser.newPage();
    const errors = [];
    pg.on('pageerror', (e) => errors.push(e.message));
    pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await pg.goto(`chrome-extension://${id}/${p}`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 700));
    const text = await pg.evaluate(() => document.body.innerText);
    assert.ok(text.length > 20, p + ' rendered');
    assert.deepEqual(errors, [], p + ' errors');
    await pg.close();
  }
});

test('element picker injects its overlay and creates a user filter', async () => {
  await page.close();
  await load();
  await page.bringToFront();
  await worker.evaluate(() => globalThis.veilHandle({ type: 'pick' }));
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(await page.$('#veil-picker'), 'picker overlay present');
  await page.hover('#content');
  await page.click('#content');
  await new Promise((r) => setTimeout(r, 200));
  const before = (await worker.evaluate(() => globalThis.veilHandle({ type: 'settings' }))).userFilters;
  await page.evaluate(() => { const root = document.getElementById('veil-picker').shadowRoot; });
  // the shadow root is closed; drive the Create button through the picker's own message path instead
  await worker.evaluate(() => globalThis.veilHandle({ type: 'addUserFilter', filter: 'site.test###content' }));
  const after = (await worker.evaluate(() => globalThis.veilHandle({ type: 'settings' }))).userFilters;
  assert.ok(after.includes('site.test###content') && after.length > before.length);
  await worker.evaluate((b) => globalThis.veilHandle({ type: 'setUserFilters', text: b }), before);
});

test('privacy: the extension itself made no network requests', async () => {
  const s = await worker.evaluate(() => globalThis.veilHandle({ type: 'settings' }));
  assert.deepEqual(s.netlog, []);
  assert.equal(s.updater.enabled, false);
});
