# Benchmark results: run batchA-chrome

Sites in corpus run: 500 (449 loaded in every configuration and are used for paired comparisons). Reference classifier: easylist, easyprivacy, ubo-filters, ubo-privacy, ubo-badware, ubo-quick-fixes, ubo-unbreak, easylist-antiadblock, peter-lowe, fanboy-annoyance, ubo-annoyances-cookies, ubo-annoyances-others compiled with Veil's engine; a request counts as an ad/tracker request if the reference engine would block it in that page context.

Labels: **none** = No blocker (Chrome); **veil** = Veil; **ubol** = uBlock Origin Lite (default "Basic" mode); **adguard** = AdGuard MV3; **ghostery** = Ghostery

## 1. Blocking coverage

| config | requests seen | ad/tracker requests | blocked | redirected (surrogate) | let through (false negatives) | coverage | non-ad requests blocked |
|---|---|---|---|---|---|---|---|
| none | 73591 | 24334 | 30 | 0 | 23985 (22789 third-party) | 0.1% | 18 |
| veil | 50292 | 5623 | 5017 | 550 | 575 (538 third-party) | 89.2% | 199 |
| ubol | 50065 | 5857 | 4856 | 652 | 972 (919 third-party) | 82.9% | 371 |
| adguard | 59250 | 12713 | 2330 | 67 | 10307 (9247 third-party) | 18.3% | 750 |
| ghostery | 50555 | 5436 | 4727 | 596 | 661 (604 third-party) | 87.0% | 410 |

Coverage = blocked ÷ ad requests observed in that configuration. A blocker that stops an ad script also prevents the requests that script would have made, so "requests seen" differs per configuration; the baseline column shows how many ad requests a page makes with nothing installed.

### Coverage by category

| category | none (blocked/ad reqs) | veil (blocked/ad reqs) | ubol (blocked/ad reqs) | adguard (blocked/ad reqs) | ghostery (blocked/ad reqs) |
|---|---|---|---|---|---|
| news | 0.0% (0/10339, 96 sites) | 89.4% (1598/1787, 96 sites) | 81.7% (1592/1949, 96 sites) | 19.9% (1051/5284, 96 sites) | 87.0% (1702/1956, 96 sites) |
| video | 0.1% (4/6008, 69 sites) | 81.8% (656/802, 69 sites) | 80.6% (649/805, 69 sites) | 21.4% (403/1885, 69 sites) | 81.9% (657/802, 69 sites) |
| shopping | 0.6% (22/3640, 97 sites) | 94.7% (1734/1832, 97 sites) | 84.6% (1637/1936, 97 sites) | 13.6% (441/3242, 97 sites) | 89.9% (1411/1569, 97 sites) |
| social | 0.1% (1/1144, 49 sites) | 93.0% (278/299, 49 sites) | 92.2% (273/296, 49 sites) | 16.0% (84/524, 49 sites) | 94.4% (304/322, 49 sites) |
| longtail | 0.1% (3/3203, 138 sites) | 83.2% (751/903, 138 sites) | 80.9% (705/871, 138 sites) | 19.7% (351/1778, 138 sites) | 83.0% (653/787, 138 sites) |

### Top hosts let through per config (false negatives)

- **veil**: geolocation.onetrust.com (73), global.ketchcdn.com (53), asset.fwcdn3.com (46), cdn.cookielaw.org (45), news.google.com (28), cdn-au.onetrust.com (26), cmp.osano.com (19), geo.privacymanager.io (15), static.addtoany.com (14), cdn-ukwest.onetrust.com (12), sdk.privacy-center.org (11), cdn.privacy-mgmt.com (10)
- **ubol**: tags.tiqcdn.com (95), geolocation.onetrust.com (77), siteintercept.qualtrics.com (63), global.ketchcdn.com (51), cdn.cookielaw.org (46), asset.fwcdn3.com (45), 0.stg.pick.frostplant.me (40), news.google.com (33), cdn-ukwest.onetrust.com (30), cdn-au.onetrust.com (29), geo.privacymanager.io (20), cmp.osano.com (19)
- **adguard**: www.googletagmanager.com (741), www.google.com (516), connect.facebook.net (206), analytics.google.com (196), www.google-analytics.com (185), events.newsroom.bi (181), tags.tiqcdn.com (170), assets.adobedtm.com (167), gm.mmstat.com (160), bam.nr-data.net (159), sb.scorecardresearch.com (155), fundingchoicesmessages.google.com (141)
- **ghostery**: geolocation.onetrust.com (60), cdn.cookielaw.org (46), asset.fwcdn3.com (45), news.google.com (33), cdn-ukwest.onetrust.com (29), cmp.osano.com (19), 0.pick.frostplant.me (18), cdn-au.onetrust.com (15), tags.tiqcdn.com (14), static.addtoany.com (14), tags.johnlewis.com (13), scripts.mediavine.com (11)

