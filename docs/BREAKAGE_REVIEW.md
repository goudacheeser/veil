# Breakage candidates: manual review

The harness flags candidates by comparing each blocker's load with the no-blocker load of the same
site. This file records what a human saw in the saved screenshots / raw records for the candidates
that were unique to Veil or appeared across several blockers in run `batchA-chrome`. Screenshots are
in `bench/results/raw/batchA-chrome/<site>.<config>.jpg`.

| site | flagged for | what it actually is | verdict |
|---|---|---|---|
| kohls.com | veil (text collapse, login gone); ubo in batch C | Akamai "Access Denied" bot page (seen in screenshot); five parallel loads from one IP trip rate limiting | not breakage (harness artifact) |
| bild.de | veil, adguard, ubo (text collapse) | Admiral anti-adblock wall behind the consent dialog. uBO Lite avoids it because its EasyList ruleset folds `html-load.com` into an all-types domain block, while the EasyList rule is `$document,popup`, which Veil and uBO apply literally. The lists we ship have no script-level block for Admiral's SDK on this site. | real anti-adblock wall, list-content difference, affects uBO too |
| anime.nexus | veil, ubol (text collapse) | page renders normally; hero images lazy-load after the baseline snapshot | not breakage |
| 4anime.gg | every blocker and Brave (empty body) | blank page under Veil (screenshot); the baseline body held 14 characters of text, so the site is a JS shell that rendered nothing in either case within the settle window | not attributable |
| dailymail.co.uk | veil, ubol, adguard (login link + comment section "gone") | screenshots: identical front page with and without Veil, minus the 250px ad slot; the flagged links sit below the fold and were not in the DOM snapshot at settle time | not breakage (seen) |
| deviantart.com | veil, ubol, ubo (text collapse) | CloudFront "403 ERROR: request could not be satisfied" under Veil: rate limiting from parallel loads, same class as kohls.com | not breakage (harness artifact) |
| banggood.com, behance.net, fandom.com, foxnews.com, nordstrom.com | js-error spikes across blockers | raw records: visible text within 6 % of baseline (behance and nordstrom identical), image counts within 12 %, foxnews keeps its 3 playable videos; the extra errors are uncaught exceptions from ad/analytics code whose dependencies were blocked | pages intact, counted but harmless |
| iheart.com, next.co.uk | "video not playable" (veil and others) | iheart screenshot renders normally (text 3774→3813, images 68→64); one promo `<video>` has no source. next.co.uk text identical (45066→45064) | expected consequence of blocking, content intact |
| ranobes.com, goerie.com | veil-only flags | ranobes: text 2241→80 but images 0→6 and no screenshot captured (page state changed, could be an interstitial either way); goerie: text 2937→1492 with 5 new JS errors | unconfirmed, possible real breakage, needs a manual visit |

Net: after review, no confirmed candidate in batch A is a Veil-specific functional break (login,
checkout, video playback or comments lost because of Veil) that another blocker avoided; two
(ranobes.com, goerie.com) remain unconfirmed and the one real wall (bild.de) also catches uBO. The heuristic over-counts, roughly equally for every
blocker, which is why the results table reports candidates rather than a breakage percentage.
