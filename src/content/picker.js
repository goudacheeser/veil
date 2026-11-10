// Element picker: hover to highlight, click to choose, adjust, then create a cosmetic filter.
(() => {
  if (document.getElementById('veil-picker')) return;
  const host = document.createElement('div');
  host.id = 'veil-picker';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .box{position:fixed;border:2px solid #e33;background:rgba(238,51,51,.15);pointer-events:none;transition:all .05s}
      .panel{position:fixed;right:12px;bottom:12px;width:340px;background:#1e1e1e;color:#eee;font:13px system-ui;padding:10px;border-radius:6px;pointer-events:auto;box-shadow:0 4px 20px rgba(0,0,0,.5)}
      textarea{width:100%;height:60px;box-sizing:border-box;background:#111;color:#eee;border:1px solid #444;font:12px monospace}
      button{margin:6px 4px 0 0;padding:4px 10px;background:#333;color:#eee;border:1px solid #555;border-radius:4px;cursor:pointer}
      button.primary{background:#2a6}
    </style>
    <div class="box" hidden></div>
    <div class="panel"><div>Click an element to pick it. Esc cancels.</div><textarea hidden></textarea><div class="btns" hidden><button class="primary" data-a="create">Create</button><button data-a="parent">Pick parent</button><button data-a="preview">Preview</button><button data-a="cancel">Cancel</button></div></div>`;
  document.documentElement.appendChild(host);
  const box = root.querySelector('.box'), ta = root.querySelector('textarea'), btns = root.querySelector('.btns'), msg = root.querySelector('.panel div');
  let target = null, picked = null;

  const cssEscape = (s) => CSS.escape(s);
  function selectorFor(el) {
    if (el.id && document.querySelectorAll('#' + cssEscape(el.id)).length === 1) return '#' + cssEscape(el.id);
    const parts = [];
    for (let e = el; e && e !== document.body && e !== document.documentElement && parts.length < 4; e = e.parentElement) {
      let part = e.localName;
      const classes = [...e.classList].filter((c) => !/\d{3,}|^(active|hover|focus|open|visible)$/.test(c)).slice(0, 2);
      if (classes.length) part += classes.map((c) => '.' + cssEscape(c)).join('');
      else if (e.parentElement) { const i = [...e.parentElement.children].filter((c) => c.localName === e.localName).indexOf(e); if (i > 0) part += `:nth-of-type(${i + 1})`; }
      parts.unshift(part);
      if (e.id) { parts[0] = '#' + cssEscape(e.id) + (parts[0].startsWith(e.localName) ? parts[0].slice(e.localName.length) : ''); break; }
      if (document.querySelectorAll(parts.join(' > ')).length === 1) break;
    }
    return parts.join(' > ');
  }
  function highlight(el) {
    if (!el || el === host) { box.hidden = true; return; }
    const r = el.getBoundingClientRect();
    box.hidden = false;
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }
  function onMove(e) { if (picked) return; target = e.target; highlight(target); }
  function choose(el) {
    picked = el; highlight(el);
    ta.hidden = false; btns.hidden = false; msg.textContent = 'Filter (edit if needed):';
    ta.value = `${location.hostname}##${selectorFor(el)}`;
  }
  function onClick(e) { if (picked) return; e.preventDefault(); e.stopPropagation(); choose(e.target); }
  function cleanup() { document.removeEventListener('mousemove', onMove, true); document.removeEventListener('click', onClick, true); document.removeEventListener('keydown', onKey, true); host.remove(); }
  function onKey(e) { if (e.key === 'Escape') cleanup(); }
  root.querySelector('.btns').addEventListener('click', (e) => {
    const a = e.target.dataset.a;
    if (a === 'cancel') cleanup();
    else if (a === 'parent' && picked && picked.parentElement && picked.parentElement !== document.body) choose(picked.parentElement);
    else if (a === 'preview') { const sel = ta.value.split('##')[1]; try { for (const el of document.querySelectorAll(sel)) el.style.setProperty('display', 'none', 'important'); } catch {} }
    else if (a === 'create') { chrome.runtime.sendMessage({ type: 'addUserFilter', filter: ta.value.trim() }).then(() => { const sel = ta.value.split('##')[1]; try { for (const el of document.querySelectorAll(sel)) el.style.setProperty('display', 'none', 'important'); } catch {} cleanup(); }); }
  });
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
})();
