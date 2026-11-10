// Shared Chrome launcher for integration tests and the benchmark harness.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const DIST = path.join(ROOT, 'dist');

export function chromePath(major) {
  const base = path.join(ROOT, 'bench/.browsers/chrome');
  if (!fs.existsSync(base)) throw new Error('run: npx @puppeteer/browsers install chrome@stable --path bench/.browsers');
  const vers = fs.readdirSync(base).filter((v) => !major || v.startsWith(`win64-${major}.`)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!vers.length) throw new Error(`Chrome ${major} not installed under bench/.browsers`);
  return path.join(base, vers.at(-1), 'chrome-win64/chrome.exe');
}
export const hasChrome = (major) => { try { return fs.existsSync(chromePath(major)); } catch { return false; } };
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
export const BRAVE = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';

export async function launch({ extensions = [], executable = chromePath(), headless = true, profile, args = [], allowComponents = false } = {}) {
  if (typeof profile === 'function') profile = profile();
  if (typeof executable === 'function') executable = executable();
  const userDataDir = profile || fs.mkdtempSync(path.join(ROOT, 'bench/.profiles/p-'));
  fs.mkdirSync(path.dirname(userDataDir), { recursive: true });
  const extArgs = extensions.length ? [`--disable-extensions-except=${extensions.join(',')}`, `--load-extension=${extensions.join(',')}`] : [];
  const browser = await puppeteer.launch({
    executablePath: executable,
    headless: headless ? 'new' : false,
    userDataDir,
    pipe: false,
    ignoreDefaultArgs: ['--disable-extensions', '--enable-automation'],
    // a normal UA: the default 'HeadlessChrome' token trips bot walls on many news sites
    args: [`--user-agent=${UA}`, '--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check', ...(allowComponents ? [] : ['--disable-background-networking', '--disable-component-update']), '--disable-sync', '--disable-features=Translate,OptimizationHints,MediaRouter,InterestFeedContentSuggestions', '--window-size=1366,900', ...extArgs, ...args],
    protocolTimeout: 120000,
  });
  return { browser, userDataDir };
}

// Wait for an extension's service worker and return a handle to evaluate code in it.
export async function extensionWorker(browser, nameMatch, timeout = 20000) {
  const t = Date.now();
  while (Date.now() - t < timeout) {
    const sw = browser.targets().find((x) => x.type() === 'service_worker' && (!nameMatch || x.url().includes(nameMatch)));
    if (sw) {
      const w = await sw.worker();
      // module evaluation may still be in flight when the target appears
      for (let i = 0; i < 50 && nameMatch?.includes('sw.js'); i++) { if (await w.evaluate(() => typeof globalThis.veilHandle === 'function').catch(() => false)) break; await new Promise((r) => setTimeout(r, 200)); }
      return w;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('extension service worker not found');
}
