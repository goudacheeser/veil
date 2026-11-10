# Third-party licenses

Veil's own code is MIT (see LICENSE). The filter lists it downloads into `third_party/lists/`
and compiles into the release package are not; they keep their own licenses, which the built
extension honors by preserving attribution and by shipping the compiled rules under the same
terms as the source lists. If you redistribute a build, these terms apply to the list data in it.

| list | license | source |
|---|---|---|
| EasyList, EasyPrivacy, EasyList anti-adblock | GPL-3.0 or CC BY-SA 3.0 (dual) | https://easylist.to |
| Fanboy's Annoyance | GPL-3.0 or CC BY-SA 3.0 (dual) | https://easylist.to |
| uBlock Origin filters (filters, privacy, badware, quick-fixes, unbreak, annoyances) | GPL-3.0 | https://github.com/uBlockOrigin/uAssets |
| Peter Lowe's Ad and tracking server list | McRae General Public License | https://pgl.yoyo.org/adservers/ |
| Public Suffix List | MPL-2.0 | https://publicsuffix.org |

`build/lists.json` records each list's URL and license; `third_party/lists.lock.json` records the
SHA-256 of the exact bytes that were reviewed and compiled. Competitor extensions used only by the
benchmark harness are downloaded on demand into `bench/competitors/` and are not part of the repo.
