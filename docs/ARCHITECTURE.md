# Architecture

Veil is a Manifest V3 content blocker. The design goal is simple: do the blocking in the browser's
own declarative engine, keep the service worker stateless, and push all expensive work to build
time, where it runs once instead of on every browser start.

```
build time                                   runtime (extension)
──────────────────────────────────────────   ──────────────────────────────────────────────────────
lists.json ─▶ fetch-lists ─▶ third_party/     declarativeNetRequest ◀── rulesets/*.json (static)
   (hash-locked)                 lists/              ▲                ◀── dynamic rules (user filters,
                                    │                │                    site toggles, list deltas)
                        engine/parser.js             │
                                    │           background/sw.js ──▶ index/*.cosmetic.bin (zero-parse)
                        engine/compile.js            ▲   │           index/*.network.bin (logger, diff)
                 ┌──────────┼───────────┐            │   ▼
          rulesets/*.json  index/*.bin  scriptlets/  │  content/cosmetic.js (ISOLATED world)
          (DNR)            (binary)     *.js (MAIN)  │  content/picker.js   (on demand)
                                                     └─ ui/ popup · options · logger
```

## 1. Filter engine (`src/engine/`)

* `parser.js` turns one list line into a plain object. It handles the ABP network syntax
  (`||`, `|`, `^`, `*`, regex literals, `@@`, all `$options`), cosmetic rules (`##`, `#@#`, `#?#`,
  AdGuard `#$#` CSS injection, brace-style `##sel {decl}`), scriptlets (`##+js(...)` with alias
  normalisation), hosts-file and bare-domain lines, and `!#if/!#else/!#endif` preprocessor
  directives evaluated for a Chromium/MV3 environment. Anything it cannot express is returned in
  `unsupported` with a reason, never silently dropped.
* `procedural.js` splits a cosmetic selector into a plain CSS prefix plus a chain of operators
  (`:has-text`, `:matches-path`, `:upward`, `:matches-css`, `:matches-attr`, `:min-text-length`,
  `:xpath`, `:remove`, `:style`, `:has`/`:not` with procedural arguments). Native `:has()`/`:not()`
  stay in CSS. The output is JSON the content script can evaluate without re-parsing.
* `compile.js` merges lists, applies `$badfilter`, dedupes, and emits three things: the binary
  indexes, DNR rulesets per list, and scriptlet bundles. It also produces the "unsupported" and
  "skipped for DNR" reports that `build/build-report.json` records.
* `dnr.js` maps one network filter to one `declarativeNetRequest` rule (see §3).
* `matcher.js` is the reference matcher used by the logger, the list-update diff and the benchmark.
* `cosmetic-index.js`, `psl.js`, `url.js` are lookup helpers over the binary.

### Why the JS matcher exists when DNR does the blocking

DNR is opaque: there is no API to ask "would this request be blocked and by which filter" except
`testMatchOutcome`, which is slow and rate-limited. The matcher gives the logger a
filter-level explanation, lets the updater compute list deltas, and gives the benchmark a single
yardstick to judge every blocker (including Veil) against. It is never on the request path.

## 2. Binary index format (`binary.js`)

Everything is a `Uint32Array` view over one `ArrayBuffer`:

```
'VEIL' u32 version u32 nSections { id, byteOffset, byteLength }*
STRINGS   u32 count, u32 offsets[count+1], utf8 bytes
TABLE     u32 count, u32 hashes[count] (sorted, unique), u32 valueOffsets[count+1], u32 values[]
```

A TABLE is a hash map flattened into two sorted arrays. Keys are FNV-1a hashes of lowercased
strings; a lookup is a binary search (`⌈log₂ n⌉` comparisons, 17 for the 100k-key token index)
followed by a slice of the value run. Tables that must be exact (hostnames, PSL rules) store
`(keyStringId, value)` pairs and verify the key string on hit, so hash collisions can only cost
one extra string compare. Token tables (network filters) skip verification: a collision there
only means one extra filter gets tested.

