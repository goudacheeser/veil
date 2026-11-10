const $ = (s) => document.querySelector(s);
const send = (m) => chrome.runtime.sendMessage(m);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const params = new URLSearchParams(location.search);
let tabId = Number(params.get('tab')) || 0;

async function tabs() {
  const all = await chrome.tabs.query({});
  $('#tab').innerHTML = all.filter((t) => /^https?:/.test(t.url)).map((t) => `<option value="${t.id}" ${t.id === tabId ? 'selected' : ''}>${esc(t.title || t.url).slice(0, 60)}</option>`).join('');
  if (!tabId && all.length) tabId = Number($('#tab').value);
}
$('#tab').onchange = () => { tabId = Number($('#tab').value); };
const s = await send({ type: 'settings' });
$('#on').checked = s.logger;
$('#on').onchange = () => send({ type: 'logger', on: $('#on').checked });
$('#clear').onclick = () => send({ type: 'clearLog', tabId });

async function refresh() {
  const rows = await send({ type: 'getLog', tabId });
  const f = $('#filter').value.toLowerCase();
  const shown = rows.filter((r) => !f || r.url.toLowerCase().includes(f) || (r.match?.raw || '').toLowerCase().includes(f));
  $('#n').textContent = `${shown.length}/${rows.length}`;
  $('#t tbody').innerHTML = shown.slice(-800).reverse().map((r) => {
    let status = r.status;
    if (r.status === 'allowed' && r.match?.action === 'block') status = 'would-block';
    const cls = status === 'blocked' ? 'blocked' : status === 'would-block' ? 'would' : status === 'redirected' ? 'redirected' : r.match?.action === 'allow' ? 'allow' : '';
    return `<tr class="${cls}"><td>${esc(status)}${r.dnr ? ` <small>${esc(r.dnr)}</small>` : ''}</td><td>${esc(r.type)}</td><td title="${esc(r.url)}">${esc(r.url)}</td><td>${esc(r.initiator)}</td><td>${esc(r.match?.raw || '')}${r.match?.overrode ? ` <small>(over ${esc(r.match.overrode)})</small>` : ''}</td></tr>`;
  }).join('');
}
await tabs();
setInterval(refresh, 1000);
refresh();
