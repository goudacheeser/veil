/* veil surrogate: amazon apstag.js */
(function () {
  const noop = () => {};
  const apstag = window.apstag = window.apstag || {};
  const q = apstag._Q || [];
  Object.assign(apstag, {
    _Q: { push: noop }, init: noop, debug: noop, setDisplayBids: noop, targetingKeys: () => [], renderImp: noop, punt: noop,
    fetchBids: (cfg, cb) => { if (typeof cb === 'function') setTimeout(() => { try { cb([]); } catch (e) {} }, 1); },
  });
  for (const [name, args] of q) { if (name === 'f' && args && typeof args[1] === 'function') { try { args[1]([]); } catch (e) {} } }
})();
