/* veil surrogate: google-analytics analytics.js / ga.js */
(function () {
  const noop = function () {};
  const tracker = { get: noop, set: noop, send: noop };
  const ga = function () {
    const a = arguments;
    const len = a.length;
    if (len === 0) return;
    const last = a[len - 1];
    if (last && typeof last === 'object' && typeof last.hitCallback === 'function') { try { last.hitCallback(); } catch (e) {} }
    else if (typeof last === 'function') { try { last(tracker); } catch (e) {} }
    else if (typeof a[0] === 'function') { try { a[0](tracker); } catch (e) {} }
  };
  ga.create = () => tracker; ga.getByName = () => tracker; ga.getAll = () => [tracker]; ga.remove = noop; ga.loaded = true;
  window.ga = window.ga || ga;
  window.gaplugins = { Linker: function () { return { decorate: (u) => u, passthrough: noop }; } };
  window._gaq = { push: function (x) { if (typeof x === 'function') { try { x(); } catch (e) {} } return 0; } };
  const dl = window.dataLayer;
  if (dl && dl.hide && typeof dl.hide.end === 'function') { try { dl.hide.end(); } catch (e) {} }
})();
