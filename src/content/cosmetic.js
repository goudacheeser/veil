// Cosmetic filtering content script (ISOLATED world, document_start, all frames).
// 1. ask the service worker for hostname-specific selectors and procedural filters
// 2. inject them as one stylesheet, then watch the DOM: new ids/classes are looked up in batches
//    (one message per animation frame at most) and procedural filters are re-evaluated per batch.
(() => {
  const hostname = location.hostname;
  if (!hostname || !/^https?:$/.test(location.protocol) && location.protocol !== 'about:') return;
  const HIDE_ATTR = 'data-veil-hide';
  const t0 = performance.now();
  const stats = { cpuMs: 0, selectors: 0, generic: 0, procedural: 0, messages: 0 };

  let sheet = null;
  function getSheet() {
    if (sheet) return sheet;
    const style = document.createElement('style');
    style.setAttribute('data-veil', '');
    (document.head || document.documentElement).appendChild(style);
    sheet = style.sheet;
    try { sheet.insertRule(`[${HIDE_ATTR}]{display:none!important}`); } catch {}
    return sheet;
  }
  function insertSelectors(selectors) {
    if (!selectors.length) return;
    const s = getSheet();
    for (let i = 0; i < selectors.length; i += 32) {
      const chunk = selectors.slice(i, i + 32);
      try { s.insertRule(`${chunk.join(',')}{display:none!important}`); stats.selectors += chunk.length; }
      catch { for (const sel of chunk) { try { s.insertRule(`${sel}{display:none!important}`); stats.selectors++; } catch {} } }
    }
  }

  const seenIds = new Set(), seenClasses = new Set();
  let pendingIds = [], pendingClasses = [], exceptions = [];
  let frame = 0, procedural = [], noGeneric = true, pendingNodes = [];

  function collect(el) {
    const id = el.id; if (id && !seenIds.has(id)) { seenIds.add(id); pendingIds.push(id); }
    const cl = el.classList; if (cl.length) for (let i = 0; i < cl.length; i++) { const c = cl[i]; if (!seenClasses.has(c)) { seenClasses.add(c); pendingClasses.push(c); } }
  }
  function scan(root) {
    if (root.nodeType === 1) collect(root);
    const all = root.querySelectorAll ? root.querySelectorAll('[id],[class]') : [];
    for (let i = 0; i < all.length; i++) collect(all[i]);
  }

  function schedule() { if (!frame) frame = requestAnimationFrame(flush); }
  function flush() {
    frame = 0;
    const t = performance.now();
    const nodes = pendingNodes; pendingNodes = [];
    if (!noGeneric) {
      for (const n of nodes) if (n.isConnected) scan(n);
      if (pendingIds.length || pendingClasses.length) {
        const ids = pendingIds, classes = pendingClasses; pendingIds = []; pendingClasses = [];
        stats.messages++;
        chrome.runtime.sendMessage({ type: 'generic', hostname, ids, classes, exceptions }).then((sel) => { if (Array.isArray(sel) && sel.length) { stats.generic += sel.length; insertSelectors(sel); } }).catch(() => {});
      }
    }
    if (procedural.length) runProcedural();
    stats.cpuMs += performance.now() - t;
  }

  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') pendingNodes.push(m.target);
      else for (const n of m.addedNodes) if (n.nodeType === 1) pendingNodes.push(n);
    }
    if (pendingNodes.length) schedule();
  });

  // ---- procedural filters ----
  const needle = (op) => (op.re !== undefined ? new RegExp(op.re, op.flags) : null);
  function applyOps(elements, ops) {
    let set = elements;
    for (const op of ops) {
      const next = [];
      switch (op.op) {
        case 'has-text': { const re = needle(op); for (const el of set) { const t = el.textContent; if (re ? re.test(t) : t.includes(op.text)) next.push(el); } break; }
        case 'matches-path': { const re = needle(op); const p = location.pathname + location.search; if (re ? re.test(p) : p.includes(op.text)) next.push(...set); break; }
        case 'min-text-length': for (const el of set) if (el.textContent.length >= op.n) next.push(el); break;
        case 'upward': for (const el of set) { let a = null; if (op.n) { a = el; for (let i = 0; i < op.n && a; i++) a = a.parentElement; } else a = el.parentElement && el.parentElement.closest(op.css); if (a && a !== document.documentElement && a !== document.body) next.push(a); } break;
        case 'spath': for (const el of set) { try { next.push(...scope(el, op.arg)); } catch {} } break;
        case 'has': for (const el of set) { let cand; try { cand = [...scope(el, ' ' + op.css)]; } catch { cand = []; } if (op.ops) cand = applyOps(cand, op.ops); if (cand.length) next.push(el); } break;
        case 'not': for (const el of set) { let cand = []; try { cand = el.matches(op.css) ? [el] : []; } catch {} if (op.ops && cand.length) cand = applyOps(cand, op.ops); if (!cand.length) next.push(el); } break;
        case 'matches-css': { const re = needle(op); for (const el of set) { const v = getComputedStyle(el, op.pseudo).getPropertyValue(op.prop); if (re ? re.test(v) : v === op.text) next.push(el); } break; }
        case 'matches-attr': { const ar = needle(op.attr), vr = op.val && needle(op.val); for (const el of set) { for (const a of el.attributes) { if ((ar ? ar.test(a.name) : a.name === op.attr.text) && (!op.val || (vr ? vr.test(a.value) : a.value === op.val.text))) { next.push(el); break; } } } break; }
        case 'xpath': for (const el of set) { try { const r = document.evaluate(op.arg, el, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); for (let i = 0; i < r.snapshotLength; i++) { const n = r.snapshotItem(i); if (n.nodeType === 1) next.push(n); } } catch {} } break;
        case 'remove': for (const el of set) el.remove(); return [];
        case 'remove-attr': for (const el of set) el.removeAttribute(op.arg); return [];
        case 'remove-class': for (const el of set) el.classList.remove(op.arg); return [];
        case 'style': for (const el of set) for (const decl of op.arg.split(';')) { const i = decl.indexOf(':'); if (i > 0) el.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim(), 'important'); } return [];
        default: return [];
      }
      set = next;
      if (!set.length) break;
    }
    return set;
  }
  function scope(el, sel) { return /^\s*[>+~\s]/.test(sel) ? el.querySelectorAll(':scope' + sel) : (el.matches(sel) ? [el] : []); }
  function runProcedural() {
    const t = performance.now();
    for (const f of procedural) {
      let base;
      try { base = document.querySelectorAll(f.css); } catch { continue; }
      const hits = applyOps([...base], f.ops);
      for (const el of hits) if (!el.hasAttribute(HIDE_ATTR)) { el.setAttribute(HIDE_ATTR, ''); stats.procedural++; }
    }
    stats.cpuMs += performance.now() - t;
  }

  // ---- start ----
  chrome.runtime.sendMessage({ type: 'cosmetic', hostname, url: location.href }).then((res) => {
    if (!res || res.disabled || res.error) return;
    const t = performance.now();
    insertSelectors(res.hide);
    procedural = res.procedural;
    exceptions = res.exceptions;
    noGeneric = res.noGeneric;
    if (res.bench && window === top) window.addEventListener('load', () => setTimeout(() => chrome.runtime.sendMessage({ type: 'benchReport', url: location.href, stats: { ...stats, sinceStartMs: performance.now() - t0 } }).catch(() => {}), 2000), { once: true });
    stats.cpuMs += performance.now() - t;
    const start = () => {
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'class'] });
      pendingNodes.push(document.documentElement);
      schedule();
    };
    if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true });
    if (procedural.length) { document.addEventListener('DOMContentLoaded', runProcedural, { once: true }); window.addEventListener('load', runProcedural, { once: true }); }
  }).catch(() => {});

  // expose timing for the benchmark harness (read via CDP in the isolated world)
  Object.defineProperty(globalThis, '__veilStats', { get: () => ({ ...stats, sinceStartMs: performance.now() - t0 }) });
})();
