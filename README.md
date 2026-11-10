# Veil

An open-source Manifest V3 content blocker for Chromium with a complete ABP/uBO filter engine,
no telemetry, and a reproducible benchmark harness that measures it against uBlock Origin,
uBlock Origin Lite, AdGuard, Ghostery and Brave Shields.

* **Engine**: full network syntax (`||`, `^`, regex, all `$options` incl. `$redirect`,
  `$removeparam`, `$csp`, `$important`, `$badfilter`, `$denyallow`, `$to`), cosmetic filters with
  per-site exceptions, procedural filters (`:has-text`, `:matches-path`, `:upward`, `:matches-css`,
  `:matches-attr`, `:xpath`, `:remove`, `:style`, nested `:has`/`:not`), 46 scriptlets, hosts and
  domain-list formats, `!#if` preprocessor.
* **Blocking** via `declarativeNetRequest` static rulesets compiled at build time (117,507 enabled
  rules from EasyList, EasyPrivacy, uBO filters/privacy/badware/unbreak/quick-fixes, EasyList
  anti-adblock, Peter Lowe), plus dynamic rules for user filters, site toggles and list updates.
* **Cosmetic filtering** from a zero-parse binary index: hostname-keyed selectors, id/class-keyed
  generic selectors looked up incrementally with one message per animation frame, procedural
  filters evaluated in the same batch.
* **Scriptlets** registered as MAIN-world content scripts per hostname, so they run before page
  scripts.
* **Stateless service worker**: indexes are `Uint32Array` views over the bundled `.bin` files and
  open in a few milliseconds after every MV3 worker restart.
* **Privacy**: no network requests unless the user turns on list updates, which are Ed25519-signed
  and SHA-256-verified. Every request the extension makes is logged on the options page.
* **UI**: popup (site toggle, blocked count), options (list groups, user filters, updater, network
  log), logger (every request with the matching filter and "would-block" false negatives), element
  picker. Plain HTML, no dependencies.
* **License**: MIT for Veil's code. The bundled filter lists keep their own licenses (GPL-3.0 / CC BY-SA 3.0); see THIRD_PARTY_LICENSES.md.

## Build and run

```
npm install
npm run fetch-lists      # or use the hash-locked copies already in third_party/lists
npm run build            # dist/, veil-<version>.zip, veil-<version>.zip.sha256
npm test                 # unit tests
npx @puppeteer/browsers install chrome@stable --path bench/.browsers
node --test test/integration.test.js
```

Load `dist/` unpacked at `chrome://extensions`. Chrome 137+ (Ed25519 in WebCrypto, MAIN-world
registered scripts).

## Documentation

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): engine, binary format and why it is a flattened
  hash table rather than a radix trie, DNR mapping and priority ladder, rule-count budget, cosmetic
  and scriptlet pipelines, worker lifecycle.
* [docs/RESULTS.md](docs/RESULTS.md): benchmark results with raw data pointers.
* [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) and [docs/LIMITATIONS.md](docs/LIMITATIONS.md).
* [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## Benchmarks

```
node bench/corpus/make-corpus.js                 # 500 sites: news 100, video 75, shopping 100, social 50, long-tail 175 (Tranco sample, seeded)
node bench/run.js --configs=none,veil,ubol,adguard,ghostery --run=myrun
node bench/analyze.js --run=myrun                # tables + JSON in bench/results/
node bench/antiadblock/run.js                    # detector suite (BlockAdBlock/FuckAdBlock-style)
node bench/microbench.js                         # engine per-decision cost and index open time
node bench/memory.js --tabs=10,50,200            # memory / CPU of the browser process tree
```

Competitor builds are downloaded from their official GitHub releases into `bench/competitors/`
(checksums in `bench/competitors/SHA256SUMS`). uBO (MV2) is hosted in Chrome 126 (the last Chrome that
runs MV2 unconditionally) with its own baseline, because Chrome 157 no longer runs MV2.

## Honesty notes

The results document reports every metric where Veil loses and names which competitor is strongest
on each. Breakage numbers are heuristic candidates with screenshots for manual confirmation, not
confirmed breakage. Nothing in the code allowlists a publisher; Veil's only shipped rules are
`build/veil-defaults.txt` (11 generic surrogate rules, each explained).
