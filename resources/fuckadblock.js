/* veil surrogate: fuckadblock.js / blockadblock.js — reports "no ad blocker" */
(function () {
  function Fab() {
    this._options = {}; this._var = { event: { detected: [], notDetected: [] } };
  }
  Fab.prototype.setOption = function () { return this; };
  Fab.prototype.check = function (loop) { const fns = this._var.event.notDetected; setTimeout(() => { for (const f of fns) { try { f(); } catch (e) {} } }, 1); return true; };
  Fab.prototype.emitEvent = function () { return this; };
  Fab.prototype.clearEvent = function () { this._var.event = { detected: [], notDetected: [] }; };
  Fab.prototype.on = function (detected, fn) { if (!detected && typeof fn === 'function') this._var.event.notDetected.push(fn); return this; };
  Fab.prototype.onDetected = function () { return this; };
  Fab.prototype.onNotDetected = function (fn) { return this.on(false, fn); };
  for (const name of ['fuckAdBlock', 'blockAdBlock', 'sniffAdBlock', 'FuckAdBlock', 'BlockAdBlock', 'SniffAdBlock']) {
    try {
      const inst = new Fab();
      Object.defineProperty(window, name, { configurable: true, get: () => (name[0] === name[0].toUpperCase() ? Fab : inst), set: () => {} });
    } catch (e) {}
  }
})();
