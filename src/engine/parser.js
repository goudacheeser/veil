// ABP / uBO filter list parser. Produces plain objects; compile.js turns them into the binary
// index, DNR rules and scriptlet bundles.
import { TYPE, TYPE_ALIASES, TYPE_DEFAULT, TYPE_ALL } from './constants.js';
import { parseProcedural } from './procedural.js';

const PREPROCESSOR_ENV = new Set(['env_chromium', 'env_mv3', 'ext_ublock', 'ext_ubol', 'adguard', 'adguard_ext_chromium', 'adguard_ext_chromium_mv3']);

const SCRIPTLET_ALIASES = {
  aopr: 'abort-on-property-read', aopw: 'abort-on-property-write', acs: 'abort-current-script',
  'abort-current-inline-script': 'abort-current-script', aeld: 'prevent-addEventListener',
  'addEventListener-defuser': 'prevent-addEventListener', nostif: 'no-setTimeout-if',
  'setTimeout-defuser': 'no-setTimeout-if', nosiif: 'no-setInterval-if', 'setInterval-defuser': 'no-setInterval-if',
  set: 'set-constant', nowoif: 'prevent-window-open', 'window.open-defuser': 'prevent-window-open',
  ra: 'remove-attr', rc: 'remove-class', rmnt: 'remove-node-text', 'no-fetch-if': 'prevent-fetch',
  'no-xhr-if': 'prevent-xhr', 'no-requestAnimationFrame-if': 'prevent-requestAnimationFrame', norafif: 'prevent-requestAnimationFrame',
  'silent-noeval': 'noeval-silent', 'nano-setTimeout-booster': 'adjust-setTimeout', 'nano-stb': 'adjust-setTimeout',
  'nano-setInterval-booster': 'adjust-setInterval', 'nano-sib': 'adjust-setInterval', 'webrtc-if': 'nowebrtc',
  'golem.de': null, 'cookie-remover': 'remove-cookie', 'refresh-defuser': 'prevent-refresh', 'prevent-setTimeout': 'no-setTimeout-if',
  acis: 'abort-current-script', nobab: 'prevent-bab', nofab: 'prevent-fab', 'bab-defuser': 'prevent-bab', 'fuckadblock.js-3.2.0': 'prevent-fab',
  'trusted-set': 'trusted-set-constant', 'trusted-rpnt': 'trusted-replace-node-text', rpnt: 'replace-node-text', 'replace-node-text': 'trusted-replace-node-text', aost: 'abort-on-stack-trace',
  'trusted-rpfr': 'trusted-replace-fetch-response', 'popads.net': 'popads-dummy',
};

export function normalizeScriptletName(name) {
  name = name.trim().replace(/\.js$/, '');
  return Object.hasOwn(SCRIPTLET_ALIASES, name) ? SCRIPTLET_ALIASES[name] : name;
}

function evalCondition(expr) {
  // tiny recursive-descent evaluator for !#if: identifiers, !, &&, ||, parentheses
  const toks = expr.match(/\(|\)|!|&&|\|\||[\w.-]+/g) || [];
  let i = 0;
  const atom = () => {
    const t = toks[i++];
    if (t === '(') { const v = or(); i++; return v; }
    if (t === '!') return !atom();
    return PREPROCESSOR_ENV.has(t) || t === 'true';
  };
  const and = () => { let v = atom(); while (toks[i] === '&&') { i++; v = atom() && v; } return v; };
  const or = () => { let v = and(); while (toks[i] === '||') { i++; v = and() || v; } return v; };
  return or();
}

export function parseDomains(str) {
  const include = [], exclude = [];
  for (let d of str.split('|')) {
    d = d.trim().toLowerCase();
    if (!d) continue;
    if (d[0] === '~') exclude.push(d.slice(1)); else include.push(d);
  }
  return { include, exclude };
}

