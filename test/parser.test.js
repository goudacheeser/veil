import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetwork, parseList, splitScriptletArgs } from '../src/engine/parser.js';
import { TYPE, TYPE_DEFAULT } from '../src/engine/constants.js';

test('basic network filter anchors and options', () => {
  const f = parseNetwork('||ads.example.com^$script,third-party,domain=a.com|~b.a.com');
  assert.equal(f.anchorHost, true);
  assert.equal(f.pattern, 'ads.example.com^');
  assert.equal(f.types, TYPE.script);
  assert.equal(f.party, 3);
  assert.deepEqual(f.domains, { include: ['a.com'], exclude: ['b.a.com'] });
  assert.equal(f.typesExplicit, true);
});

test('untyped filter gets default types, negated types subtract', () => {
  assert.equal(parseNetwork('/banner/').types, TYPE_DEFAULT);
  assert.equal(parseNetwork('/banner/$~script').types, TYPE_DEFAULT & ~TYPE.script);
  assert.equal(parseNetwork('/banner/$~script').typesExplicit, true);
});

test('exception, important, redirect, removeparam, csp', () => {
  assert.equal(parseNetwork('@@||example.com^$document').exception, true);
  assert.equal(parseNetwork('||x.com^$important').important, true);
  const r = parseNetwork('||x.com/ads.js$script,redirect=noopjs');
  assert.equal(r.redirect, 'noopjs');
  assert.equal(r.redirectRule, false);
  assert.equal(parseNetwork('||x.com^$redirect-rule=noopjs').redirectRule, true);
  assert.equal(parseNetwork('$removeparam=utm_source').removeparam, 'utm_source');
  assert.equal(parseNetwork('||x.com^$removeparam').removeparam, '');
  const c = parseNetwork("||x.com^$csp=script-src 'self'");
  assert.equal(c.csp, "script-src 'self'");
  assert.equal(c.types, TYPE.document | TYPE.subdocument);
});

test('regex literal keeps $ inside the regex', () => {
  const f = parseNetwork('/^https?:\\/\\/[a-z]{8}\\.com\\/$/$script');
  assert.equal(f.regex, '^https?:\\/\\/[a-z]{8}\\.com\\/$');
  assert.equal(f.types, TYPE.script);
  const g = parseNetwork('/ads\\.js$/');
  assert.equal(g.regex, 'ads\\.js$');
});

test('unknown option is rejected, hosts and bare-domain lines become ||host^', () => {
  assert.match(parseNetwork('||x.com^$nonsense').error, /unknown option/);
  const out = parseList('0.0.0.0 tracker.example.com\n127.0.0.1 localhost\nads.example.net\n! comment\n# hosts comment\n');
  assert.deepEqual(out.network.map((f) => f.pattern), ['tracker.example.com^', 'ads.example.net^']);
});

test('cosmetic filters: generic, specific, exception, procedural, scriptlet', () => {
  const out = parseList([
    '##.ad-banner',
    'example.com,~sub.example.com###sidebar-ad',
    'example.com#@#.ad-banner',
    'example.com##div:has-text(/sponsored/i):upward(2)',
    'example.com##+js(abort-on-property-read, adBlockDetected)',
    'example.com##+js(aopw, a.b\\, c)',
    'example.com#@#+js()',
    '##.x:has-text(generic procedural is rejected)',
    'example.com##^script:has-text(html filtering)',
    'example.com#%#window.foo = 1',
  ].join('\n'));
  assert.equal(out.cosmetic.length, 4);
  assert.equal(out.cosmetic[0].generic, true);
  assert.deepEqual(out.cosmetic[1].domains, { include: ['example.com'], exclude: ['sub.example.com'] });
  assert.equal(out.cosmetic[2].exception, true);
  assert.equal(out.cosmetic[3].css, undefined);
  assert.equal(out.cosmetic[3].selector, 'div');
  assert.deepEqual(out.cosmetic[3].ops.map((o) => o.op), ['has-text', 'upward']);
  assert.equal(out.scriptlets.length, 3);
  assert.deepEqual([out.scriptlets[0].name, out.scriptlets[0].args], ['abort-on-property-read', ['adBlockDetected']]);
  assert.deepEqual([out.scriptlets[1].name, out.scriptlets[1].args], ['abort-on-property-write', ['a.b, c']]);
  assert.equal(out.scriptlets[2].exception, true);
  assert.equal(out.unsupported.length, 3);
});

test('AdGuard #$# and ABP brace style become :style()', () => {
  const out = parseList('example.com#$#.banner { height: 0 !important }\nexample.com##.nav.sticky {top:0px;}');
  assert.equal(out.cosmetic.length, 2);
  assert.deepEqual(out.cosmetic[0].ops, [{ op: 'style', arg: 'height: 0' }]);
  assert.equal(out.cosmetic[1].selector, '.nav.sticky');
});

test('preprocessor directives follow the chromium environment', () => {
  const out = parseList('!#if env_firefox\n||firefox-only.com^\n!#else\n||chromium.com^\n!#endif\n!#if !env_mv3\n||mv2.com^\n!#endif\n||always.com^');
  assert.deepEqual(out.network.map((f) => f.pattern), ['chromium.com^', 'always.com^']);
});

test('scriptlet arg splitting honours escapes and quotes', () => {
  assert.deepEqual(splitScriptletArgs('set-constant, a.b, "x, y", c\\, d'), ['set-constant', 'a.b', 'x, y', 'c, d']);
  assert.deepEqual(splitScriptletArgs(''), []);
});

test('escaped brackets in selectors survive procedural parsing', () => {
  const out = parseList('inc.com#?#.pr-\\[25px\\].py-\\[27px\\]:has-text(Apply Now)');
  assert.equal(out.cosmetic.length, 1);
  assert.equal(out.cosmetic[0].selector, '.pr-\\[25px\\].py-\\[27px\\]');
});
