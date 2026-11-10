/* veil surrogate: amazon ads.js */
(function () {
  if (window.amznads) return;
  const noop = () => {};
  window.amznads = { appendScriptTag: noop, appendTargetingToAdServerUrl: noop, appendTargetingToQueryString: noop, clearTargetingFromGPTAsync: noop, doAllTasks: noop, doGetAdsAsync: noop, doTask: noop, detectIframeAndGetURL: noop, getAds: noop, getAdsAsync: noop, getAdForSlot: noop, getAdsCallback: noop, getDisplayAds: noop, getDisplayAdsAsync: noop, getDisplayAdsCallback: noop, getKeys: () => [], getReferrerURL: noop, getScriptSource: noop, getTargeting: noop, getTokens: noop, getValidMilliseconds: noop, getVideoAds: noop, getVideoAdsAsync: noop, getVideoAdsCallback: noop, handleCallBack: noop, hasAds: () => false, renderAd: noop, saveAds: noop, setTargeting: noop, setTargetingForGPTAsync: noop, setTargetingForGPTSync: noop, tryGetAdsAsync: noop, updateAds: noop };
  window.amzn_ads = window.amzn_ads || noop;
  window.aax_write = window.aax_write || noop;
  window.aax_render_ad = window.aax_render_ad || noop;
})();
