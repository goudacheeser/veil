// Blocker configurations compared by the harness. Each config is a browser + extension set.
import fs from 'node:fs';
import path from 'node:path';
import { chromePath, hasChrome, BRAVE, DIST, ROOT, extensionWorker } from './lib/browser.js';

// Chrome 126 is the last version that runs MV2 extensions unconditionally (127+ disable them and the
// command-line/policy escape hatches no longer work by 138), so it hosts uBlock Origin (MV2) with its
// own no-blocker baseline to keep the pair comparable.
const MV2_FLAGS = [];

const comp = (n) => path.join(ROOT, 'bench/competitors', n);
const have = (p) => fs.existsSync(path.join(p, 'manifest.json'));

// Brave: shields are a browser feature, not an extension. A Preferences file written before first
// launch turns them off so Brave can host uBO (MV2, which Brave still supports) as a clean control.
function braveProfile(shields) {
  const dir = fs.mkdtempSync(path.join(ROOT, 'bench/.profiles/brave-'));
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  const prefs = { brave: { shields: { advanced_view_enabled: false } }, profile: { default_content_setting_values: shields ? {} : { braveShields: 2 } } };
  fs.writeFileSync(path.join(dir, 'Default/Preferences'), JSON.stringify(prefs));
  fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify({ brave: { p3a: { enabled: false } } }));
  return dir;
}

export const CONFIGS = {
  none: { label: 'No blocker (Chrome)', launch: {} },
  veil: {
    label: 'Veil', launch: { extensions: [DIST] },
    setup: async (browser) => {
      const w = await extensionWorker(browser, 'background/sw.js');
      await w.evaluate(() => chrome.storage.local.set({ benchmark: true }));
    },
  },
  ubol: { label: 'uBlock Origin Lite (default "Basic" mode)', launch: { extensions: [comp('ubol')] }, available: have(comp('ubol')) },
  adguard: { label: 'AdGuard MV3', launch: { extensions: [comp('adguard')] }, available: have(comp('adguard')), warmupMs: 8000 },
  ghostery: { label: 'Ghostery', launch: { extensions: [comp('ghostery')] }, available: have(comp('ghostery')), warmupMs: 6000 },
  ubo: { label: 'uBlock Origin 1.76 (MV2, hosted in Chrome 126)', launch: { executable: () => chromePath(126), extensions: [comp('ubo/uBlock0.chromium')], args: MV2_FLAGS }, available: have(comp('ubo/uBlock0.chromium')) && hasChrome(126), warmupMs: 15000 },
  none126: { label: 'No blocker (Chrome 126, baseline for ubo)', launch: { executable: () => chromePath(126), args: MV2_FLAGS }, available: hasChrome(126) },
  'ubo-brave': { label: 'uBlock Origin (MV2) loaded unpacked in Brave: does NOT block (Brave allow-lists MV2 by store id), kept for the record', launch: { executable: BRAVE, extensions: [comp('ubo/uBlock0.chromium')], profile: () => braveProfile(false) }, available: false },
  // Brave's ad-block lists arrive through the component updater, so it must be allowed to fetch them
  brave: { label: 'Brave Shields (default)', launch: { executable: BRAVE, profile: () => braveProfile(true), allowComponents: true }, available: fs.existsSync(BRAVE), warmupMs: 25000 },
  'brave-none': { label: 'Brave, shields off (control for ubo)', launch: { executable: BRAVE, profile: () => braveProfile(false) }, available: fs.existsSync(BRAVE) },
};
