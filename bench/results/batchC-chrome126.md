# Benchmark results: run batchC-chrome126

Sites in corpus run: 500 (443 loaded in every configuration and are used for paired comparisons). Reference classifier: easylist, easyprivacy, ubo-filters, ubo-privacy, ubo-badware, ubo-quick-fixes, ubo-unbreak, easylist-antiadblock, peter-lowe, fanboy-annoyance, ubo-annoyances-cookies, ubo-annoyances-others compiled with Veil's engine; a request counts as an ad/tracker request if the reference engine would block it in that page context.

Labels: **none126** = No blocker (Chrome 126, baseline for ubo); **ubo** = uBlock Origin 1.76 (MV2, hosted in Chrome 126)

## 1. Blocking coverage

| config | requests seen | ad/tracker requests | blocked | redirected (surrogate) | let through (false negatives) | coverage | non-ad requests blocked |
|---|---|---|---|---|---|---|---|
| none126 | 82771 | 27993 | 12 | 0 | 25407 (24357 third-party) | 0.0% | 78 |
| ubo | 53198 | 5438 | 4537 | 609 | 857 (815 third-party) | 83.4% | 384 |

Coverage = blocked ÷ ad requests observed in that configuration. A blocker that stops an ad script also prevents the requests that script would have made, so "requests seen" differs per configuration; the baseline column shows how many ad requests a page makes with nothing installed.

### Coverage by category

| category | none126 (blocked/ad reqs) | ubo (blocked/ad reqs) |
|---|---|---|
| news | 0.0% (0/14208, 92 sites) | 84.9% (1594/1877, 92 sites) |
| video | 0.1% (5/5701, 69 sites) | 77.4% (651/841, 69 sites) |
| shopping | 0.1% (3/3413, 97 sites) | 85.3% (1422/1668, 97 sites) |
| social | 0.1% (1/970, 48 sites) | 93.0% (226/243, 48 sites) |
| longtail | 0.1% (3/3701, 137 sites) | 79.6% (644/809, 137 sites) |

### Top hosts let through per config (false negatives)

- **ubo**: geolocation.onetrust.com (70), tags.tiqcdn.com (54), siteintercept.qualtrics.com (47), global.ketchcdn.com (46), asset.fwcdn3.com (46), cdn.cookielaw.org (40), news.google.com (33), cdn-au.onetrust.com (31), cdn-ukwest.onetrust.com (30), ad.doubleclick.net (22), assets.adobedtm.com (20), geo.privacymanager.io (17)

## 2. Breakage candidates (heuristic, needs manual confirmation)

Flags compare each blocker against the no-blocker load of the same site: visible text collapsing, video elements that were playable without a blocker, missing body, a jump in JS errors, login link or comment section disappearing. These are candidates, not confirmed breakage; see raw screenshots in the run directory.

| config | candidates | % of paired sites | sites |
|---|---|---|---|
| ubo | 17 | 3.8% | 4anime.gg [empty body]<br>banggood.com [js errors 0→9]<br>behance.net [js errors 0→8]<br>bild.de [text 20729→1414]<br>deviantart.com [text 13390→406; login link gone]<br>fandom.com [js errors 0→8]<br>foxnews.com [js errors 1→6]<br>gamesradar.com [text 8888→0; empty body; comment section gone]<br>imdb.com [login link gone]<br>kohls.com [empty body; login link gone]<br>kroger.com [text 3159→0; empty body; login link gone]<br>pcgamer.com [text 13671→0; empty body; comment section gone]<br>peacocktv.com [login link gone]<br>scmp.com [text 21198→7308; login link gone]<br>telegraph.co.uk [js errors 1→11] |

## 3. Page load time (navigation timing, paired sites)

| config | loadEventEnd median (ms) | p95 | DOMContentLoaded median | p95 | Δ median vs baseline | bytes transferred | JS errors | failed loads |
|---|---|---|---|---|---|---|---|---|
| none126 | 3143 | 13603 | 1404 | 5887 | 0 | 2313.2 MB | 330 | 52 |
| ubo | 2381 | 11719 | 1378 | 5540 | -762 | 2620.4 MB | 380 | 53 |

Raw data: `bench/results/raw/batchC-chrome126/` (one JSON per site×config with every request and its fate, plus screenshots).