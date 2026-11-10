# Known limitations

Grouped by cause. Counts come from `build/build-report.json` for the current list snapshot.

## Imposed by Manifest V3 / declarativeNetRequest

| limitation | effect | count in current lists |
|---|---|---|
| No `$popup` blocking | DNR cannot cancel a window open; uBO (MV2) can | 3,014 filters skipped |
| No `$redirect-rule` | "redirect only if blocked by another rule" has no DNR form; dropped rather than turned into unconditional redirects | 171 skipped |
| `$domain=example.*` entity domains | `initiatorDomains` needs concrete hostnames | 70 filters skipped, 1,160 scriptlet rules not registered |
| RE2 regex only; 1,000 regex rules per extension | lookaround/backreference filters dropped; budget prioritised to exceptions and `$important` | 10 dropped for syntax, budget not hit (222 used) |
| 30,000 dynamic rules, 5,000 unsafe | runtime list updates can add at most ~20,000 network rules before the next release; redirects/CSP deltas capped at 5,000 | – |
| No request-time JavaScript | `$removeparam` with regex or negation, `$header`, `$replace`, `$urltransform`, `$urlskip`, `$cname`, `$ipaddress` unsupported | 219 `$urlskip`, 84 other options |
| `getMatchedRules` quota | blocked-count in the popup is only refreshed on popup open (user gesture), no live badge | – |
| Static rulesets are frozen in the package | cosmetic and scriptlet changes from list updates wait for an extension release; the updater only compiles **network** deltas into dynamic rules | by design |
| Scriptlet injection for runtime-added rules | `executeScript` at `onCommitted` can lose the race against inline page scripts; bundled scriptlets avoid this via registered MAIN-world scripts | user-filter scriptlets only |
| HTML filtering `##^` | Firefox-only API | 84 skipped |
| Blocked counts per request | DNR exposes `onRuleMatchedDebug` only for unpacked extensions; the logger infers blocks from `net::ERR_BLOCKED_BY_CLIENT` | logger only |

## Engine gaps (fixable, not yet done)

* **Procedural operators** `:watch-attr`, `:others`, `:matches-prop`, `:matches-media` are
  rejected (68 rules). Generic procedural rules (no domain) are rejected on purpose: they would run
  JavaScript on every page for a handful of rules.
* **Scriptlets not implemented** (see `UNSUPPORTED_SCRIPTLETS`): `abort-on-stack-trace` (84 hosts),
  `trusted-replace-xhr/fetch-response`, `json-edit*`, `trusted-replace-argument`,
  `trusted-suppress-native-method`, and a few one-offs — ~210 hostnames in total out of ~11,800
  that have scriptlet rules.
* `$csp` rules are applied with priority 1; a plain `@@` exception for the same site therefore
  disables them, which matches ABP but differs from uBO where `$csp` needs its own `@@…$csp`.
* `abort-current-script` checks `document.currentScript` only; uBO also inspects the stack.
* `$redirect` resources: audio/video stubs (`noopmp3-0.1s`, `noopmp4-1s`) are not bundled, so
  those filters fall back to plain blocking; some video players show an error instead of a blank
  1-second clip.
* IDN (non-ASCII) patterns are matched by the JS engine but not emitted as DNR rules.
* The element picker generates a selector from id/classes/`nth-of-type`; it does not offer the
  uBO-style slider through candidate selectors.
* `$removeparam` filters default to applying to main documents (useful) which also means a
  mis-written one can rewrite navigations; the options page reports every user filter that
  produced a rule.

## Observed in the benchmark

* **Admiral-style walls (e.g. bild.de).** EasyList blocks `html-load.com` only with `$document,popup`; Veil and uBO apply that literally and the Admiral SDK loads as a script. uBO Lite's ruleset compiler folds the domain into an all-types block and happens to avoid the wall. Veil does not add a site-specific rule for this; it is a list-content matter.
* **AdGuard MV3 defaults.** Only its Base and search-ads rulesets are enabled out of the box (Tracking Protection is off), which is why it scores 18 % against a reference that includes EasyPrivacy; its misses are almost all tracker hosts. Its two anti-adblock detections come from blocking the adsbygoogle bait without substituting a stub.
* **Headless bot walls.** Even with a normal UA, Akamai/CloudFront occasionally serve 403 pages to one of the five parallel loads (kohls.com, deviantart.com); the harness records them as text collapses, which the breakage review then discards.

## Benchmark limitations

* Headless Chrome with automation flags is treated differently by some sites (bot walls, consent
  interstitials, lightweight variants). Sites that fail to load in any configuration are excluded
  from paired comparisons; the per-config failure count is reported.
* "Breakage" is detected by proxies (text collapse, unplayable video, missing login/comments,
  error spikes) and reported as candidates. Confirming breakage needs a human; the harness saves a
  screenshot per site and configuration for that purpose. Login and checkout flows are not
  exercised automatically.
* Coverage is judged by Veil's own parser over the public lists. A classifier bug would affect every
  column equally, but it is still one classifier; the raw per-request data is kept so anyone can
  re-score with another engine.
* uBO (MV2) is hosted in Chrome 126, the last Chrome that runs MV2 unconditionally (Chrome 157 refuses
  it, Chrome 138 ignores the kill-switch flags, and Brave only re-enables MV2 for store-signed IDs,
  which we verified by loading uBO unpacked there: it loaded but blocked nothing). It is paired with a
  Chrome 126 no-blocker baseline; cross-batch load-time numbers are indicative only.
* Memory is measured as private bytes of the browser's process tree on an identical local page in
  every tab; it isolates extension overhead but not the effect of blocking real ad payloads.
* AdGuard and Ghostery download/compile their own lists at first start; the harness waits a fixed
  warm-up period, which may understate their coverage if initialisation is slower on a given
  machine. uBO Lite is measured in its default "Basic" mode, which does not inject cosmetic filters
  without per-site permission.
