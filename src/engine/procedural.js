// Procedural cosmetic selector parser. Splits `css:has-text(x):upward(2)` into a plain CSS prefix
// plus a list of ops the content script evaluates in JS. Native pseudo-classes (:has, :not, :is)
// stay CSS unless their argument itself contains a procedural operator.
const PROCEDURAL = new Set([
  'has-text', 'matches-path', 'upward', 'matches-css', 'matches-css-before', 'matches-css-after',
  'min-text-length', 'matches-attr', 'xpath', 'remove', 'style', 'others', 'watch-attr', 'nth-ancestor',
  'if', 'if-not', 'has', 'not', 'matches-media', 'remove-attr', 'remove-class', 'matches-prop',
]);
const NATIVE_WRAPPERS = new Set(['has', 'not', 'if', 'if-not']);
const UNSUPPORTED = new Set(['watch-attr', 'others', 'matches-prop', 'matches-media']);

export function hasProceduralOperator(sel) {
  return /:(?:has-text|matches-path|upward|matches-css(?:-before|-after)?|min-text-length|matches-attr|xpath|remove|style|others|watch-attr|nth-ancestor|if|if-not|matches-media|remove-attr|remove-class|matches-prop)\(/.test(sel);
}

// returns { css, ops|null, error|null }
export function parseProcedural(selector) {
  selector = selector.trim();
  if (!hasProceduralOperator(selector)) {
    if (/\{|\}/.test(selector) && !/\[[^\]]*[{}]/.test(selector)) return { css: selector, ops: null, error: 'brace in selector' };
    return { css: selector, ops: null, error: null };
  }
  try {
    const parts = splitTopLevel(selector);
    const ops = [];
    let css = parts.shift();
    if (css.ops) { ops.push(css); css = ''; } // selector starts with an operator
    if (typeof css !== 'string') css = '';
    for (const p of parts) {
      if (typeof p === 'string') { ops.push({ op: 'spath', arg: p }); continue; }
      if (UNSUPPORTED.has(p.name)) return { css: selector, ops: null, error: `:${p.name}() not supported` };
      ops.push(compileOp(p));
    }
    if (!css && !ops.length) return { css: selector, ops: null, error: 'empty' };
    if (!css) css = '*';
    return { css, ops, error: null };
  } catch (e) {
    return { css: selector, ops: null, error: e.message };
  }
}

function compileOp(p) {
  const name = p.name === 'if' ? 'has' : p.name === 'if-not' ? 'not' : p.name === 'nth-ancestor' ? 'upward' : p.name;
  switch (name) {
    case 'has': case 'not': {
      const sub = parseProcedural(p.arg);
      if (sub.error) throw new Error(sub.error);
      if (!sub.ops) return { op: name, css: sub.css };
      return { op: name, css: sub.css, ops: sub.ops };
    }
    case 'has-text': return { op: 'has-text', ...needle(p.arg) };
    case 'matches-path': return { op: 'matches-path', ...needle(p.arg) };
    case 'upward': {
      const n = Number(p.arg);
      if (Number.isInteger(n)) { if (n < 1 || n > 256) throw new Error('upward out of range'); return { op: 'upward', n }; }
      return { op: 'upward', css: p.arg };
    }
    case 'min-text-length': { const n = Number(p.arg); if (!Number.isInteger(n) || n < 0) throw new Error('bad min-text-length'); return { op: 'min-text-length', n }; }
    case 'matches-css': case 'matches-css-before': case 'matches-css-after': {
      const i = p.arg.indexOf(':');
      if (i === -1) throw new Error('bad matches-css');
      return { op: 'matches-css', pseudo: name === 'matches-css' ? null : `::${name.slice(12)}`, prop: p.arg.slice(0, i).trim(), ...needle(p.arg.slice(i + 1).trim()) };
    }
    case 'matches-attr': {
      const i = p.arg.indexOf('=');
      const attr = needle(i === -1 ? p.arg : p.arg.slice(0, i));
      const val = i === -1 ? null : needle(unquote(p.arg.slice(i + 1)));
      return { op: 'matches-attr', attr, val };
    }
    case 'xpath': return { op: 'xpath', arg: p.arg };
    case 'remove': return { op: 'remove' };
    case 'remove-attr': return { op: 'remove-attr', arg: p.arg };
    case 'remove-class': return { op: 'remove-class', arg: p.arg };
    case 'style': {
      if (/[<>{}]|url\(|expression\(|@import/i.test(p.arg) || !/^[^:]+:/.test(p.arg)) throw new Error('unsafe :style()');
      return { op: 'style', arg: p.arg.replace(/\s*!important/g, '') };
    }
    default: throw new Error(`unknown operator :${name}`);
  }
}

function unquote(s) {
  s = s.trim();
  return s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'")) ? s.slice(1, -1) : s;
}

export function needle(arg) {
  arg = arg.trim();
  const m = /^\/(.+)\/([i]*)$/.exec(arg);
  if (m) { new RegExp(m[1], m[2]); return { re: m[1], flags: m[2] }; }
  return { text: arg };
}

// Split "a > b:has-text(x):upward(1) c" into ['a > b', {name:'has-text', arg:'x'}, {name:'upward', arg:'1'}, ' c']
function splitTopLevel(sel) {
  const parts = [];
  let cur = '';
  let i = 0;
  while (i < sel.length) {
    const c = sel[i];
    if (c === ':') {
      const m = /^:([a-z-]+)\(/i.exec(sel.slice(i));
      if (m && PROCEDURAL.has(m[1]) && (!NATIVE_WRAPPERS.has(m[1]) || hasProceduralOperator(sel.slice(i)))) {
        const start = i + m[0].length;
        const end = findClosingParen(sel, start - 1);
        if (end === -1) throw new Error('unbalanced parentheses');
        const inner = sel.slice(start, end);
        if (NATIVE_WRAPPERS.has(m[1]) && !hasProceduralOperator(inner)) { cur += sel.slice(i, end + 1); i = end + 1; continue; }
        if (cur) parts.push(cur);
        cur = '';
        parts.push({ name: m[1], arg: inner });
        i = end + 1;
        continue;
      }
    }
    if (c === '\\') { cur += sel.slice(i, i + 2); i += 2; continue; }
    if (c === '[' || c === '(' || c === '"' || c === "'") {
      const end = c === '[' ? findClosing(sel, i, '[', ']') : c === '(' ? findClosingParen(sel, i) : sel.indexOf(c, i + 1);
      if (end === -1) throw new Error('unbalanced selector');
      cur += sel.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur) parts.push(cur);
  if (parts.length && typeof parts[0] !== 'string') parts.unshift('');
  return parts.map((p, idx) => (typeof p === 'string' ? (idx === 0 ? p.trim() : p) : p));
}

function findClosingParen(s, open) { return findClosing(s, open, '(', ')'); }
function findClosing(s, open, oc, cc) {
  let depth = 0, quote = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '\\') { i++; continue; }
    if (c === oc) depth++;
    else if (c === cc && --depth === 0) return i;
  }
  return -1;
}
