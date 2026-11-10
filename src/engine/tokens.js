// FNV-1a 32-bit over UTF-16 code units. Inputs are lowercased by callers.
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const TOKEN_RE = /[0-9a-z%]+/g;
export const ANY_TOKEN = 0; // bucket tested against every request

// Push token hashes of a lowercased URL into `out` (cleared first). Capped to keep
// pathological URLs (data:, long query strings) cheap.
export function tokenizeUrl(url, out = []) {
  out.length = 0;
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(url)) !== null && out.length < 64) out.push(hash(m[0]));
  out.push(ANY_TOKEN);
  return out;
}

// Tokens of a filter pattern that are guaranteed to appear whole in any matching URL.
// A token touching a wildcard, or sitting at an unanchored edge, may be a fragment of
// a longer URL token, so it is unusable as an index key.
export function patternTokens(pattern, { anchorStart = false, anchorEnd = false } = {}) {
  const out = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(pattern)) !== null) {
    const before = m.index === 0 ? (anchorStart ? '|' : '') : pattern[m.index - 1];
    const endIdx = m.index + m[0].length;
    const after = endIdx === pattern.length ? (anchorEnd ? '|' : '') : pattern[endIdx];
    if (before === '*' || after === '*' || before === '' || after === '') continue;
    out.push(m[0]);
  }
  return out;
}
