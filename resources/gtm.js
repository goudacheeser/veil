/* veil surrogate: googletagmanager gtm.js */
(function () {
  const dl = window.dataLayer = window.dataLayer || [];
  if (dl.hide && typeof dl.hide.end === 'function') { try { dl.hide.end(); } catch (e) {} }
  for (const item of dl) { if (item && typeof item.eventCallback === 'function') { try { item.eventCallback(); } catch (e) {} } }
  const push = dl.push.bind(dl);
  dl.push = function (item) {
    if (item && typeof item.eventCallback === 'function') { try { setTimeout(item.eventCallback, 1); } catch (e) {} }
    return push(item);
  };
  window.google_tag_manager = window.google_tag_manager || { dataLayer: { reset: () => {}, get: () => undefined } };
})();
