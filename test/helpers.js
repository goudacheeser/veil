import { compile } from '../src/engine/compile.js';
import { BinReader } from '../src/engine/binary.js';
import { SEC, TYPE } from '../src/engine/constants.js';
import { NetworkMatcher } from '../src/engine/matcher.js';
import { CosmeticIndex } from '../src/engine/cosmetic-index.js';
import { Psl } from '../src/engine/psl.js';
import { hostnameOf, entityOf, isThirdParty } from '../src/engine/url.js';

export const PSL = ['com', 'net', 'org', 'io', 'uk', 'co.uk', 'de', 'github.io', '*.ck', '!www.ck'];

export function build(text, extraLists = []) {
  const out = compile([{ name: 'test', text }, ...extraLists], { psl: PSL });
  const nr = new BinReader(out.networkBin, SEC.STRINGS);
  const cr = new BinReader(out.cosmeticBin, SEC.STRINGS);
  const psl = new Psl(nr);
  return { out, matcher: new NetworkMatcher(nr), cosmetic: new CosmeticIndex(cr), psl, reader: nr };
}

export function ctx(url, { type = 'script', src = 'https://page.example.com/' } = {}, psl) {
  const hostname = hostnameOf(url), srcHostname = hostnameOf(src);
  return {
    url: url.toLowerCase(), urlRaw: url, hostname, entity: entityOf(hostname, psl),
    type: TYPE[type], srcHostname, srcEntity: entityOf(srcHostname, psl),
    thirdParty: isThirdParty(hostname, srcHostname, psl),
  };
}
