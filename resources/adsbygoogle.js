/* veil surrogate: googlesyndication adsbygoogle.js */
(function () {
  const ads = window.adsbygoogle = window.adsbygoogle || [];
  ads.loaded = true;
  ads.push = function (x) { try { if (x && typeof x.callback === 'function') x.callback(); } catch (e) {} return 0; };
  ads.requestNonPersonalizedAds = 0;
  ads.pauseAdRequests = 0;
  ads.onload = ads.onload || null;
  for (const el of document.querySelectorAll('ins.adsbygoogle')) {
    el.setAttribute('data-ad-status', 'filled');
    el.setAttribute('data-adsbygoogle-status', 'done');
  }
})();
