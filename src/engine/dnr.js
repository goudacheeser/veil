// ABP network filter -> declarativeNetRequest rule. Returns { rule } or { skip: reason }.
// Priority ladder: block/removeparam/csp = 1, redirect = 2, exception = 2, $important = 3.
// With DNR's tie-break (allow > block > redirect > modifyHeaders) this gives ABP semantics:
// a redirect beats the plain block for the same URL (otherwise surrogates never fire), an
// exception beats both, and $important beats exceptions.
import { TYPE, TYPE_DEFAULT, DNR_TYPE } from './constants.js';

export const REDIRECT_RESOURCES = {
  'noopjs': 'noop.js', 'noop.js': 'noop.js', 'nooptext': 'noop.txt', 'noop.txt': 'noop.txt', 'empty': 'noop.txt',
  'noopframe': 'noop.html', 'noop.html': 'noop.html', 'noopcss': 'noop.css', 'noop.css': 'noop.css',
  'noopjson': 'noop.json', '1x1.gif': '1x1.gif', '1x1-transparent.gif': '1x1.gif',
  '2x2.png': '2x2.png', '2x2-transparent.png': '2x2.png', '3x2.png': '2x2.png', '3x2-transparent.png': '2x2.png',
  '32x32.png': '2x2.png', '32x32-transparent.png': '2x2.png',
  'googlesyndication_adsbygoogle.js': 'adsbygoogle.js', 'googlesyndication.com/adsbygoogle.js': 'adsbygoogle.js',
  'google-analytics_analytics.js': 'analytics.js', 'google-analytics.com/analytics.js': 'analytics.js',
  'google-analytics_ga.js': 'analytics.js', 'googletagmanager_gtm.js': 'gtm.js', 'googletagmanager.com/gtm.js': 'gtm.js',
  'googletagservices_gpt.js': 'gpt.js', 'googletagservices.com/gpt.js': 'gpt.js',
  'google-analytics_cx.js': 'noop.js', 'google-analytics_inpage_linkid.js': 'noop.js',
  'fuckadblock.js-3.2.0': 'fuckadblock.js', 'nofab.js': 'fuckadblock.js', 'prebid-ads.js': 'prebid-ads.js',
  'amazon_ads.js': 'amazon_ads.js', 'amazon_apstag.js': 'amazon_apstag.js',
};

const RE2_UNSUPPORTED = /\(\?[=!<]|\\[1-9]|\(\?P?</;

export function typesToResourceTypes(types) {
  const out = [];
  for (const bit of Object.keys(DNR_TYPE)) if (types & bit) out.push(DNR_TYPE[bit]);
  return out;
}

export function toDnrRule(f, id) {
  if (f.badfilter) return { skip: 'badfilter' };
  if (f.nonAscii) return { skip: 'non-ascii pattern' };
  if (f.redirectRule) return { skip: '$redirect-rule not expressible (needs a matching block)' };
  if (f.siteFlags && !f.typesExplicit && f.exception) return { skip: 'cosmetic-only exception' };
  if (f.denyallow && !f.domains) return { skip: '$denyallow without $domain' };

  const cond = {};
  if (f.regex !== null) {
    if (RE2_UNSUPPORTED.test(f.regex)) return { skip: 'regex not RE2-compatible' };
    cond.regexFilter = f.regex;
  } else {
    let uf = f.anchorHost ? '||' + f.pattern : f.anchorStart ? '|' + f.pattern : f.pattern;
    if (f.anchorEnd) uf += '|';
    if (uf.startsWith('||*')) uf = uf.slice(2);
    if (!uf || uf === '*' || uf === '|' || uf === '||') {
      if (!f.domains && !f.to && !f.csp && f.removeparam === null) return { skip: 'pattern matches everything' };
    } else cond.urlFilter = uf;
  }
  cond.isUrlFilterCaseSensitive = !!f.matchCase;

  let types = f.types & ~(TYPE.popup | TYPE.webrtc);
  if (f.removeparam !== null && !f.typesExplicit) types |= TYPE.document;
  if (!types) return { skip: 'only popup/webrtc types' };
  if (types !== TYPE_DEFAULT) cond.resourceTypes = typesToResourceTypes(types);

  if (f.party === 3) cond.domainType = 'thirdParty';
  else if (f.party === 1) cond.domainType = 'firstParty';

  if (f.domains) {
    const inc = f.domains.include.filter(okDomain), exc = f.domains.exclude.filter(okDomain);
    if (f.domains.include.length && !inc.length) return { skip: '$domain has only entity/non-ascii entries' };
    if (inc.length) cond.initiatorDomains = inc;
    if (exc.length) cond.excludedInitiatorDomains = exc;
  }
  if (f.to) {
    const inc = f.to.include.filter(okDomain), exc = f.to.exclude.filter(okDomain);
    if (f.to.include.length && !inc.length) return { skip: '$to has only entity entries' };
    if (inc.length) cond.requestDomains = inc;
    if (exc.length) cond.excludedRequestDomains = exc;
  }
  if (f.denyallow) cond.excludedRequestDomains = [...(cond.excludedRequestDomains || []), ...f.denyallow.filter(okDomain)];
  if (f.methods) cond.requestMethods = f.methods;

  let action;
  let priority = f.important ? 3 : f.exception ? 2 : 1;
  if (f.exception) {
    if (types & TYPE.document || types & TYPE.subdocument && f.typesExplicit && !(types & ~(TYPE.document | TYPE.subdocument))) {
      action = { type: 'allowAllRequests' };
      cond.resourceTypes = typesToResourceTypes(types & (TYPE.document | TYPE.subdocument));
      if (types & ~(TYPE.document | TYPE.subdocument)) {
        // mixed: @@||x^$document,script -> allowAllRequests for frames + allow for the rest
        return { rule: mk(id, priority, action, cond), extra: mk(id, priority, { type: 'allow' }, { ...cond, resourceTypes: typesToResourceTypes(types & ~(TYPE.document | TYPE.subdocument)) }) };
      }
    } else action = { type: 'allow' };
  } else if (f.csp !== null) {
    if (!f.csp) return { skip: '$csp without value' };
    action = { type: 'modifyHeaders', responseHeaders: [{ header: 'Content-Security-Policy', operation: 'append', value: f.csp }] };
    cond.resourceTypes = typesToResourceTypes(types & (TYPE.document | TYPE.subdocument));
    if (!cond.resourceTypes.length) return { skip: '$csp on non-document type' };
  } else if (f.removeparam !== null) {
    if (f.removeparam.startsWith('~') || f.removeparam.startsWith('/')) return { skip: 'regex/negated $removeparam' };
    const transform = f.removeparam ? { queryTransform: { removeParams: [f.removeparam] } } : { query: '' };
    action = { type: 'redirect', redirect: { transform } };
  } else if (f.redirect) {
    const file = REDIRECT_RESOURCES[f.redirect];
    action = file ? { type: 'redirect', redirect: { extensionPath: '/resources/' + file } } : { type: 'block' };
    if (file && !f.important) priority = 2;
  } else action = { type: 'block' };

  return { rule: mk(id, priority, action, cond) };
}

function okDomain(d) { return !d.includes('*') && /^[\x21-\x7e]+$/.test(d); }
function mk(id, priority, action, condition) { return { id, priority, action, condition }; }
