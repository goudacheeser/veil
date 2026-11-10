/* veil surrogate: googletagservices gpt.js */
(function () {
  const noop = () => {};
  const self = () => chain;
  const chain = { addService: self, setTargeting: self, clearTargeting: self, setCollapseEmptyDiv: self, defineSizeMapping: self, set: self, get: () => null, getSlotElementId: () => '', getAdUnitPath: () => '', setForceSafeFrame: self, setSafeFrameConfig: self, setClickUrl: self, updateTargetingFromMap: self, getTargeting: () => [], getTargetingKeys: () => [], getResponseInformation: () => null, getSlotId: () => ({ getDomId: () => '', getId: () => '' }), getSizes: () => [] };
  const sizeMapping = { addSize: () => sizeMapping, build: () => [] };
  const pubads = {
    addEventListener: () => pubads, removeEventListener: noop, enableSingleRequest: noop, enableAsyncRendering: noop, enableLazyLoad: noop, enableVideoAds: noop,
    collapseEmptyDivs: noop, disableInitialLoad: noop, display: noop, refresh: noop, clear: () => true, setTargeting: () => pubads, clearTargeting: () => pubads,
    getTargeting: () => [], getTargetingKeys: () => [], set: () => pubads, get: () => null, getAttributeKeys: () => [], setRequestNonPersonalizedAds: noop,
    setPrivacySettings: () => pubads, setPublisherProvidedId: () => pubads, setCentering: noop, setLocation: () => pubads, setCookieOptions: () => pubads,
    getSlots: () => [], getSlotIdMap: () => ({}), isInitialLoadDisabled: () => true, setForceSafeFrame: () => pubads, setSafeFrameConfig: () => pubads, updateCorrelator: () => pubads, setVideoContent: noop, getName: () => 'publisher_ads',
  };
  const googletag = window.googletag = window.googletag || {};
  const cmd = googletag.cmd || [];
  Object.assign(googletag, {
    apiReady: true, pubadsReady: true, _loaded_: true,
    pubads: () => pubads, companionAds: () => pubads, content: () => pubads, enums: { OutOfPageFormat: { TOP_ANCHOR: 1, BOTTOM_ANCHOR: 2, REWARDED: 3, INTERSTITIAL: 4 } },
    defineSlot: () => chain, defineOutOfPageSlot: () => chain, defineUnit: () => chain, destroySlots: () => true, display: noop, enableServices: noop, disablePublisherConsole: noop,
    getVersion: () => '2026', setAdIframeTitle: noop, setConfig: noop, getConfig: () => ({}), sizeMapping: () => sizeMapping, openConsole: noop, getEventLog: () => ({}),
    cmd: { push: (f) => { try { f(); } catch (e) {} return 1; }, unshift: (f) => { try { f(); } catch (e) {} return 1; }, length: 0 },
  });
  for (const f of cmd) { if (typeof f === 'function') { try { f(); } catch (e) {} } }
})();
