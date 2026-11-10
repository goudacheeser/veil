// Scriptlet library. Each scriptlet is a self-contained function `(H, ...args)` where H is the
// helper object below; the build stringifies them into per-scriptlet MAIN-world bundles, and the
// service worker injects them with chrome.scripting.executeScript for runtime-added filters.
// Only `H` and the arguments may be referenced: no module-scope closures.

export function helpers() {
  const magic = 'veil' + Math.random().toString(36).slice(2);
  let errorHooked = false;
  const H = {
    magic,
    needle(arg, allowEmpty = true) {
      if (arg === undefined || arg === null || arg === '') return allowEmpty ? { test: () => true, empty: true } : { test: () => false };
      let s = String(arg), neg = false;
      if (s[0] === '!') { neg = true; s = s.slice(1); }
      let re;
      const m = /^\/(.+)\/([a-z]*)$/.exec(s);
      try { re = m ? new RegExp(m[1], m[2]) : null; } catch { re = null; }
      const test = re ? (x) => re.test(x) : (x) => String(x).includes(s);
      return { test: (x) => (neg ? !test(x) : test(x)), neg };
    },
    // Hook `path` under root, re-hooking when intermediate objects are (re)assigned.
    hook(root, path, onLeaf) {
      const i = path.indexOf('.');
      if (i === -1) { onLeaf(root, path); return; }
      const prop = path.slice(0, i), rest = path.slice(i + 1);
      let v = root[prop];
      if (v !== undefined && v !== null && (typeof v === 'object' || typeof v === 'function')) { H.hook(v, rest, onLeaf); return; }
      const desc = Object.getOwnPropertyDescriptor(root, prop);
      if (desc && !desc.configurable) return;
      Object.defineProperty(root, prop, {
        configurable: true, enumerable: desc ? desc.enumerable : true,
        get() { return v; },
        set(nv) { v = nv; if (nv && (typeof nv === 'object' || typeof nv === 'function')) H.hook(nv, rest, onLeaf); },
      });
    },
    abort() {
      if (!errorHooked) {
        errorHooked = true;
        const oe = window.onerror;
        window.onerror = function (msg, ...rest) {
          if (typeof msg === 'string' && msg.includes(magic)) return true;
          return typeof oe === 'function' ? oe.call(this, msg, ...rest) : false;
        };
        window.addEventListener('error', (e) => { if (e.error && String(e.error.message).includes(magic)) e.stopImmediatePropagation(); }, true);
      }
      throw new ReferenceError(magic);
    },
    constant(v) {
      switch (v) {
        case 'undefined': return undefined; case 'false': return false; case 'true': return true; case 'null': return null;
        case 'noopFunc': return function () {}; case 'trueFunc': return function () { return true; }; case 'falseFunc': return function () { return false; };
        case 'throwFunc': return function () { throw new Error(); }; case '': return ''; case 'emptyArr': case '[]': return []; case 'emptyObj': case '{}': return {};
        case 'noopCallbackFunc': return function (f) { if (typeof f === 'function') f(); };
        default: {
          if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
          if (/^'.*'$|^".*"$/.test(v)) return v.slice(1, -1);
          return v;
        }
      }
    },
    onReady(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn, { once: true }); },
    // Run fn for current and future matching elements.
    observe(fn) {
      let scheduled = false;
      const run = () => { scheduled = false; try { fn(); } catch {} };
      H.onReady(run);
      new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(run); } }).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    },
    scope(el, sel) { return /^\s*[>+~\s]/.test(sel) ? el.querySelectorAll(':scope' + sel) : (el.matches(sel) ? [el] : []); },
    // "propsToMatch" matching for fetch/xhr: "url:/x/ method:GET" or a bare needle on the url
    propsMatch(spec, props) {
      if (!spec) return true;
      for (const part of String(spec).split(/\s+/)) {
        const c = part.indexOf(':');
        const key = c === -1 ? 'url' : part.slice(0, c);
        const val = c === -1 ? part : part.slice(c + 1);
        if (!H.needle(val).test(String(props[key] ?? ''))) return false;
      }
      return true;
    },
  };
  return H;
}

