import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, ctx } from './helpers.js';
import { BinReader } from '../src/engine/binary.js';
import { SEC } from '../src/engine/constants.js';
import { domainOf, entityOf, hostnameOf } from '../src/engine/url.js';
import { patternTokens, tokenizeUrl, hash } from '../src/engine/tokens.js';

const LIST = `
||ads.example.com^
||tracker.net^$third-party
/banner/*.gif$image
|http://exact.com/path|
@@||ads.example.com/allowed.js$script
||important.com^$important
@@||important.com^
@@||allowall.com^$document
||allowall.com/ad.js
||xhr.com^$xmlhttprequest,domain=site.com|~sub.site.com
||entity.com^$domain=multi.*
/^https:\\/\\/[a-z]{3}\\.regex\\.com\\//
||cdn.com/*/ads/$script
plainsubstring
||casesensitive.com/Ad$match-case
||bad.com^
||bad.com^$badfilter
*$to=target.com
||redir.com/ads.js$script,redirect=noopjs
$removeparam=utm_source
||csp.com^$csp=script-src 'self'
||rr.com^$redirect-rule=noopjs
`;

const { matcher, psl } = build(LIST);
const m = (url, o) => matcher.match(ctx(url, o, psl));

test('hostname anchor matches domain and subdomains only', () => {
  assert.equal(m('https://ads.example.com/x.js').action, 'block');
  assert.equal(m('https://sub.ads.example.com/x.js').action, 'block');
  assert.equal(m('https://notads.example.com/x.js').action, 'none');
  assert.equal(m('https://example.com/ads.example.com').action, 'none');
});

test('third-party option', () => {
  assert.equal(m('https://tracker.net/t.js', { src: 'https://page.com/' }).action, 'block');
  assert.equal(m('https://tracker.net/t.js', { src: 'https://www.tracker.net/' }).action, 'none');
});

test('wildcards, type options, exact anchors, plain substrings', () => {
  assert.equal(m('https://x.com/banner/1x1.gif', { type: 'image' }).action, 'block');
  assert.equal(m('https://x.com/banner/1x1.gif', { type: 'script' }).action, 'none');
  assert.equal(m('http://exact.com/path').action, 'block');
  assert.equal(m('http://exact.com/path2').action, 'none');
  assert.equal(m('https://cdn.com/v1/ads/x.js').action, 'block');
  assert.equal(m('https://whatever.org/a/plainsubstring/b').action, 'block');
});

test('exceptions and $important precedence', () => {
  const r = m('https://ads.example.com/allowed.js');
  assert.equal(r.action, 'allow');
  assert.equal(r.overrode, '||ads.example.com^');
  assert.equal(m('https://ads.example.com/allowed.js', { type: 'image' }).action, 'block');
  assert.equal(m('https://important.com/x').action, 'block');
  assert.equal(m('https://important.com/x').important, true);
});

test('$document exception is exposed through matchDocument', () => {
  assert.ok(matcher.matchDocument('https://allowall.com/', 'allowall.com', entityOf('allowall.com', psl)));
  assert.equal(matcher.matchDocument('https://other.com/', 'other.com', ''), null);
});

test('$domain include/exclude and entity domains', () => {
  assert.equal(m('https://xhr.com/a', { type: 'xmlhttprequest', src: 'https://site.com/' }).action, 'block');
  assert.equal(m('https://xhr.com/a', { type: 'xmlhttprequest', src: 'https://www.site.com/' }).action, 'block');
  assert.equal(m('https://xhr.com/a', { type: 'xmlhttprequest', src: 'https://sub.site.com/' }).action, 'none');
  assert.equal(m('https://xhr.com/a', { type: 'xmlhttprequest', src: 'https://other.com/' }).action, 'none');
  assert.equal(m('https://entity.com/a', { src: 'https://multi.co.uk/' }).action, 'block');
  assert.equal(m('https://entity.com/a', { src: 'https://multi.de/' }).action, 'block');
  assert.equal(m('https://entity.com/a', { src: 'https://nomulti.com/' }).action, 'none');
});

test('regex filters, match-case, badfilter, $to, redirect', () => {
  assert.equal(m('https://abc.regex.com/').action, 'block');
  assert.equal(m('https://abcd.regex.com/').action, 'none');
  assert.equal(m('https://casesensitive.com/Ad').action, 'block');
  assert.equal(m('https://casesensitive.com/ad').action, 'none');
  assert.equal(m('https://bad.com/').action, 'none');
  assert.equal(m('https://target.com/x').action, 'block');
  assert.equal(m('https://other.com/x').action, 'none');
  assert.equal(m('https://redir.com/ads.js').redirect, 'noopjs');
});

test('modifier filters never block on their own', () => {
  assert.equal(m('https://anything.org/page?utm_source=x').action, 'none');
  assert.equal(m('https://csp.com/', { type: 'document' }).action, 'none');
  assert.equal(m('https://rr.com/x.js').action, 'none');
});

test('url helpers', () => {
  assert.equal(hostnameOf('https://user:pw@Sub.Example.COM:8080/p?q#f'), 'sub.example.com');
  assert.equal(hostnameOf('wss://a.b.c/'), 'a.b.c');
  assert.equal(domainOf('a.b.example.co.uk', new Set(['uk', 'co.uk'])), 'example.co.uk');
  assert.equal(domainOf('foo.github.io', new Set(['io', 'github.io'])), 'foo.github.io');
  assert.equal(domainOf('x.www.ck', new Set(['*.ck', '!www.ck'])), 'www.ck');
  assert.equal(entityOf('www.example.co.uk', new Set(['uk', 'co.uk'])), 'www.example.*');
});

test('tokenizer excludes fragments next to wildcards and unanchored edges', () => {
  assert.deepEqual(patternTokens('ads.example.com^', { anchorStart: true }), ['ads', 'example', 'com']);
  assert.deepEqual(patternTokens('/banner/*.gif'), ['banner']);
  assert.deepEqual(patternTokens('ad*banner'), []);
  const toks = tokenizeUrl('https://x.com/a-b');
  assert.deepEqual(toks.slice(0, 4), [hash('https'), hash('x'), hash('com'), hash('a')]);
  assert.equal(toks.at(-1), 0);
});

test('binary table lookup finds every key and nothing else', () => {
  const { reader } = build('||a.com^\n||b.com^\n||c.com^');
  const t = reader.u32(SEC.NET_BLOCK_TOKENS);
  for (const k of ['a', 'b', 'c']) assert.ok(BinReader.lookup(t, hash(k)));
  assert.equal(BinReader.lookup(t, hash('zzz')), null);
});
