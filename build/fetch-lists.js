// Downloads the filter lists named in build/lists.json into third_party/lists and records their
// sha256 in third_party/lists.lock.json. The build refuses lists whose hash does not match the lock
// unless --update is passed, so a release always ships exactly the lists that were reviewed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'build/lists.json'), 'utf8'));
const dir = path.join(root, 'third_party/lists');
const lockPath = path.join(root, 'third_party/lists.lock.json');
const update = process.argv.includes('--update');
fs.mkdirSync(dir, { recursive: true });

const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : { lists: {} };
const sha = (b) => createHash('sha256').update(b).digest('hex');

for (const l of [...cfg.lists.filter((x) => !x.local), { name: 'public_suffix_list', url: cfg.psl, psl: true }]) {
  const file = l.psl ? path.join(root, 'third_party/public_suffix_list.dat') : path.join(dir, `${l.name}.txt`);
  const res = await fetch(l.url, { headers: { 'User-Agent': 'veil-build' } });
  if (!res.ok) throw new Error(`${l.url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const h = sha(buf);
  const prev = lock.lists[l.name];
  if (prev && prev.sha256 !== h && !update) {
    console.log(`${l.name}: upstream changed (${prev.sha256.slice(0, 12)} -> ${h.slice(0, 12)}); keeping locked copy. Pass --update to accept.`);
    continue;
  }
  fs.writeFileSync(file, buf);
  lock.lists[l.name] = { url: l.url, sha256: h, bytes: buf.length, fetched: new Date().toISOString() };
  console.log(`${l.name}: ${buf.length} bytes ${h.slice(0, 12)}`);
}
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
