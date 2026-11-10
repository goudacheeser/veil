// Reproducible build: lists -> binary indexes + DNR rulesets + scriptlet bundles -> dist/ -> zip.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { compile, parsePsl, MAX_RULES_PER_RULESET } from '../src/engine/compile.js';
import { SITE } from '../src/engine/constants.js';
import { SCRIPTLETS, helpers } from '../src/content/scriptlets.js';
import { zip } from './zip.js';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'build/lists.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'third_party/lists.lock.json'), 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const t0 = performance.now();

fs.rmSync(dist, { recursive: true, force: true });
for (const d of ['rulesets', 'scriptlets', 'engine', 'background', 'content', 'ui', 'resources', 'index']) fs.mkdirSync(path.join(dist, d), { recursive: true });

// 1. verify lists against the lock file (hash-verified inputs)
const lists = cfg.lists.map((l) => {
  const buf = fs.readFileSync(l.local ? path.join(root, l.local) : path.join(root, 'third_party/lists', `${l.name}.txt`));
  const h = sha(buf);
  if (!l.local && lock.lists[l.name]?.sha256 !== h) throw new Error(`${l.name}: hash ${h} does not match lists.lock.json; run fetch-lists`);
  return { ...l, text: buf.toString('utf8'), sha256: h };
});
const psl = parsePsl(fs.readFileSync(path.join(root, 'third_party/public_suffix_list.dat'), 'utf8'));

// 2. compile each group separately so a disabled group drops its cosmetic/scriptlet rules too
const groups = [...new Set(lists.map((l) => l.group))];
const report = { version: pkg.version, built: new Date().toISOString(), groups: {}, unsupported: [], dnrSkipped: [], unsupportedScriptlets: {} };
const ruleResources = [];
const scriptletIndex = {};
const noGenericHosts = new Set();
const helpersSrc = `(${helpers.toString()})()`;

for (const group of groups) {
  const gl = lists.filter((l) => l.group === group);
  const out = compile(gl, { psl, meta: { group, lists: gl.map((l) => ({ name: l.name, sha256: l.sha256, url: l.url })) } });
  fs.writeFileSync(path.join(dist, 'index', `${group}.network.bin`), out.networkBin);
  fs.writeFileSync(path.join(dist, 'index', `${group}.cosmetic.bin`), out.cosmeticBin);
  report.groups[group] = out.stats;
  report.unsupported.push(...out.unsupported);
  report.dnrSkipped.push(...out.dnrSkipped);

  for (const [name, rules] of Object.entries(out.rulesets)) {
    const enabled = gl.find((l) => l.name === name).enabled;
    for (let i = 0; i * MAX_RULES_PER_RULESET < rules.length || (i === 0 && !rules.length); i++) {
      const chunk = rules.slice(i * MAX_RULES_PER_RULESET, (i + 1) * MAX_RULES_PER_RULESET).map((r, j) => ({ ...r, id: j + 1 }));
      const id = i === 0 ? name : `${name}-${i + 1}`;
      fs.writeFileSync(path.join(dist, 'rulesets', `${id}.json`), JSON.stringify(chunk));
      ruleResources.push({ id, enabled, path: `rulesets/${id}.json`, list: name, group, rules: chunk.length });
    }
  }

  // scriptlet bundles: one MAIN-world file per scriptlet name, mapping hostname -> argument lists
  scriptletIndex[group] = [];
  for (const [name, hostMap] of out.bundles) {
    const impl = SCRIPTLETS[name];
    if (!impl) { report.unsupportedScriptlets[name] = (report.unsupportedScriptlets[name] || 0) + hostMap.size; continue; }
    const map = {};
    for (const [host, entries] of hostMap) map[host] = entries.map((e) => [e.args, e.exclude]);
    const exc = {};
    for (const [host, argLists] of out.bundleExc.get(name) || []) exc[host] = argLists;
    const file = `scriptlets/${group}.${name}.js`;
    fs.writeFileSync(path.join(dist, file), bundleSource(name, impl, map, exc, helpersSrc));
    scriptletIndex[group].push({ id: `${group}.${name}`, file, hosts: [...hostMap.keys()] });
  }
  // hosts with $generichide/$elemhide must not receive the always-on generic stylesheet
  const { BinReader } = await import('../src/engine/binary.js');
  const { CosmeticIndex } = await import('../src/engine/cosmetic-index.js');
  const { SEC } = await import('../src/engine/constants.js');
  const cr = new BinReader(out.cosmeticBin, SEC.STRINGS);
  const ci = new CosmeticIndex(cr);
  const flagsTable = cr.u32(SEC.SITE_FLAGS);
  const n = flagsTable[0], base = 2 + n * 2;
  for (let i = 0; i < n; i++) for (let k = base + flagsTable[1 + n + i]; k < base + flagsTable[1 + n + i + 1]; k += 2) {
    if (flagsTable[k + 1] & (SITE.NO_GENERIC | SITE.NO_COSMETIC)) noGenericHosts.add(cr.string(flagsTable[k]));
  }
  fs.writeFileSync(path.join(dist, 'index', `${group}.generic.css`), ci.genericAny().map((s) => `${s}{display:none!important}`).join('\n'));
}