## 2. Breakage candidates (heuristic, needs manual confirmation)

Flags compare each blocker against the no-blocker load of the same site: visible text collapsing, video elements that were playable without a blocker, missing body, a jump in JS errors, login link or comment section disappearing. These are candidates, not confirmed breakage; see raw screenshots in the run directory.

| config | candidates | % of paired sites | sites |
|---|---|---|---|
| veil | 21 | 4.7% | 4anime.gg [empty body]<br>anime.nexus [text 16065→285]<br>banggood.com [js errors 0→13]<br>behance.net [js errors 0→8]<br>bild.de [text 20746→1414]<br>dailymail.co.uk [login link gone; comment section gone]<br>deviantart.com [text 12598→406; login link gone]<br>fandom.com [js errors 0→7]<br>foxnews.com [js errors 1→8]<br>goerie.com [js errors 0→5]<br>iheart.com [video not playable]<br>kohls.com [text 21540→195; login link gone]<br>next.co.uk [video not playable]<br>nordstrom.com [js errors 0→10]<br>ranobes.com [text 2241→80; login link gone; comment section gone] |
| ubol | 18 | 4.0% | 4anime.gg [empty body]<br>anime.nexus [text 16065→285]<br>banggood.com [js errors 0→15]<br>behance.net [js errors 0→8]<br>cabelas.com [empty body]<br>dailymail.co.uk [login link gone; comment section gone]<br>deviantart.com [text 12598→406; login link gone]<br>fandom.com [js errors 0→7]<br>foxnews.com [js errors 1→7]<br>next.co.uk [video not playable]<br>nordstrom.com [js errors 0→8]<br>rumble.com [text 3920→426; video not playable]<br>sfgate.com [login link gone]<br>telegraph.co.uk [text 2714→0; empty body; login link gone]<br>theguardian.com [js errors 0→18] |
| adguard | 16 | 3.6% | 4anime.gg [empty body]<br>axios.com [js errors 0→7]<br>bild.de [text 20746→1414]<br>bsky.app [text 11210→4357]<br>cabelas.com [empty body]<br>dailymail.co.uk [login link gone; comment section gone]<br>g2a.com [empty body]<br>huffpost.com [js errors 0→29]<br>linkedin.com [text 2775→130; login link gone]<br>ranobes.com [text 2241→80; login link gone; comment section gone]<br>rumble.com [text 3920→426; video not playable]<br>sfgate.com [login link gone]<br>telegraph.co.uk [text 2714→0; empty body; login link gone]<br>underarmour.com [video not playable]<br>uol.com.br [login link gone] |
| ghostery | 19 | 4.2% | 4anime.gg [empty body]<br>banggood.com [js errors 0→15]<br>behance.net [js errors 0→8]<br>bsky.app [text 11210→4357]<br>fandom.com [js errors 0→7]<br>foxnews.com [js errors 1→9]<br>g2a.com [empty body]<br>iheart.com [video not playable]<br>nordstrom.com [js errors 0→10]<br>rmg.co.uk [login link gone]<br>rumble.com [text 3920→15; video not playable]<br>sfgate.com [login link gone]<br>spiegel.de [js errors 0→5]<br>telegram.org [video not playable]<br>telegraph.co.uk [text 2714→0; empty body; login link gone] |

## 3. Page load time (navigation timing, paired sites)

| config | loadEventEnd median (ms) | p95 | DOMContentLoaded median | p95 | Δ median vs baseline | bytes transferred | JS errors | failed loads |
|---|---|---|---|---|---|---|---|---|
| none | 8359 | 23574 | 4285 | 14423 | 0 | 1804.2 MB | 348 | 48 |
| veil | 5786 | 16020 | 3000 | 9580 | -2573 | 1435.3 MB | 402 | 48 |
| ubol | 5784 | 16622 | 3185 | 9552 | -2575 | 1452.8 MB | 419 | 48 |
| adguard | 7437 | 20316 | 3607 | 11078 | -921 | 1733.1 MB | 380 | 48 |
| ghostery | 6601 | 18130 | 3536 | 10268 | -1758 | 1450.9 MB | 427 | 46 |

Raw data: `bench/results/raw/batchA-chrome/` (one JSON per site×config with every request and its fate, plus screenshots).