**Why not a radix trie / FST.** The task brief asked for one; we measured and chose otherwise.
Lookups here are of two kinds: *exact* (token hash, PSL rule) and *suffix walk* (hostname →
parent → grandparent). A trie answers "longest matching suffix" in one walk, O(L) in label
length; a hash table answers it in ≤L exact lookups, also O(L), and L ≤ 8 for real hostnames. The
hash table wins on constant factors in JavaScript (one `Math.imul` loop and a binary search over a
contiguous `Uint32Array`, versus pointer chasing through node offsets), needs no node layout, and
serialises to 4 bytes/key. The measured cost of a full cosmetic lookup for a hostname, including
entity form and site flags, is ~10 µs median (`bench/results/microbench.json`). A trie would save
the ≤8 probes but not the string decode, which dominates.

Sizes (current build): `core.cosmetic.bin` 1.9 MB (loaded on the first page of a worker
lifetime), `core.network.bin` 11.5 MB (only when the logger or updater runs). Opening either is
under 3 ms: the reader only wraps views, it does not parse.

### Network records

Six `u32` per filter: `patternStr, flags|types<<16, domainListId, toListId, modifierStr, rawStr`.
Flags mark fast paths: `HOST_ONLY` (`||host^` → suffix compare, no regex), `PLAIN` (substring),
otherwise a lazily compiled `RegExp` cached per filter. Each filter is indexed under its rarest
"full" token (a token that cannot be a fragment of a longer URL token: not adjacent to `*`, not
at an unanchored edge), computed with a two-pass frequency count at compile time. Filters without
a usable token (regex filters, `$domain`-only filters) go into the always-tested bucket (`ANY_TOKEN`).

Match procedure: tokenize URL (≤64 tokens) → scan block buckets, returning early on `$important`
→ if blocked, scan exception buckets. Per-decision cost: median 25 µs, p95 78 µs in Node on 74k real
recorded request URLs (`bench/microbench.js`). This matters only for the logger; DNR decides live
requests inside Chromium.

## 3. Network blocking: declarativeNetRequest

### Mapping

| ABP | DNR |
|---|---|
| `\|\|host^path`, `\|exact`, `*`, `^` | `urlFilter` (same syntax) |
| `/regex/` | `regexFilter` (RE2; lookaround/backrefs skipped) |
| `$script,image,…` / `$~type` | `resourceTypes`; untyped filters omit it, which is DNR's "everything but main_frame", matching ABP |
| `$third-party` / `$1p` | `domainType` |
| `$domain=a\|~b` | `initiatorDomains` / `excludedInitiatorDomains` |
| `$to=`, `$denyallow=` | `requestDomains` / `excludedRequestDomains` |
| `$method=` | `requestMethods` |
| `@@` | `allow`; `@@…$document` → `allowAllRequests` on main_frame/sub_frame |
| `$redirect=name` | `redirect.extensionPath` to a bundled stub (`resources/`); unknown stub → plain block |
| `$removeparam=p` / `$removeparam` | `redirect.transform.queryTransform.removeParams` / `transform.query=''` |
| `$csp=…`, `$inline-script`, `$inline-font` | `modifyHeaders` append `Content-Security-Policy` |
| `$important` | priority 3 |
| `$badfilter` | removes the target at compile time |
| `$elemhide`/`$generichide`/`$specifichide` | not network: become per-site flags in the cosmetic index |

### Priorities and tie-breaks

DNR picks the highest priority rule; on ties it prefers `allow > block > redirect > modifyHeaders`.
Veil uses a four-rung ladder, **block = 1, redirect = 2, exception = 2, `$important` = 3**, which
reproduces ABP semantics: an exception beats a block (tie at 1 would too, but exceptions must also
beat redirects, so they sit at 2 where the tie-break still favours `allow`); a redirect beats the
plain block for the same URL (at equal priority DNR would pick `block` and surrogates would never
fire, which is exactly the bug the integration test caught); `$important` beats everything.

### Rule-count caps and how we stay inside them

Chrome guarantees 30,000 static rules (`GUARANTEED_MINIMUM_STATIC_RULES`) and allows up to 330,000
across all enabled rulesets of all extensions (`MAX_NUMBER_OF_STATIC_RULES`), at most 100 rulesets
per extension with 50 enabled, 1,000 regex rules, 30,000 dynamic rules of which 5,000 may be
"unsafe" (redirect/modifyHeaders). Current build: **117,507 enabled static rules in 15 rulesets**
(EasyList and EasyPrivacy are split into two rulesets each because the build caps a ruleset at
30,000). Each list is its own ruleset so the options page can toggle a group with
`updateEnabledRulesets` without recompiling. 222 regex rules are emitted; exceptions and
`$important` rules are kept first if the budget is ever exceeded.

