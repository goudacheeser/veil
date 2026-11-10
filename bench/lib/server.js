// Tiny static server with Host-based routing. Chrome's --host-resolver-rules maps real ad
// hostnames to 127.0.0.1, so tests exercise realistic third-party URLs fully offline.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.gif': 'image/gif', '.png': 'image/png', '.txt': 'text/plain' };

// routes: { 'site.test': dir, '*': fallbackDir }
export function serve(routes, port = 80) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const dir = routes[host] || routes['*'];
    const url = new URL(req.url, 'http://x');
    hits.push({ host, path: url.pathname });
    let file = dir && path.join(dir, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file || !file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, hits, close: () => new Promise((r) => server.close(r)) }));
  });
}

export const RESOLVER_RULE = (hosts) => `--host-resolver-rules=${hosts.map((h) => `MAP ${h} 127.0.0.1`).join(', ')}`;
