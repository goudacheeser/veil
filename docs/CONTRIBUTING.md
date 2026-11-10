# Contributing

## Setup

```
npm install                 # puppeteer-core + @puppeteer/browsers, harness only; the extension has no dependencies
npm run fetch-lists         # downloads lists named in build/lists.json, writes third_party/lists.lock.json
npx @puppeteer/browsers install chrome@stable --path bench/.browsers   # pinned Chrome for tests/benchmarks
npm run build               # dist/ + veil-<version>.zip + .sha256
npm test                    # unit tests (parser, matcher, cosmetic index, DNR compiler)
node --test test/integration.test.js   # loads dist/ in headless Chrome; needs port 80 free
```

Load `dist/` as an unpacked extension (`chrome://extensions` → Developer mode → Load unpacked).

## Layout

```
src/engine/      parser, procedural selectors, tokenizer, binary format, matcher, DNR compiler, compile
src/background/  service worker, updater
src/content/     cosmetic content script, scriptlet library, element picker
src/ui/          popup, options, logger (plain HTML + ES modules)
resources/       redirect stubs ($redirect targets)
build/           build pipeline, lists manifest, veil-defaults.txt, dev signing key (gitignored key material lives here)
bench/           harness (run.js), analyzer, corpus, competitor configs, anti-adblock suite, microbench, memory
test/            node:test suites + fixtures
third_party/     downloaded lists (hash-locked) and public suffix list
docs/            architecture, threat model, limitations, results
```

## Rules of the road

* **No dependencies in the extension.** The `dist/` tree contains only our code and data.
* **Everything unsupported is counted.** If you add a syntax branch, make sure the fallback puts
  the line into `unsupported` with a reason; `build/build-report.json` must stay honest.
* **Parser and compiler changes need a unit test**; anything that changes what the browser does
  needs an assertion in `test/integration.test.js`.
* **No publisher allowlists.** Exceptions belong in the lists or in the user's filters. The only
  shipped Veil-authored rules are generic and live in `build/veil-defaults.txt` with an explanation.
* **Lists are reviewed, not auto-bumped.** `npm run fetch-lists -- --update` accepts new upstream
  hashes; commit the lock file change separately with a note on what changed.
* **Benchmarks are reproducible.** A results table must link the run directory under
  `bench/results/raw/` and the corpus commit. Never edit the harness to make a number move.

## Updating lists and releasing

1. `npm run fetch-lists -- --update`, review the lock diff.
2. `npm run build`, run both test suites.
3. `node bench/run.js --limit=50` as a smoke run; `node bench/analyze.js`.
4. Tag, publish `veil-<version>.zip` + `.sha256`, and (for the updater) `dist/lists.lock.json`
   and `dist/lists.lock.sig` signed with the **release** key, not the dev key in `build/keys/`.

## Licensing of contributions

MIT for code. The ingested lists are GPL-3.0 (uBO filters), GPL-3.0/CC BY-SA 3.0 dual (EasyList,
EasyPrivacy, Fanboy, anti-adblock) and the McRae GPL (Peter Lowe); their compiled form in a release
stays under those terms (see THIRD_PARTY_LICENSES.md). List headers and licenses are preserved in
`build.json` and shown in the options page.
