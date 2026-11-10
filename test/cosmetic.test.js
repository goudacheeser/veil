import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from './helpers.js';
import { genericKey } from '../src/engine/compile.js';
import { parseProcedural } from '../src/engine/procedural.js';
import { entityOf } from '../src/engine/url.js';

const LIST = `
##.ad-banner
###top-ad
##a[href^="https://ads."]
~noads.com##.generic-but-not-here
example.com##.site-ad
example.com,~clean.example.com##.sub-ad
example.com#@#.ad-banner
example.com##div.sponsored:has-text(/sponsored/i):upward(1)
example.com#@#div.sponsored:has-text(/sponsored/i):upward(1)
example.com##.promo:has-text(Promo)
multi.*##.entity-ad
#@#.globally-excepted
other.com##.globally-excepted
example.com##+js(abort-on-property-read, detector)
example.com##+js(set-constant, foo, true)
sub.example.com#@#+js(set-constant, foo, true)
@@||nocosmetics.com^$elemhide
@@||nogeneric.com^$generichide
@@*$generichide,domain=viadomain.com
`;
const { cosmetic, psl } = build(LIST);
const E = (h) => entityOf(h, psl);

test('specific selectors by hostname with subdomain inheritance and exclusions', () => {
  assert.deepEqual(cosmetic.specificFor('example.com', E('example.com')).hide.sort(), ['.site-ad', '.sub-ad']);
  assert.deepEqual(cosmetic.specificFor('www.example.com', E('www.example.com')).hide.sort(), ['.site-ad', '.sub-ad']);
  assert.deepEqual(cosmetic.specificFor('clean.example.com', E('clean.example.com')).hide, ['.site-ad']);
  assert.deepEqual(cosmetic.specificFor('other.com', E('other.com')).hide, []);
});

test('generic selectors are keyed by id/class and filtered by per-site exceptions', () => {
  const ex = cosmetic.specificFor('example.com', E('example.com')).exceptions;
  assert.ok(ex.has('.ad-banner'));
  assert.deepEqual(cosmetic.generic(['top-ad'], ['ad-banner', 'nothing'], ex), ['#top-ad']);
  assert.deepEqual(cosmetic.generic([], ['ad-banner'], new Set()), ['.ad-banner']);
  assert.deepEqual(cosmetic.genericAny(), ['a[href^="https://ads."]']);
  assert.deepEqual(cosmetic.generic([], ['generic-but-not-here'], cosmetic.specificFor('noads.com', '').exceptions), []);
  assert.deepEqual(cosmetic.generic([], ['generic-but-not-here'], cosmetic.specificFor('yes.com', '').exceptions), ['.generic-but-not-here']);
});

test('global #@# exception removes the selector everywhere', () => {
  assert.deepEqual(cosmetic.specificFor('other.com', E('other.com')).hide, []);
});

test('procedural filters, procedural exceptions and entity domains', () => {
  const p = cosmetic.specificFor('example.com', E('example.com')).procedural;
  assert.equal(p.length, 1);
  assert.equal(p[0].css, '.promo');
  assert.deepEqual(p[0].ops, [{ op: 'has-text', text: 'Promo' }]);
  assert.deepEqual(cosmetic.specificFor('www.multi.co.uk', E('www.multi.co.uk')).hide, ['.entity-ad']);
});

test('scriptlets per host with exceptions', () => {
  assert.deepEqual(cosmetic.scriptletsFor('example.com', '').sort(), [['abort-on-property-read', 'detector'], ['set-constant', 'foo', 'true']]);
  assert.deepEqual(cosmetic.scriptletsFor('sub.example.com', ''), [['abort-on-property-read', 'detector']]);
});

test('site flags from $elemhide/$generichide exceptions', () => {
  assert.equal(cosmetic.siteFlags('nocosmetics.com', ''), 1);
  assert.equal(cosmetic.siteFlags('a.nogeneric.com', ''), 2);
  assert.equal(cosmetic.siteFlags('viadomain.com', ''), 2);
  assert.equal(cosmetic.siteFlags('example.com', ''), 0);
});

test('genericKey picks an id first, then a class, ignoring attribute contents', () => {
  assert.deepEqual(genericKey('.a > div#b'), { id: 'b' });
  assert.deepEqual(genericKey('div.foo .bar'), { cls: 'foo' });
  assert.deepEqual(genericKey('a[href*=".ad"]'), {});
  assert.deepEqual(genericKey('.pr-\\[25px\\]'), { cls: 'pr-[25px]' });
});

test('procedural parser', () => {
  const p = parseProcedural('div > .x:has-text(/foo/i):matches-path(/^\\/news/):upward(#wrap):has(> img):not(.y:has-text(z))');
  assert.equal(p.error, null);
  assert.equal(p.css, 'div > .x');
  assert.deepEqual(p.ops.map((o) => o.op), ['has-text', 'matches-path', 'upward', 'spath', 'not']);
  assert.deepEqual(p.ops[0], { op: 'has-text', re: 'foo', flags: 'i' });
  assert.deepEqual(p.ops[2], { op: 'upward', css: '#wrap' });
  assert.equal(p.ops[3].arg, ':has(> img)');
  assert.deepEqual(p.ops[4], { op: 'not', css: '.y', ops: [{ op: 'has-text', text: 'z' }] });
  assert.equal(parseProcedural('.a:has(.b)').ops, null);
  assert.deepEqual(parseProcedural('.a:style(color: red !important)').ops, [{ op: 'style', arg: 'color: red' }]);
  assert.match(parseProcedural('.a:style(background: url(x))').error, /unsafe/);
  assert.match(parseProcedural('.a:has-text(unclosed').error, /unbalanced/);
  assert.deepEqual(parseProcedural('.a:remove()').ops, [{ op: 'remove' }]);
  assert.deepEqual(parseProcedural('.a:matches-css(width: /^30/)').ops, [{ op: 'matches-css', pseudo: null, prop: 'width', re: '^30', flags: '' }]);
});