What cannot be expressed is reported, not hidden (`build/build-report.json`, `dnrSkipped`):
`$popup` (3,014 filters: no DNR equivalent), cosmetic-only exceptions (688, handled by the cosmetic
engine), `$redirect-rule` (171: "redirect only if some other rule blocks" has no DNR form), entity
domains `example.*` in `$domain` (70), regex removeparam (5), non-RE2 regexes (10).

### Dynamic rules

Three id ranges share the 30,000 dynamic-rule budget: 1–9,999 user filters (compiled with the same
`dnr.js`), 10,000–19,999 site toggles (`allowAllRequests` + `allow` by initiator, priority 1000),
20,000+ list-update deltas. Updates are the "dynamic ruleset compiler" the brief asks for: the
updater fetches lists, discards every line the bundled index already knows (`KNOWN_LINES` section,
a sorted hash set), parses the remainder and emits dynamic rules. Cosmetic and scriptlet deltas
are *not* applied at runtime (see LIMITATIONS); they ship with the next extension release.

## 4. Cosmetic filtering

Three layers, cheapest first:

1. **Always-on generic CSS** (`index/<group>.generic.css`): generic selectors with no id/class
   key (attribute selectors like `a[href^="https://ads."]`), ~800 rules, registered as a content
   style sheet at `document_start` with `excludeMatches` for hosts carrying `$generichide`/`$elemhide`
   and for user-disabled sites. Zero JavaScript.
2. **Hostname-specific selectors**: the content script asks the worker once per frame
   (`{type:'cosmetic', hostname}`); the worker walks the hostname's suffixes and entity form
   through the `COSM_SPECIFIC` table and returns hide selectors, procedural filters, per-site
   generic exceptions and flags. The content script inserts them as one stylesheet in chunks of 32
   selectors, splitting a chunk only if the browser rejects it, so one bad selector never disables
   the rest.
3. **Keyed generic selectors**: ~41,000 generic rules keyed by the id or class they require
   (`genericKey()` picks an id first, then a class, from any compound of the selector). The content
   script collects ids/classes present in the DOM, batches new ones per animation frame, sends them
   to the worker and inserts whatever comes back. A `MutationObserver` on `childList` and
   `id`/`class` attributes feeds the same batch; work is coalesced to one message per frame.

Procedural filters are evaluated in the same per-frame batch. Matches get a `data-veil-hide`
attribute and one stylesheet rule hides them; `:style()` writes inline `!important` declarations,
`:remove()` removes. Nothing on the page can observe the extension except through the hiding
itself.

## 5. Scriptlets

Lists reference scriptlets by name (`##+js(set-constant, foo, true)`). The build groups them by
scriptlet name and emits one file per name: the implementation (`src/content/scriptlets.js`,
stringified), a `hostname → [args…]` map and an exception map. Each file is registered with
`chrome.scripting.registerContentScripts` in the **MAIN world at `document_start`**, with `matches`
set to exactly the hostnames that need it, so a page never loads a scriptlet it does not use and the
scriptlet runs before any page script. Registration persists across sessions, so a worker restart
costs nothing. User-filter scriptlets (and anything that cannot be registered statically) are
injected on `webNavigation.onCommitted` with `executeScript({world:'MAIN', injectImmediately:true})`;
that path is racy by nature and is used only as a fallback. `trusted-*` scriptlets are accepted
from bundled lists only, never from user filters.

## 6. Service worker lifecycle

MV3 terminates the worker after ~30 s idle. Veil keeps no state that cannot be rebuilt in
milliseconds: settings in `chrome.storage.local`, indexes re-opened from the extension package
(`fetch` + wrap, no parse), DNR rules and content-script registrations owned by Chrome. The only
in-memory state is the logger's request table and benchmark counters, both explicitly transient.

## 7. UI

Popup (site toggle, blocked count via `getMatchedRules`, shortcuts), options (list groups, user
filters with per-line errors, disabled sites, updater, the extension's own network log, engine
timing) and logger (observational `webRequest` listeners, active only while the logger page is
open, each request annotated with the matcher's verdict so DNR false negatives stand out as
"would-block"). The element picker is a shadow-DOM overlay injected on demand that builds a
selector, previews it, and appends `hostname##selector` to user filters. No frameworks, no
external dependencies.
