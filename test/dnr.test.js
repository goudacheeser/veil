import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetwork } from '../src/engine/parser.js';
import { toDnrRule } from '../src/engine/dnr.js';
import { build } from './helpers.js';

const rule = (line) => toDnrRule(parseNetwork(line), 1);

test('block rules with types, party and domains', () => {
  const r = rule('||ads.example.com^$script,third-party,domain=a.com|~b.a.com').rule;
  assert.deepEqual(r, {
    id: 1, priority: 1, action: { type: 'block' },
    condition: { urlFilter: '||ads.example.com^', isUrlFilterCaseSensitive: false, resourceTypes: ['script'], domainType: 'thirdParty', initiatorDomains: ['a.com'], excludedInitiatorDomains: ['b.a.com'] },
  });
  assert.equal(rule('||x.com^').rule.condition.resourceTypes, undefined);
  assert.deepEqual(rule('||x.com^$all').rule.condition.resourceTypes.includes('main_frame'), true);
});

test('exceptions: allow, allowAllRequests, priority with $important', () => {
  assert.equal(rule('@@||x.com^').rule.action.type, 'allow');
  const d = rule('@@||x.com^$document').rule;
  assert.equal(d.action.type, 'allowAllRequests');
  assert.deepEqual(d.condition.resourceTypes, ['main_frame']);
  assert.equal(rule('||x.com^$important').rule.priority, 3);
  assert.equal(rule('@@||x.com^').rule.priority, 2);
  assert.equal(rule('||x.com^').rule.priority, 1);
  assert.equal(rule('||x.com/ads.js$script,redirect=noopjs').rule.priority, 2);
  assert.equal(rule('||x.com/ads.js$script,redirect=unknown-thing').rule.priority, 1);
  assert.equal(rule('@@||x.com^$elemhide').skip, 'cosmetic-only exception');
});

test('redirect, removeparam, csp, regex, popup', () => {
  assert.deepEqual(rule('||x.com/ads.js$script,redirect=noopjs').rule.action, { type: 'redirect', redirect: { extensionPath: '/resources/noop.js' } });
  assert.equal(rule('||x.com/ads.js$redirect=unknown-thing').rule.action.type, 'block');
  assert.match(rule('||x.com^$redirect-rule=noopjs').skip, /redirect-rule/);
  const rp = rule('||x.com^$removeparam=utm_source').rule;
  assert.deepEqual(rp.action.redirect.transform, { queryTransform: { removeParams: ['utm_source'] } });
  assert.ok(rp.condition.resourceTypes.includes('main_frame'));
  assert.deepEqual(rule('||x.com^$removeparam').rule.action.redirect.transform, { query: '' });
  const csp = rule("||x.com^$csp=script-src 'self'").rule;
  assert.equal(csp.action.type, 'modifyHeaders');
  assert.deepEqual(csp.condition.resourceTypes, ['sub_frame', 'main_frame']);
  assert.equal(rule('/^https?:\\/\\/x\\.com\\//$script').rule.condition.regexFilter, '^https?:\\/\\/x\\.com\\/');
  assert.match(rule('/(?=x)/').skip, /RE2/);
  assert.match(rule('||x.com^$popup').skip, /popup/);
  assert.match(rule('||x.com^$domain=multi.*').skip, /entity/);
});

test('compile assigns sequential ids per ruleset and drops badfiltered rules', () => {
  const { out } = build('||a.com^\n||b.com^\n||b.com^$badfilter\n||c.com^$popup');
  assert.deepEqual(out.rulesets.test.map((r) => [r.id, r.condition.urlFilter]), [[1, '||a.com^']]);
  assert.equal(out.dnrSkipped.length, 1);
});