const HOSTS_RE = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?|0)\s+([a-z0-9.-]+)\s*(?:#.*)?$/i;
const BARE_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const LOCAL_HOSTS = new Set(['localhost', 'localhost.localdomain', 'local', 'broadcasthost', 'ip6-localhost', 'ip6-loopback', '0.0.0.0']);
const COSMETIC_RE = /^([^#]*?)(##\^|#@#\^|#\$\?#|#@\$\?#|#\$#|#@\$#|#\?#|#@\?#|#@#|##|#%#|#@%#)(.*)$/;

export function parseLine(line, out) {
  line = line.trim();
  if (!line || line[0] === '!' || line[0] === '[') return;
  if (line[0] === '#' && line[1] !== '#' && line[1] !== '@' && line[1] !== '?' && line[1] !== '$' && line[1] !== '%') return;

  let m = HOSTS_RE.exec(line);
  if (m) { if (!LOCAL_HOSTS.has(m[1].toLowerCase())) pushNetwork(out, `||${m[1].toLowerCase()}^`, line); return; }
  if (BARE_DOMAIN_RE.test(line) && !line.includes('$')) { pushNetwork(out, `||${line.toLowerCase()}^`, line); return; }

  m = COSMETIC_RE.exec(line);
  if (m && !line.startsWith('@@')) { parseCosmetic(m[1], m[2], m[3], line, out); return; }
  if (line.includes('$$')) { out.unsupported.push({ line, reason: 'adguard-html-filter' }); return; }
  pushNetwork(out, line, line);
}

function parseCosmetic(domainStr, sep, body, raw, out) {
  if (sep === '#%#' || sep === '#@%#') { out.unsupported.push({ line: raw, reason: 'adguard-javascript-rule' }); return; }
  if (sep === '##^' || sep === '#@#^') { out.unsupported.push({ line: raw, reason: 'html-filtering (Firefox only)' }); return; }
  const exception = sep.includes('@');
  const domains = parseDomains(domainStr.replace(/,/g, '|'));
  body = body.trim();
  if (!body) return;

  if (body.startsWith('+js(')) {
    if (!body.endsWith(')')) { out.unsupported.push({ line: raw, reason: 'malformed scriptlet' }); return; }
    const args = splitScriptletArgs(body.slice(4, -1));
    const name = args.length ? normalizeScriptletName(args.shift()) : '';
    if (name === null) { out.unsupported.push({ line: raw, reason: 'scriptlet alias removed' }); return; }
    if (!exception && !domains.include.length) { out.unsupported.push({ line: raw, reason: 'generic scriptlet' }); return; }
    out.scriptlets.push({ raw, domains, name, args, exception });
    return;
  }

  // AdGuard CSS injection:  example.com#$#selector { color: red }
  if (sep === '#$#' || sep === '#@$#' || /\s\{[^{}]*\}$/.test(body)) {
    const mm = /^(.*?)\s*\{\s*(.*?)\s*\}$/.exec(body);
    if (!mm) { out.unsupported.push({ line: raw, reason: 'malformed #$# rule' }); return; }
    body = `${mm[1]}:style(${mm[2]})`;
  }

  const proc = parseProcedural(body);
  if (proc.error) { out.unsupported.push({ line: raw, reason: `procedural: ${proc.error}` }); return; }
  const generic = domains.include.length === 0;
  if (generic && !exception && proc.ops) { out.unsupported.push({ line: raw, reason: 'generic procedural filter' }); return; }
  out.cosmetic.push({ raw, domains, selector: proc.css, ops: proc.ops || null, exception, generic });
}

export function splitScriptletArgs(s) {
  const args = [];
  let cur = '', depth = 0, quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { cur += s[i + 1] === ',' ? ',' : c + s[i + 1]; i++; continue; }
    if (quote) { if (c === quote) quote = null; cur += c; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() || args.length) args.push(cur.trim());
  return args.map((a) => (a.length >= 2 && ((a[0] === '"' && a.at(-1) === '"') || (a[0] === "'" && a.at(-1) === "'")) ? a.slice(1, -1) : a));
}

const OPTION_SPLIT_RE = /\$(~?[a-z][a-z0-9_-]*(?:=|,|$))/i;

function findOptionsIndex(text) {
  // last '$' whose remainder looks like an option list; skips '$' inside regex literals
  let idx = text.length;
  while (idx > 0 && (idx = text.lastIndexOf('$', idx - 1)) >= 0) {
    const rest = text.slice(idx);
    if (OPTION_SPLIT_RE.test(rest) && rest.indexOf('/') !== 1) return idx;
  }
  return -1;
}

export function pushNetwork(out, text, raw) {
  const f = parseNetwork(text, raw);
  if (f.error) out.unsupported.push({ line: raw, reason: f.error }); else out.network.push(f);
}

export function parseNetwork(text, raw = text) {
  const f = {
    raw, exception: false, pattern: '', regex: null, anchorHost: false, anchorStart: false, anchorEnd: false,
    types: 0, notTypes: 0, party: 0, domains: null, denyallow: null, to: null, important: false, badfilter: false,
    redirect: null, redirectRule: false, removeparam: null, csp: null, matchCase: false, methods: null,
    siteFlags: 0, error: null,
  };
  if (text.startsWith('@@')) { f.exception = true; text = text.slice(2); }

  let optStr = null;
  const regexLiteral = text.length > 2 && text[0] === '/' && (text.endsWith('/') || /\/\$[^/]*$/.test(text));
  const oi = findOptionsIndex(text);
  if (oi !== -1 && !(regexLiteral && text.endsWith('/'))) { optStr = text.slice(oi + 1); text = text.slice(0, oi); }

  if (text.length > 2 && text[0] === '/' && text.endsWith('/')) {
    f.regex = text.slice(1, -1);
    try { new RegExp(f.regex); } catch { return { ...f, error: 'invalid regex' }; }
  } else {
    if (text.startsWith('||')) { f.anchorHost = true; text = text.slice(2); }
    else if (text.startsWith('|')) { f.anchorStart = true; text = text.slice(1); }
    if (text.endsWith('|')) { f.anchorEnd = true; text = text.slice(0, -1); }
    text = text.replace(/\*{2,}/g, '*');
    if (!f.anchorStart && !f.anchorHost && text.startsWith('*')) text = text.slice(1);
    if (!f.anchorEnd && text.endsWith('*')) text = text.slice(0, -1);
    if (f.anchorHost && (text.startsWith('*') || text.startsWith('.'))) { f.anchorHost = false; text = text.replace(/^[*.]+/, ''); }
    f.pattern = text;
  }

  if (optStr !== null) {
    const err = applyOptions(f, optStr);
    if (err) return { ...f, error: err };
  }
  if (!f.matchCase) { f.pattern = f.pattern.toLowerCase(); }
  f.typesExplicit = f.types !== 0 || f.notTypes !== 0;
  if (f.types === 0) f.types = TYPE_DEFAULT & ~f.notTypes; else f.types &= ~f.notTypes;
  if (!f.regex && !f.pattern && !f.domains && !f.exception && !f.csp && !f.removeparam && !f.to) {
    return { ...f, error: 'empty pattern would block everything' };
  }
  if (/[^\x00-\x7f]/.test(f.pattern)) {
    // IDN hostnames in patterns are rare; DNR requires ASCII. Punycode conversion needs the URL
    // parser which only works on full hostnames, so we keep them JS-only.
    f.nonAscii = true;
  }
  return f;
}

function applyOptions(f, optStr) {
  for (let opt of optStr.split(',')) {
    opt = opt.trim();
    if (!opt) continue;
    let neg = false;
    if (opt[0] === '~') { neg = true; opt = opt.slice(1); }
    const eq = opt.indexOf('=');
    let name = (eq === -1 ? opt : opt.slice(0, eq)).toLowerCase();
    const value = eq === -1 ? null : opt.slice(eq + 1);
    if (TYPE_ALIASES[name]) name = TYPE_ALIASES[name];

    if (name in TYPE) { if (neg) f.notTypes |= TYPE[name]; else f.types |= TYPE[name]; continue; }
    switch (name) {
      case 'all': f.types |= TYPE_ALL; break;
      case 'third-party': case '3p': if (neg) f.party = 1; else f.party = 3; break;
      case 'first-party': case '1p': if (neg) f.party = 3; else f.party = 1; break;
      case 'strict3p': f.party = 3; break;
      case 'strict1p': f.party = 1; break;
      case 'domain': case 'from': if (value === null) return 'domain= without value'; f.domains = parseDomains(value); break;
      case 'denyallow': if (value === null) return 'denyallow= without value'; f.denyallow = value.toLowerCase().split('|'); break;
      case 'to': if (value === null) return 'to= without value'; f.to = parseDomains(value); break;
      case 'important': f.important = true; break;
      case 'badfilter': f.badfilter = true; break;
      case 'redirect': case 'redirect-rule':
        if (value === null) return 'redirect without value';
        f.redirect = value.split(':')[0]; f.redirectRule = name === 'redirect-rule'; break;
      case 'removeparam': case 'queryprune': f.removeparam = value === null ? '' : value; break;
      case 'csp': f.csp = value || ''; f.types = f.types || (TYPE.document | TYPE.subdocument); break;
      case 'inline-script': f.csp = "script-src 'unsafe-eval' * blob: data:"; f.types = f.types || (TYPE.document | TYPE.subdocument); break;
      case 'inline-font': f.csp = "font-src *"; f.types = f.types || (TYPE.document | TYPE.subdocument); break;
      case 'match-case': f.matchCase = true; break;
      case 'method': if (value === null) return 'method= without value'; f.methods = value.toLowerCase().split('|'); break;
      case 'elemhide': case 'ehide': f.siteFlags |= 1; break;
      case 'generichide': case 'ghide': f.siteFlags |= 2; break;
      case 'specifichide': case 'shide': f.siteFlags |= 4; break;
      case 'genericblock': break; // no DNR equivalent; treated as plain exception
      case 'empty': case 'mp4': f.redirect = name === 'mp4' ? 'noopmp4-1s' : 'nooptext'; break;
      case 'popunder': f.types |= TYPE.popup; break;
      case 'object-subrequest': f.types |= TYPE.object; break;
      case 'ping': f.types |= TYPE.ping; break;
      case 'xhr': f.types |= TYPE.xmlhttprequest; break;
      case 'header': case 'replace': case 'urltransform': case 'permissions': case 'cname': case 'ipaddress':
      case 'network': case 'extension': case 'app': case 'cookie': case 'stealth': case 'jsinject': case 'content': case 'urlblock':
        return `unsupported option $${name}`;
      default: return `unknown option $${name}`;
    }
  }
  return null;
}

// Parse a whole list. Honors !#if / !#else / !#endif with a chromium/mv3 environment.
export function parseList(text, { name = '' } = {}) {
  const out = { name, network: [], cosmetic: [], scriptlets: [], unsupported: [], lines: 0 };
  const stack = []; // true = emitting
  let emitting = true;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('!#')) {
      const [, directive, rest = ''] = /^!#(\w+)\s*(.*)$/.exec(line) || [];
      if (directive === 'if') { stack.push(emitting); emitting = emitting && evalCondition(rest); }
      else if (directive === 'else') { const parent = stack.at(-1) ?? true; emitting = parent && !emitting; }
      else if (directive === 'endif') { emitting = stack.pop() ?? true; }
      continue;
    }
    if (!emitting) continue;
    out.lines++;
    try { parseLine(line, out); } catch (e) { out.unsupported.push({ line, reason: `parse error: ${e.message}` }); }
  }
  return out;
}
