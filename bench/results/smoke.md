# Benchmark results: run smoke

Sites in corpus run: 4 (3 loaded in every configuration and are used for paired comparisons). Reference classifier: easylist, easyprivacy, ubo-filters, ubo-privacy, ubo-badware, ubo-quick-fixes, ubo-unbreak, easylist-antiadblock, peter-lowe, fanboy-annoyance, ubo-annoyances-cookies, ubo-annoyances-others compiled with Veil's engine; a request counts as an ad/tracker request if the reference engine would block it in that page context.

Labels: **none** = No blocker (Chrome); **veil** = Veil

## 1. Blocking coverage

| config | requests seen | ad/tracker requests | blocked | redirected (surrogate) | let through (false negatives) | coverage | non-ad requests blocked |
|---|---|---|---|---|---|---|---|
| none | 384 | 114 | 0 | 0 | 114 (107 third-party) | 0.0% | 0 |
| veil | 295 | 46 | 38 | 5 | 8 (8 third-party) | 82.6% | 1 |

Coverage = blocked ÷ ad requests observed in that configuration. A blocker that stops an ad script also prevents the requests that script would have made, so "requests seen" differs per configuration; the baseline column shows how many ad requests a page makes with nothing installed.

### Coverage by category

| category | none (blocked/ad reqs) | veil (blocked/ad reqs) |
|---|---|---|
| news | 0.0% (0/114, 3 sites) | 82.6% (38/46, 3 sites) |
| video | - | - |
| shopping | - | - |
| social | - | - |
| longtail | - | - |

### Top hosts let through per config (false negatives)

- **veil**: global.ketchcdn.com (8)

## 2. Breakage candidates (heuristic, needs manual confirmation)

Flags compare each blocker against the no-blocker load of the same site: visible text collapsing, video elements that were playable without a blocker, missing body, a jump in JS errors, login link or comment section disappearing. These are candidates, not confirmed breakage; see raw screenshots in the run directory.

| config | candidates | % of paired sites | sites |
|---|---|---|---|
| veil | 1 | 33.3% | foxnews.com [js errors 1→7] |

## 3. Page load time (navigation timing, paired sites)

| config | loadEventEnd median (ms) | p95 | DOMContentLoaded median | p95 | Δ median vs baseline | bytes transferred | JS errors | failed loads |
|---|---|---|---|---|---|---|---|---|
| none | 7663 | 13250 | 3365 | 5271 | 0 | 21.3 MB | 1 | 1 |
| veil | 7589 | 8621 | 3457 | 5392 | -74 | 21.8 MB | 7 | 1 |

Raw data: `bench/results/raw/smoke/` (one JSON per site×config with every request and its fate, plus screenshots).