export const SCRIPTLETS = {
  'abort-on-property-read': function (H, prop) {
    H.hook(window, prop, (obj, p) => {
      const desc = Object.getOwnPropertyDescriptor(obj, p);
      if (desc && !desc.configurable) return;
      let v = obj[p];
      Object.defineProperty(obj, p, { configurable: true, get() { H.abort(); }, set(nv) { v = nv; } });
    });
  },
  'abort-on-property-write': function (H, prop) {
    H.hook(window, prop, (obj, p) => {
      const desc = Object.getOwnPropertyDescriptor(obj, p);
      if (desc && !desc.configurable) return;
      const v = obj[p];
      Object.defineProperty(obj, p, { configurable: true, get() { return v; }, set() { H.abort(); } });
    });
  },
  'abort-current-script': function (H, prop, needle) {
    const n = H.needle(needle);
    H.hook(window, prop, (obj, p) => {
      const desc = Object.getOwnPropertyDescriptor(obj, p);
      if (desc && !desc.configurable) return;
      let v = obj[p];
      const check = () => {
        const s = document.currentScript;
        if (s && n.test((s.textContent || '') + (s.src || ''))) H.abort();
      };
      Object.defineProperty(obj, p, { configurable: true, get() { check(); return v; }, set(nv) { check(); v = nv; } });
    });
  },
  'set-constant': function (H, prop, value) {
    const c = H.constant(value);
    H.hook(window, prop, (obj, p) => {
      const desc = Object.getOwnPropertyDescriptor(obj, p);
      if (desc && !desc.configurable) return;
      Object.defineProperty(obj, p, { configurable: true, enumerable: true, get() { return c; }, set() {} });
    });
  },
  'no-setTimeout-if': function (H, needle, delay) {
    const n = H.needle(needle), d = delay === undefined || delay === '' ? null : H.needle(delay);
    const orig = window.setTimeout;
    window.setTimeout = new Proxy(orig, { apply(t, self, args) {
      const [fn, ms] = args;
      if (n.test(String(fn)) && (!d || d.test(String(ms ?? 0)))) { if (!(n.empty && d)) args[0] = function () {}; }
      return Reflect.apply(t, self, args);
    } });
  },
  'no-setInterval-if': function (H, needle, delay) {
    const n = H.needle(needle), d = delay === undefined || delay === '' ? null : H.needle(delay);
    const orig = window.setInterval;
    window.setInterval = new Proxy(orig, { apply(t, self, args) {
      const [fn, ms] = args;
      if (n.test(String(fn)) && (!d || d.test(String(ms ?? 0)))) args[0] = function () {};
      return Reflect.apply(t, self, args);
    } });
  },
  'prevent-requestAnimationFrame': function (H, needle) {
    const n = H.needle(needle);
    const orig = window.requestAnimationFrame;
    window.requestAnimationFrame = new Proxy(orig, { apply(t, self, args) { if (n.test(String(args[0]))) args[0] = function () {}; return Reflect.apply(t, self, args); } });
  },
  'adjust-setTimeout': function (H, needle, delay = '1000', boost = '0.05') {
    const n = H.needle(needle), target = Number(delay), b = Math.min(Math.max(Number(boost), 0.001), 50);
    const orig = window.setTimeout;
    window.setTimeout = new Proxy(orig, { apply(t, self, args) { if (n.test(String(args[0])) && (delay === '*' || Number(args[1]) === target)) args[1] = Number(args[1]) * b; return Reflect.apply(t, self, args); } });
  },
  'adjust-setInterval': function (H, needle, delay = '1000', boost = '0.05') {
    const n = H.needle(needle), target = Number(delay), b = Math.min(Math.max(Number(boost), 0.001), 50);
    const orig = window.setInterval;
    window.setInterval = new Proxy(orig, { apply(t, self, args) { if (n.test(String(args[0])) && (delay === '*' || Number(args[1]) === target)) args[1] = Number(args[1]) * b; return Reflect.apply(t, self, args); } });
  },
  'prevent-addEventListener': function (H, type, handler) {
    const t = H.needle(type), h = H.needle(handler);
    const orig = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = new Proxy(orig, { apply(fn, self, args) {
      if (t.test(String(args[0])) && h.test(String(args[1]))) return undefined;
      return Reflect.apply(fn, self, args);
    } });
  },
  'prevent-window-open': function (H, pattern, delay, decoy) {
    const n = H.needle(pattern);
    const orig = window.open;
    window.open = new Proxy(orig, { apply(fn, self, args) {
      if (!n.test(String(args[0] ?? ''))) return Reflect.apply(fn, self, args);
      const w = { closed: false, close() { this.closed = true; }, focus() {}, blur() {}, document: { write() {}, close() {}, open() {} }, location: { href: '' }, postMessage() {} };
      return w;
    } });
  },
  'nowebrtc': function () {
    const stub = function () { this.createDataChannel = () => ({ close() {}, send() {} }); this.createOffer = () => Promise.resolve({}); this.createAnswer = () => Promise.resolve({}); this.setLocalDescription = () => Promise.resolve(); this.setRemoteDescription = () => Promise.resolve(); this.addIceCandidate = () => Promise.resolve(); this.close = () => {}; this.addEventListener = () => {}; this.removeEventListener = () => {}; this.getStats = () => Promise.resolve([]); };
    window.RTCPeerConnection = stub; window.webkitRTCPeerConnection = stub;
  },
  'noeval': function () { window.eval = function () {}; },
  'noeval-silent': function () { window.eval = function () {}; },
  'noeval-if': function (H, needle) { const n = H.needle(needle); const orig = window.eval; window.eval = new Proxy(orig, { apply(fn, self, args) { return n.test(String(args[0])) ? undefined : Reflect.apply(fn, self, args); } }); },
  'json-prune': function (H, paths, needlePaths, stack) {
    const toPrune = String(paths || '').split(/\s+/).filter(Boolean);
    const required = String(needlePaths || '').split(/\s+/).filter(Boolean);
    const has = (o, path) => {
      const segs = path.split('.');
      let cur = [o];
      for (const s of segs) {
        const next = [];
        for (const c of cur) {
          if (c === null || typeof c !== 'object') continue;
          if (s === '*' || s === '[]') next.push(...Object.values(c)); else if (s in c) next.push(c[s]);
        }
        if (!next.length) return false;
        cur = next;
      }
      return true;
    };
    const prune = (o, path) => {
      const segs = path.split('.');
      const last = segs.pop();
      let cur = [o];
      for (const s of segs) {
        const next = [];
        for (const c of cur) {
          if (c === null || typeof c !== 'object') continue;
          if (s === '*' || s === '[]') next.push(...Object.values(c)); else if (s in c) next.push(c[s]);
        }
        cur = next;
      }
      for (const c of cur) if (c && typeof c === 'object') { if (last === '*' || last === '[]') { for (const k of Object.keys(c)) delete c[k]; } else delete c[last]; }
    };
    const apply = (o) => {
      if (!o || typeof o !== 'object') return o;
      if (required.length && !required.every((p) => has(o, p))) return o;
      if (!toPrune.length) return o;
      for (const p of toPrune) prune(o, p);
      return o;
    };
    const parse = JSON.parse;
    JSON.parse = new Proxy(parse, { apply(fn, self, args) { return apply(Reflect.apply(fn, self, args)); } });
    const rj = Response.prototype.json;
    Response.prototype.json = new Proxy(rj, { apply(fn, self, args) { return Reflect.apply(fn, self, args).then(apply); } });
  },
  'remove-attr': function (H, attrs, selector) {
    const names = String(attrs).split('|');
    const sel = selector || names.map((a) => `[${a}]`).join(',');
    H.observe(() => { for (const el of document.querySelectorAll(sel)) for (const a of names) if (el.hasAttribute(a)) el.removeAttribute(a); });
  },
  'remove-class': function (H, classes, selector) {
    const names = String(classes).split('|');
    const sel = selector || names.map((c) => `.${c}`).join(',');
    H.observe(() => { for (const el of document.querySelectorAll(sel)) el.classList.remove(...names); });
  },
  'set-attr': function (H, selector, attr, value = '') {
    H.observe(() => { for (const el of document.querySelectorAll(selector)) if (el.getAttribute(attr) !== value) el.setAttribute(attr, value); });
  },
  'set-local-storage-item': function (H, key, value) {
    try { if (value === '$remove$') localStorage.removeItem(key); else localStorage.setItem(key, String(H.constant(value === 'yes' || value === 'no' ? value : value))); } catch {}
  },
  'set-session-storage-item': function (H, key, value) {
    try { if (value === '$remove$') sessionStorage.removeItem(key); else sessionStorage.setItem(key, String(H.constant(value))); } catch {}
  },
  'set-cookie': function (H, name, value, path = '/') {
    if (!/^[\w-]+$/.test(name) || !/^[\w.-]*$/.test(String(value))) return;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=${path}`;
  },
  'remove-cookie': function (H, needle) {
    const n = H.needle(needle);
    const run = () => { for (const c of document.cookie.split(';')) { const name = c.split('=')[0].trim(); if (name && n.test(name)) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`; } };
    run(); window.addEventListener('beforeunload', run);
  },
  'prevent-fetch': function (H, props, body = 'emptyObj', type) {
    const orig = window.fetch;
    window.fetch = new Proxy(orig, { apply(fn, self, args) {
      const [input, init] = args;
      const url = typeof input === 'string' ? input : input && input.url;
      const method = (init && init.method) || (input && input.method) || 'GET';
      if (!H.propsMatch(props, { url, method })) return Reflect.apply(fn, self, args);
      const text = body === 'emptyArr' ? '[]' : body === 'emptyStr' ? '' : body === 'emptyObj' ? '{}' : body === 'true' ? 'true' : '{}';
      const ct = type === 'text' ? 'text/plain' : type === 'script' ? 'text/javascript' : 'application/json';
      return Promise.resolve(new Response(text, { status: 200, statusText: 'OK', headers: { 'Content-Type': ct } }));
    } });
  },
  'prevent-xhr': function (H, props) {
    const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    const marked = new WeakMap();
    XMLHttpRequest.prototype.open = new Proxy(open, { apply(fn, self, args) {
      if (H.propsMatch(props, { method: args[0], url: String(args[1]) })) marked.set(self, String(args[1]));
      return Reflect.apply(fn, self, args);
    } });
    XMLHttpRequest.prototype.send = new Proxy(send, { apply(fn, self, args) {
      if (!marked.has(self)) return Reflect.apply(fn, self, args);
      const url = marked.get(self);
      const def = (k, v) => Object.defineProperty(self, k, { configurable: true, get: () => v });
      def('readyState', 4); def('status', 200); def('statusText', 'OK'); def('responseURL', url); def('responseText', ''); def('response', self.responseType === 'json' ? null : ''); def('responseXML', null);
      def('getResponseHeader', () => null); def('getAllResponseHeaders', () => '');
      setTimeout(() => { for (const t of ['readystatechange', 'load', 'loadend']) self.dispatchEvent(new Event(t)); }, 1);
    } });
  },
  'prevent-element-src-loading': function (H, tag, needle) {
    const n = H.needle(needle, false);
    const proto = { script: HTMLScriptElement, img: HTMLImageElement, iframe: HTMLIFrameElement, link: HTMLLinkElement }[tag];
    if (!proto) return;
    const attr = tag === 'link' ? 'href' : 'src';
    const desc = Object.getOwnPropertyDescriptor(proto.prototype, attr);
    if (!desc) return;
    const replacement = tag === 'img' ? 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' : tag === 'iframe' ? 'about:blank' : 'data:text/javascript,';
    Object.defineProperty(proto.prototype, attr, { ...desc, set(v) { desc.set.call(this, n.test(String(v)) ? replacement : v); } });
    const sa = Element.prototype.setAttribute;
    Element.prototype.setAttribute = new Proxy(sa, { apply(fn, self, args) { if (self instanceof proto && args[0] === attr && n.test(String(args[1]))) args[1] = replacement; return Reflect.apply(fn, self, args); } });
  },
  'remove-node-text': function (H, nodeName, needle) {
    const n = H.needle(needle), tag = String(nodeName).toUpperCase();
    const scrub = (node) => { if (node.nodeType === 1 && node.nodeName === tag && n.test(node.textContent)) node.textContent = ''; };
    new MutationObserver((muts) => { for (const m of muts) for (const node of m.addedNodes) { scrub(node); if (node.nodeType === 1 && node.querySelectorAll) for (const c of node.querySelectorAll(tag)) scrub(c); } }).observe(document, { childList: true, subtree: true });
  },
  'disable-newtab-links': function () {
    document.addEventListener('click', (e) => { const a = e.target && e.target.closest && e.target.closest('a[target="_blank"]'); if (a) e.preventDefault(); }, true);
  },
  'prevent-refresh': function (H, delay) {
    H.onReady(() => { for (const m of document.querySelectorAll('meta[http-equiv="refresh" i]')) { if (delay === undefined || String(m.content).startsWith(String(delay))) m.remove(); } });
  },
  'window.name-defuser': function () { window.name = ''; },
  'alert-buster': function () { window.alert = function () {}; },
  'call-nothrow': function (H, prop) {
    H.hook(window, prop, (obj, p) => { const f = obj[p]; if (typeof f !== 'function') return; obj[p] = new Proxy(f, { apply(fn, self, args) { try { return Reflect.apply(fn, self, args); } catch { return undefined; } } }); });
  },
  'popads-dummy': function () { for (const k of ['PopAds', 'popns', 'popMagic', 'popunder']) { try { Object.defineProperty(window, k, { configurable: true, get: () => ({}), set() {} }); } catch {} } },
  'href-sanitizer': function (H, selector, source) {
    H.observe(() => { for (const a of document.querySelectorAll(selector)) {
      let v = source && source[0] === '[' ? a.getAttribute(source.slice(1, -1)) : (source && source[0] === '?' ? new URL(a.href).searchParams.get(source.slice(1)) : a.textContent.trim());
      if (v && /^https?:\/\//.test(v) && a.href !== v) a.href = v;
    } });
  },
  'no-floc': function () {},
  'prevent-bab': function () {
    // BlockAdBlock defines window.blockAdBlock / BlockAdBlock; its check() looks for a bait element it
    // cannot find when the constructor is a stub, so the "detected" callbacks never fire.
    const stub = function () { return { check() { return this; }, on() { return this; }, onDetected() { return this; }, onNotDetected(f) { try { typeof f === 'function' && setTimeout(f, 1); } catch {} return this; }, setOption() { return this; }, emitEvent() { return this; }, clearEvent() { return this; } }; };
    for (const name of ['blockAdBlock', 'BlockAdBlock', 'sniffAdBlock', 'SniffAdBlock']) {
      try { Object.defineProperty(window, name, { configurable: true, get: () => stub(), set() {} }); } catch {}
    }
    const orig = Function.prototype.toString;
    Function.prototype.toString = new Proxy(orig, { apply(fn, self, args) { return Reflect.apply(fn, self, args); } });
  },
  'prevent-fab': function () {
    const inst = { check() { return true; }, on(d, f) { if (!d && typeof f === 'function') setTimeout(f, 1); return this; }, onDetected() { return this; }, onNotDetected(f) { if (typeof f === 'function') setTimeout(f, 1); return this; }, setOption() { return this; }, emitEvent() { return this; }, clearEvent() { return this; } };
    const Fab = function () { return inst; };
    for (const name of ['fuckAdBlock', 'FuckAdBlock']) { try { Object.defineProperty(window, name, { configurable: true, get: () => (name[0] === 'F' ? Fab : inst), set() {} }); } catch {} }
  },
  'trusted-set-constant': function (H, prop, value) {
    let c;
    try { c = JSON.parse(value); } catch { c = H.constant(value); }
    H.hook(window, prop, (obj, p) => { const d = Object.getOwnPropertyDescriptor(obj, p); if (d && !d.configurable) return; Object.defineProperty(obj, p, { configurable: true, enumerable: true, get() { return c; }, set() {} }); });
  },
  'trusted-set-cookie': function (H, name, value, offsetExpires, path = '/') {
    if (!/^[\w.-]+$/.test(name)) return;
    const now = Date.now();
    const v = value === '$now$' ? String(now) : value === '$currentDate$' ? new Date().toUTCString() : value === '$currentISODate$' ? new Date().toISOString() : value;
    let exp = '';
    if (offsetExpires) { const n = offsetExpires === '1year' ? 365 * 864e5 : offsetExpires === '1day' ? 864e5 : Number(offsetExpires) * 1000; if (n) exp = `; expires=${new Date(now + n).toUTCString()}`; }
    document.cookie = `${name}=${encodeURIComponent(v)}; path=${path}${exp}`;
  },
  'trusted-set-cookie-reload': function (H, name, value, offsetExpires, path = '/') {
    if (document.cookie.split(';').some((c) => c.trim().startsWith(name + '='))) return;
    if (!/^[\w.-]+$/.test(name)) return;
    const v = value === '$now$' ? String(Date.now()) : value === '$currentDate$' ? new Date().toUTCString() : value;
    document.cookie = `${name}=${encodeURIComponent(v)}; path=${path}`;
    location.reload();
  },
  'trusted-set-local-storage-item': function (H, key, value) { try { localStorage.setItem(key, value === '$now$' ? String(Date.now()) : value === '$currentDate$' ? new Date().toUTCString() : value); } catch {} },
  'trusted-set-session-storage-item': function (H, key, value) { try { sessionStorage.setItem(key, value); } catch {} },
  'trusted-click-element': function (H, selectors, extraMatch = '', delay = '') {
    // Clicks each selector once it appears, in order, optionally after a delay. Used to dismiss
    // cookie banners the lists know about.
    if (extraMatch) {
      const ok = extraMatch.split(/\s+/).every((cond) => {
        const m = /^(!?)(cookie|localStorage):(.*)$/.exec(cond);
        if (!m) return true;
        const n = H.needle(m[3]);
        const store = m[2] === 'cookie' ? document.cookie : Object.keys(localStorage).join('\n');
        const found = n.test(store);
        return m[1] ? !found : found;
      });
      if (!ok) return;
    }
    const list = selectors.split(/\s*,\s*/).filter(Boolean);
    let idx = 0, done = false;
    const start = () => {
      let obs;
      const tick = () => {
        if (done) return;
        let el = null;
        try { el = document.querySelector(list[idx]); } catch { done = true; return; }
        if (el) { try { el.click(); } catch {} idx++; if (idx >= list.length) { done = true; obs && obs.disconnect(); } }
      };
      obs = new MutationObserver(tick);
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      tick();
      setTimeout(() => { done = true; obs.disconnect(); }, 10000);
    };
    setTimeout(start, Number(delay) || 0);
  },
  'trusted-replace-node-text': function (H, nodeName, pattern, replacement) {
    const m = /^\/(.+)\/([a-z]*)$/.exec(pattern);
    const n = m ? new RegExp(m[1], m[2]) : pattern;
    const tag = String(nodeName).toUpperCase();
    const scrub = (node) => {
      if (node.nodeType === 1 && node.nodeName === tag) { const t = node.textContent; const r = t.replace(n, replacement); if (r !== t) node.textContent = r; }
      else if (node.nodeType === 3 && tag === '#TEXT') { const r = node.data.replace(n, replacement); if (r !== node.data) node.data = r; }
    };
    new MutationObserver((muts) => { for (const mu of muts) for (const node of mu.addedNodes) { scrub(node); if (node.nodeType === 1 && node.querySelectorAll && tag !== '#TEXT') for (const c of node.querySelectorAll(tag)) scrub(c); } }).observe(document, { childList: true, subtree: true });
  },
};
// trusted variants that share an implementation with the untrusted scriptlet
SCRIPTLETS['trusted-prevent-fetch'] = SCRIPTLETS['prevent-fetch'];
SCRIPTLETS['trusted-prevent-xhr'] = SCRIPTLETS['prevent-xhr'];

// Scriptlet names that appear in common lists but are intentionally not implemented.
export const TRUSTED_ONLY = Object.keys(SCRIPTLETS).filter((n) => n.startsWith('trusted-'));
export const UNSUPPORTED_SCRIPTLETS = ['abort-on-stack-trace', 'trusted-replace-fetch-response', 'trusted-replace-xhr-response', 'trusted-prune-inbound-object', 'trusted-set-attr', 'trusted-replace-argument', 'trusted-override-element-method', 'trusted-replace-outbound-text', 'trusted-prune-outbound-object', 'trusted-suppress-native-method', 'spoof-css', 'prevent-canvas', 'xml-prune', 'm3u-prune', 'evaldata-prune', 'overlay-buster', 'multiup', 'addEventListener-logger', 'json-edit', 'json-prune-fetch-response', 'json-prune-xhr-response', 'trusted-create-html', 'trusted-prevent-dom-bypass', 'trusted-edit-inbound-object', 'proxy-apply-config', 'fingerprint2'];
