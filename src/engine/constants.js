// Request-type bitmask shared by parser, matcher, DNR compiler and harness.
export const TYPE = {
  script: 1 << 0,
  image: 1 << 1,
  stylesheet: 1 << 2,
  object: 1 << 3,
  xmlhttprequest: 1 << 4,
  subdocument: 1 << 5,
  ping: 1 << 6,
  websocket: 1 << 7,
  media: 1 << 8,
  font: 1 << 9,
  other: 1 << 10,
  csp_report: 1 << 11,
  document: 1 << 12,
  popup: 1 << 13,
  webrtc: 1 << 14,
};
// An untyped filter applies to every type except main documents, popups and webrtc.
export const TYPE_DEFAULT = (1 << 12) - 1;
export const TYPE_ALL = (1 << 15) - 1;

export const TYPE_ALIASES = {
  xhr: 'xmlhttprequest', frame: 'subdocument', doc: 'document', css: 'stylesheet',
  beacon: 'ping', main_frame: 'document', sub_frame: 'subdocument', webbundle: 'other',
};

// Chrome webRequest / DNR resource type name -> bit
export const CHROME_TYPE = {
  main_frame: TYPE.document, sub_frame: TYPE.subdocument, stylesheet: TYPE.stylesheet,
  script: TYPE.script, image: TYPE.image, font: TYPE.font, object: TYPE.object,
  xmlhttprequest: TYPE.xmlhttprequest, ping: TYPE.ping, csp_report: TYPE.csp_report,
  media: TYPE.media, websocket: TYPE.websocket, webbundle: TYPE.other, other: TYPE.other,
};
export const DNR_TYPE = Object.fromEntries(Object.entries(CHROME_TYPE).filter(([k]) => k !== 'webbundle').map(([k, v]) => [v, k]));

// Network filter flags (low 16 bits of record word 1; types live in the high 16 bits)
export const F = {
  EXCEPTION: 1 << 0,
  IMPORTANT: 1 << 1,
  REGEX: 1 << 2,
  ANCHOR_HOST: 1 << 3,   // ||
  ANCHOR_START: 1 << 4,  // |
  ANCHOR_END: 1 << 5,    // trailing |
  THIRD_PARTY: 1 << 6,
  FIRST_PARTY: 1 << 7,
  MATCH_CASE: 1 << 8,
  HAS_DOMAINS: 1 << 9,
  REDIRECT: 1 << 10,
  REDIRECT_RULE: 1 << 11,
  REMOVEPARAM: 1 << 12,
  CSP: 1 << 13,
  PLAIN: 1 << 14,        // no wildcard, no ^ : substring test suffices
  HOST_ONLY: 1 << 15,    // ||host^ with nothing after
};

// Per-site cosmetic flags from $elemhide / $generichide / $specifichide exceptions
export const SITE = { NO_COSMETIC: 1, NO_GENERIC: 2, NO_SPECIFIC: 4 };

// Binary section ids
export const SEC = {
  STRINGS: 1, NET_RECORDS: 2, NET_BLOCK_TOKENS: 3, NET_ALLOW_TOKENS: 4, DOMAIN_LISTS: 5,
  COSM_SPECIFIC: 6, COSM_ID: 7, COSM_CLASS: 8, COSM_ANY: 9, COSM_PROCEDURAL: 10,
  SCRIPTLETS: 11, SITE_FLAGS: 12, PSL: 13, KNOWN_LINES: 14, META: 15, COSM_GENERIC_EXC: 16,
};
export const EXC_BIT = 1 << 31; // marks exception entries in cosmetic value lists
