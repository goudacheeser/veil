# Benchmark results: run batchB-brave

Sites in corpus run: 500 (451 loaded in every configuration and are used for paired comparisons). Reference classifier: easylist, easyprivacy, ubo-filters, ubo-privacy, ubo-badware, ubo-quick-fixes, ubo-unbreak, easylist-antiadblock, peter-lowe, fanboy-annoyance, ubo-annoyances-cookies, ubo-annoyances-others compiled with Veil's engine; a request counts as an ad/tracker request if the reference engine would block it in that page context.

Labels: **brave-none** = Brave, shields off (control for ubo); **brave** = Brave Shields (default)

## 1. Blocking coverage

| config | requests seen | ad/tracker requests | blocked | redirected (surrogate) | let through (false negatives) | coverage | non-ad requests blocked |
|---|---|---|---|---|---|---|---|
| brave-none | 71444 | 23789 | 10 | 0 | 23406 (22346 third-party) | 0.0% | 23 |
| brave | 49634 | 5494 | 3603 | 0 | 1869 (1011 third-party) | 65.6% | 320 |

Coverage = blocked ÷ ad requests observed in that configuration. A blocker that stops an ad script also prevents the requests that script would have made, so "requests seen" differs per configuration; the baseline column shows how many ad requests a page makes with nothing installed.

### Coverage by category

| category | brave-none (blocked/ad reqs) | brave (blocked/ad reqs) |
|---|---|---|
| news | 0.0% (0/10803, 99 sites) | 67.8% (1447/2135, 99 sites) |
| video | 0.1% (4/5134, 69 sites) | 61.8% (407/659, 69 sites) |
| shopping | 0.1% (2/3250, 97 sites) | 65.4% (1128/1724, 97 sites) |
| social | 0.1% (1/1142, 49 sites) | 67.4% (186/276, 49 sites) |
| longtail | 0.1% (3/3460, 137 sites) | 62.1% (435/700, 137 sites) |

### Top hosts let through per config (false negatives)

- **brave**: www.googletagmanager.com (308), securepubads.g.doubleclick.net (92), aplus.aliexpress.us (52), www.wish.com (52), static.chartbeat.com (50), siteintercept.qualtrics.com (48), asset.fwcdn3.com (45), pagead2.googlesyndication.com (39), c.amazon-adsystem.com (33), news.google.com (32), tags.tiqcdn.com (29), www.lowes.com (24)

## 2. Breakage candidates (heuristic, needs manual confirmation)

Flags compare each blocker against the no-blocker load of the same site: visible text collapsing, video elements that were playable without a blocker, missing body, a jump in JS errors, login link or comment section disappearing. These are candidates, not confirmed breakage; see raw screenshots in the run directory.

| config | candidates | % of paired sites | sites |
|---|---|---|---|
| brave | 17 | 3.8% | 4anime.gg [empty body]<br>abcnews.go.com [comment section gone]<br>behance.net [js errors 0→7]<br>comparably.com [text 3454→134; login link gone; comment section gone]<br>dailymail.co.uk [empty body]<br>elpais.com [text 21703→0; login link gone]<br>fandom.com [js errors 0→7]<br>kroger.com [empty body; login link gone]<br>lanacion.com.ar [video not playable]<br>nbcnews.com [js errors 2→21]<br>odysee.com [comment section gone]<br>ok.ru [js errors 0→14]<br>rmg.co.uk [login link gone]<br>scmp.com [text 20504→7044; login link gone]<br>sfgate.com [login link gone] |

## 3. Page load time (navigation timing, paired sites)

| config | loadEventEnd median (ms) | p95 | DOMContentLoaded median | p95 | Δ median vs baseline | bytes transferred | JS errors | failed loads |
|---|---|---|---|---|---|---|---|---|
| brave-none | 3344 | 18448 | 1899 | 7731 | 0 | 1973.0 MB | 282 | 46 |
| brave | 2766 | 13639 | 1701 | 6232 | -578 | 1520.1 MB | 374 | 48 |

Raw data: `bench/results/raw/batchB-brave/` (one JSON per site×config with every request and its fate, plus screenshots).