// 3. copy sources, generate manifest
copyDir(path.join(root, 'src/engine'), path.join(dist, 'engine'));
copyDir(path.join(root, 'src/background'), path.join(dist, 'background'));
copyDir(path.join(root, 'src/content'), path.join(dist, 'content'));
copyDir(path.join(root, 'src/ui'), path.join(dist, 'ui'));
copyDir(path.join(root, 'resources'), path.join(dist, 'resources'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf8'));
manifest.version = pkg.version;
manifest.declarative_net_request = { rule_resources: ruleResources.map(({ id, enabled, path: p }) => ({ id, enabled, path: p })) };
fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 4. build metadata consumed by the service worker
const groupsMeta = Object.fromEntries(groups.map((g) => [g, { enabled: lists.some((l) => l.group === g && l.enabled), lists: lists.filter((l) => l.group === g).map((l) => l.name) }]));
fs.writeFileSync(path.join(dist, 'build.json'), JSON.stringify({
  version: pkg.version, built: report.built, groups: groupsMeta, rulesets: ruleResources, scriptlets: scriptletIndex,
  noGenericHosts: [...noGenericHosts].sort(), lists: lists.map((l) => ({ name: l.name, group: l.group, url: l.url, sha256: l.sha256, license: l.license, enabled: l.enabled })),
}, null, 1));

// 5. signed list lock for the in-extension updater (dev key generated on first build)
const keyDir = path.join(root, 'build/keys');
fs.mkdirSync(keyDir, { recursive: true });
if (!fs.existsSync(path.join(keyDir, 'ed25519.pem'))) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(keyDir, 'ed25519.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(path.join(keyDir, 'ed25519.pub.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
}
const privPem = fs.readFileSync(path.join(keyDir, 'ed25519.pem'));
const pubDer = (await import('node:crypto')).createPublicKey(fs.readFileSync(path.join(keyDir, 'ed25519.pub.pem'))).export({ type: 'spki', format: 'der' });
const lockOut = JSON.stringify({ version: pkg.version, generated: report.built, lists: lists.map((l) => ({ name: l.name, group: l.group, url: l.url, sha256: l.sha256 })) });
fs.writeFileSync(path.join(dist, 'lists.lock.json'), lockOut);
fs.writeFileSync(path.join(dist, 'lists.lock.sig'), sign(null, Buffer.from(lockOut), privPem).toString('base64'));
fs.writeFileSync(path.join(dist, 'updater-key.json'), JSON.stringify({ alg: 'Ed25519', spki: pubDer.toString('base64') }));

// 6. report + reproducible zip
report.rulesets = ruleResources;
report.totalDnrRules = ruleResources.reduce((n, r) => n + r.rules, 0);
report.enabledDnrRules = ruleResources.filter((r) => r.enabled).reduce((n, r) => n + r.rules, 0);
report.buildMs = Math.round(performance.now() - t0);
fs.writeFileSync(path.join(root, 'build/build-report.json'), JSON.stringify(report, null, 1));
const zipPath = path.join(root, `veil-${pkg.version}.zip`);
const zipBuf = zip(dist);
fs.writeFileSync(zipPath, zipBuf);
fs.writeFileSync(zipPath + '.sha256', `${sha(zipBuf)}  veil-${pkg.version}.zip\n`);

const sizes = Object.fromEntries(fs.readdirSync(path.join(dist, 'index')).map((f) => [f, Math.round(fs.statSync(path.join(dist, 'index', f)).size / 1024) + ' KB']));
console.log(JSON.stringify({ rulesets: ruleResources.map((r) => `${r.id}:${r.rules}${r.enabled ? '' : ' (off)'}`), totalDnrRules: report.totalDnrRules, enabledDnrRules: report.enabledDnrRules, index: sizes, scriptletBundles: Object.fromEntries(Object.entries(scriptletIndex).map(([g, v]) => [g, v.length])), unsupportedScriptlets: report.unsupportedScriptlets, unsupported: report.unsupported.length, dnrSkipped: report.dnrSkipped.length, zip: `${path.basename(zipPath)} ${Math.round(zipBuf.length / 1024)} KB sha256=${sha(zipBuf)}`, buildMs: report.buildMs }, null, 1));

function bundleSource(name, impl, map, exc, helpersSrc) {
  return `// veil scriptlet bundle: ${name}\n(function(){\n` +
    `const MAP=${JSON.stringify(map)};\nconst EXC=${JSON.stringify(exc)};\n` +
    `const H=${helpersSrc};\nconst impl=${impl.toString()};\n` +
    `let h=location.hostname;const hits=[];const excs=[];let excAll=false;\n` +
    `while(h){const e=MAP[h];if(e)for(const [args,excl] of e){if(!excl.some(x=>location.hostname===x||location.hostname.endsWith('.'+x)))hits.push(args);}` +
    `const x=EXC[h];if(x)for(const a of x){if(a.length===0)excAll=true;else excs.push(JSON.stringify(a));}` +
    `const i=h.indexOf('.');if(i<0)break;h=h.slice(i+1);}\n` +
    `if(!excAll)for(const args of hits){if(excs.includes(JSON.stringify(args)))continue;try{impl(H,...args);}catch(e){}}\n})();\n`;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
    else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}
