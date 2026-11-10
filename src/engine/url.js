// URL helpers shared by matcher, harness and service worker.

export function hostnameOf(url) {
  // Fast path avoids `new URL` for the common scheme://host/ shape.
  const s = url.indexOf('://');
  if (s === -1) return '';
  let i = s + 3;
  const at = url.indexOf('@', i);
  const slash = url.indexOf('/', i);
  if (at !== -1 && (slash === -1 || at < slash)) i = at + 1;
  let end = i;
  while (end < url.length) {
    const c = url.charCodeAt(end);
    if (c === 47 || c === 63 || c === 35 || c === 58) break; // / ? # :
    end++;
  }
  if (url[i] === '[') { const close = url.indexOf(']', i); return close === -1 ? '' : url.slice(i, close + 1).toLowerCase(); }
  return url.slice(i, end).toLowerCase();
}

// Public-suffix lookup. `psl` is a Set of rules as in public_suffix_list.dat ("com", "*.ck", "!www.ck").
export function domainOf(hostname, psl) {
  if (!hostname || !psl) return hostname;
  if (hostname.endsWith('.')) hostname = hostname.slice(0, -1);
  const labels = hostname.split('.');
  if (labels.length < 2) return hostname;
  // walk suffixes from the shortest; find the longest matching rule
  let suffixLen = 1;
  for (let i = labels.length - 1; i >= 0; i--) {
    const cand = labels.slice(i).join('.');
    const n = labels.length - i;
    if (psl.has('!' + cand)) { suffixLen = n - 1; break; }
    if (psl.has(cand)) suffixLen = n;
    else if (i + 1 < labels.length && psl.has('*.' + labels.slice(i + 1).join('.'))) suffixLen = n;
    else if (n > suffixLen + 1) break;
  }
  if (suffixLen >= labels.length) return hostname;
  return labels.slice(labels.length - suffixLen - 1).join('.');
}

// "www.example.co.uk" -> "www.example.*"  (for ABP entity domains like `example.*`)
export function entityOf(hostname, psl) {
  const d = domainOf(hostname, psl);
  if (!d || d === hostname && !hostname.includes('.')) return '';
  const dot = d.indexOf('.');
  if (dot === -1) return '';
  const suffix = d.slice(dot + 1);
  return hostname.slice(0, hostname.length - suffix.length) + '*';
}

export function isThirdParty(hostname, srcHostname, psl) {
  if (!srcHostname) return false;
  return domainOf(hostname, psl) !== domainOf(srcHostname, psl);
}

// yields hostname, parent, grandparent, ... down to the registrable domain's parent (eTLD+1)
export function* hostnameSuffixes(hostname) {
  let h = hostname;
  while (h) {
    yield h;
    const dot = h.indexOf('.');
    if (dot === -1) break;
    h = h.slice(dot + 1);
  }
}
