# Threat model

## Assets

1. The user's browsing data: URLs, page content, cookies, the set of sites they visit.
2. The integrity of pages: a blocker that can hide or rewrite content can also be used to inject it.
3. The filter lists: whoever controls them controls what is blocked, redirected or injected
   (scriptlets run in the page's main world).
4. The extension package itself.

## Adversaries

| adversary | capability | goal |
|---|---|---|
| Web page / ad script | runs in the page, sees the DOM, can probe for blockers | detect or evade blocking, fingerprint the user |
| Network attacker | MITM on list downloads (if updates are enabled) | ship malicious filters / scriptlets |
| Malicious list maintainer or compromised list host | controls list content | same, with a valid TLS connection |
| Malicious user filter (copy-pasted "fix") | arbitrary filter text | run scriptlets with trusted-only power |
| Extension author / build pipeline | ships the package | telemetry, hidden allowlists |

## What Veil does

**No telemetry, no remote calls by default.** The extension makes zero network requests unless the
user enables the updater and enters a URL. Every request it ever makes is recorded in
`storage.local.netlog` and shown on the options page. The integration test asserts the log is empty
after a full page load (`test/integration.test.js`, "privacy"). The benchmark harness records every
request Chrome makes with Veil installed; none go to Veil-controlled hosts because there are none.

**Hash-locked lists at build time.** `build/fetch-lists.js` writes `third_party/lists.lock.json`
with the SHA-256 of each list; `build/build.js` refuses to build if a list on disk does not match
the lock. A release therefore corresponds to exactly the list bytes a maintainer reviewed. The
lock, the per-list hashes and the licenses are shown in the options page.

**Signed updates.** When the updater is enabled it fetches `lists.lock.json` and an Ed25519
signature from the configured base URL, verifies the signature against the public key bundled at
build time (`updater-key.json`), then fetches each list and verifies its SHA-256 against the signed
lock before parsing a single line. A list host (easylist.to, GitHub) or a MITM cannot inject
filters; only the holder of the release signing key can. The development key in `build/keys/` is
generated on first build and must be replaced by a release key kept offline.

**Scriptlet privilege separation.** `trusted-*` scriptlets (which can set arbitrary cookies,
storage values, click elements) are compiled only from bundled, hash-locked lists. User filters
may use the untrusted set only; the parser accepts the syntax but the worker refuses to inject
`trusted-*` names from user filters. `:style()` arguments are rejected if they contain `url(`,
`expression(`, `@import` or angle brackets. Cosmetic selectors are inserted with `insertRule`,
never via `innerHTML`.

**No hidden allowlists.** There is no acceptable-ads list, no per-publisher exception compiled
into the code, and the DNR rules are plain JSON in `dist/rulesets/` that anyone can diff against
the source lists. Site exceptions come only from the lists (visible, with license) or the user
(options page). Veil's own `build/veil-defaults.txt` is 11 generic surrogate rules, each
explained in the file header.

**Minimal fingerprinting surface.** The content script adds one `<style data-veil>` element and
`data-veil-hide` attributes on hidden elements, the same class of signal every blocker emits;
the benchmark stats hook only reports when `storage.benchmark` is set and only to the worker.
No global variables are exposed to the page by the ISOLATED-world script. Scriptlets necessarily
modify page globals; that is their purpose and is detectable, as with every blocker.

**Permissions.** `<all_urls>` host permission (needed for cosmetic filtering and DNR on all sites),
`declarativeNetRequest`/`Feedback`, `scripting`, `storage`/`unlimitedStorage`, `tabs`,
`webNavigation` (scriptlet fallback), `webRequest` (observational logger only; listeners are
registered only while the logger is open), `alarms` (reserved for scheduled update checks).
`webRequestBlocking` is not requested and would not be granted.

## What Veil does not defend against

* A compromised **build machine or signing key**. Mitigation is procedural: reproducible builds
  (`veil-<version>.zip` is deterministic, with a published SHA-256) let anyone rebuild from the
  tagged source and compare.
* **Malicious content in a legitimately signed list.** The lists are third-party code; Veil runs
  their scriptlets. This is inherent to list-based blocking and identical for every blocker.
* **Fingerprinting of the blocker's presence.** A page can always detect that an element was
  hidden or a request failed. Veil ships generic surrogates (`veil-defaults.txt`) and list-provided
  scriptlets to defeat common detectors but does not attempt to be undetectable.
* **CNAME-cloaked trackers.** MV3 exposes no DNS information; DNR matches the URL hostname only.
* **Requests the browser makes outside DNR's reach** (some service-worker-initiated fetches on
  older Chromium, WebRTC, extension-to-extension traffic).
* **Chrome Web Store review** is not evaded or gamed; there is no obfuscation and no behaviour that
  differs in the store build.
