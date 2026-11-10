const $ = (s) => document.querySelector(s);
const send = (m) => chrome.runtime.sendMessage(m);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let hostname = '';
try { hostname = new URL(tab.url).hostname; } catch {}
$('#site').textContent = hostname || tab.url;

async function refresh() {
  if (!hostname) { $('#toggle').disabled = true; $('#toggle').textContent = 'n/a'; return; }
  const { enabled } = await send({ type: 'siteState', hostname });
  $('#toggle').textContent = enabled ? 'On' : 'Off';
  $('#toggle').className = enabled ? 'on' : 'off';
}
$('#toggle').onclick = async () => { await send({ type: 'toggleSite', hostname }); await refresh(); chrome.tabs.reload(tab.id); };
refresh();

try {
  const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId: tab.id });
  $('#count').textContent = rulesMatchedInfo.length;
} catch (e) { $('#count').textContent = '?'; $('#info').textContent = e.message; }

const s = await send({ type: 'settings' });
$('#info').textContent = `v${s.build.version} · lists ${s.build.built.slice(0, 10)} · ${Object.entries(s.groups).filter(([, v]) => v).map(([k]) => k).join(', ')}`;
$('#pick').onclick = async () => { await send({ type: 'pick' }); window.close(); };
$('#log').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL(`ui/logger.html?tab=${tab.id}`) });
$('#opts').onclick = () => chrome.runtime.openOptionsPage();
