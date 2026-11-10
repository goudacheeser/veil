const $ = (s) => document.querySelector(s);
const send = (m) => chrome.runtime.sendMessage(m);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function render() {
  const s = await send({ type: 'settings' });
  $('#build').textContent = `Version ${s.build.version}, lists compiled ${s.build.built}. Static rules: ${s.build.rulesets.reduce((n, r) => n + r.rules, 0)} in ${s.build.rulesets.length} rulesets.`;
  $('#groups').innerHTML = Object.entries(s.build.groups).map(([g]) => `<label><input type="checkbox" data-group="${g}" ${s.groups[g] ? 'checked' : ''}> ${g} <span class="muted">(${s.build.groups[g].lists.join(', ')})</span></label>`).join('');
  $('#groups').onchange = async () => {
    const groups = Object.fromEntries([...$('#groups').querySelectorAll('input')].map((i) => [i.dataset.group, i.checked]));
    await send({ type: 'setGroups', groups });
  };
  $('#lists').innerHTML = '<tr><th>List</th><th>Group</th><th>License</th><th>SHA-256 (bundled)</th><th>Rules</th></tr>' + s.build.lists.map((l) => {
    const rules = s.build.rulesets.filter((r) => r.list === l.name).reduce((n, r) => n + r.rules, 0);
    return `<tr><td>${l.url ? `<a href="${esc(l.url)}" style="color:#9cf">${esc(l.name)}</a>` : esc(l.name) + " (bundled)"}</td><td>${esc(l.group)}</td><td>${esc(l.license)}</td><td class="muted">${l.sha256.slice(0, 16)}…</td><td>${rules}</td></tr>`;
  }).join('');
  $('#user').value = s.userFilters;
  $('#userErrors').textContent = s.errors.join('\n');
  $('#sites').innerHTML = s.disabledSites.length ? s.disabledSites.map((d) => `<button data-site="${esc(d)}">${esc(d)} ✕</button>`).join('') : 'none';
  $('#sites').onclick = async (e) => { if (e.target.dataset.site) { await send({ type: 'toggleSite', hostname: e.target.dataset.site }); render(); } };
  $('#updEnabled').checked = !!s.updater.enabled; $('#updUrl').value = s.updater.url || '';
  $('#netlog').innerHTML = '<tr><th>Time</th><th>URL</th><th>Status</th><th>Bytes</th></tr>' + (s.netlog || []).map((n) => `<tr><td>${new Date(n.t).toISOString()}</td><td>${esc(n.url)}</td><td>${n.status}</td><td>${n.bytes}</td></tr>`).join('');
  $('#timing').textContent = `Index rehydration this worker lifetime: ${s.timing.rehydrateMs.toFixed(1)} ms · cosmetic lookups: ${s.timing.lookups} (${(s.timing.lookupMs / Math.max(1, s.timing.lookups)).toFixed(2)} ms avg) · logger matches: ${s.timing.matches || 0} (${((s.timing.matchMs || 0) / Math.max(1, s.timing.matches || 0) * 1000).toFixed(0)} µs avg)`;
}
$('#saveUser').onclick = async () => {
  $('#userStatus').textContent = 'saving…';
  const errors = await send({ type: 'setUserFilters', text: $('#user').value });
  $('#userErrors').textContent = (errors || []).join('\n');
  $('#userStatus').textContent = `saved${errors && errors.length ? `, ${errors.length} problem(s)` : ''}`;
};
$('#updSave').onclick = async () => { await send({ type: 'setUpdater', updater: { enabled: $('#updEnabled').checked, url: $('#updUrl').value.trim() } }); $('#updStatus').textContent = 'saved'; };
$('#updCheck').onclick = async () => {
  $('#updStatus').textContent = 'checking…';
  const r = await send({ type: 'checkUpdates' });
  $('#updStatus').textContent = r.error || r.skipped || `${(r.summary || []).join('; ')} → ${r.rules?.length || 0} dynamic rules applied, ${r.cosmeticDelta || 0} cosmetic/scriptlet lines deferred to next release`;
  render();
};
render();
