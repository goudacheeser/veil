// Builds bench/corpus/corpus.json: 500 sites stratified into news, video, shopping, social and
// long-tail. The four named categories are hand-curated (publicly known sites in each vertical);
// long-tail is a deterministic sample (seed below) of Tranco ranks 5,000-100,000, so anyone can
// regenerate the identical corpus from the same Tranco snapshot.
import fs from 'node:fs';
import path from 'node:path';

const dir = import.meta.dirname;
const SEED = 20261109;
const TARGET = { news: 100, video: 75, shopping: 100, social: 50, longtail: 175 };

const news = `cnn.com foxnews.com nytimes.com washingtonpost.com theguardian.com bbc.com reuters.com apnews.com nbcnews.com cbsnews.com abcnews.go.com usatoday.com wsj.com bloomberg.com forbes.com businessinsider.com cnbc.com huffpost.com dailymail.co.uk thesun.co.uk mirror.co.uk independent.co.uk telegraph.co.uk express.co.uk nypost.com latimes.com chicagotribune.com sfgate.com nydailynews.com politico.com thehill.com axios.com vox.com slate.com theatlantic.com newyorker.com time.com newsweek.com buzzfeednews.com vice.com dw.com france24.com lemonde.fr lefigaro.fr spiegel.de bild.de zeit.de welt.de faz.net sueddeutsche.de corriere.it repubblica.it elpais.com elmundo.es abc.es globo.com uol.com.br folha.uol.com.br clarin.com lanacion.com.ar eluniversal.com.mx timesofindia.indiatimes.com hindustantimes.com ndtv.com indianexpress.com thehindu.com news18.com indiatoday.in scmp.com japantimes.co.jp asahi.com straitstimes.com smh.com.au news.com.au abc.net.au theage.com.au nzherald.co.nz cbc.ca globeandmail.com thestar.com nationalpost.com aljazeera.com rt.com timesofisrael.com haaretz.com hurriyet.com.tr sabah.com.tr tass.com kyivindependent.com rte.ie irishtimes.com techcrunch.com theverge.com arstechnica.com wired.com engadget.com gizmodo.com mashable.com cnet.com zdnet.com tomshardware.com`.split(/\s+/);
const video = `youtube.com twitch.tv dailymotion.com vimeo.com tiktok.com rumble.com bitchute.com odysee.com kick.com crunchyroll.com funimation.com hulu.com peacocktv.com pluto.tv tubitv.com plex.tv roku.com vudu.com crackle.com xumo.tv imdb.com rottentomatoes.com metacritic.com ign.com gamespot.com kotaku.com polygon.com pcgamer.com eurogamer.net gamesradar.com rockpapershotgun.com gameinformer.com 9gag.com imgur.com giphy.com tenor.com soundcloud.com bandcamp.com mixcloud.com audiomack.com last.fm genius.com azlyrics.com lyrics.com musixmatch.com shazam.com deezer.com spotify.com pandora.com iheart.com tunein.com podbean.com buzzsprout.com anchor.fm bilibili.com youku.com iqiyi.com nicovideo.jp vk.com ok.ru coub.com liveleak.com veoh.com metacafe.com break.com ebaumsworld.com collegehumor.com funnyordie.com cheezburger.com knowyourmeme.com 4anime.gg 9anime.to gogoanime.tv kissanime.ru animeflv.net`.split(/\s+/);
const shopping = `amazon.com ebay.com walmart.com target.com bestbuy.com homedepot.com lowes.com costco.com wayfair.com overstock.com etsy.com aliexpress.com alibaba.com wish.com temu.com shein.com zara.com hm.com uniqlo.com gap.com oldnavy.com nordstrom.com macys.com kohls.com jcpenney.com sears.com newegg.com bhphotovideo.com adorama.com microcenter.com zappos.com asos.com boohoo.com nike.com adidas.com underarmour.com footlocker.com finishline.com dickssportinggoods.com rei.com cabelas.com basspro.com chewy.com petco.com petsmart.com sephora.com ulta.com cvs.com walgreens.com riteaid.com kroger.com safeway.com instacart.com groupon.com rakuten.com slickdeals.net retailmenot.com dealnews.com woot.com flipkart.com myntra.com snapdeal.com jd.com taobao.com tmall.com mercadolibre.com.ar mercadolibre.com.mx americanas.com.br magazineluiza.com.br otto.de zalando.de mediamarkt.de saturn.de cdiscount.com fnac.com darty.com argos.co.uk currys.co.uk johnlewis.com very.co.uk next.co.uk marksandspencer.com tesco.com sainsburys.co.uk asda.com ikea.com lego.com gamestop.com steampowered.com humblebundle.com gog.com fanatical.com cdkeys.com g2a.com kinguin.net newchic.com banggood.com gearbest.com dhgate.com lightinthebox.com`.split(/\s+/);
const social = `facebook.com instagram.com twitter.com x.com reddit.com pinterest.com linkedin.com tumblr.com quora.com snapchat.com discord.com telegram.org whatsapp.com threads.net mastodon.social bsky.app vk.com weibo.com douban.com zhihu.com nextdoor.com meetup.com flickr.com deviantart.com behance.net dribbble.com medium.com substack.com wordpress.com blogger.com livejournal.com fandom.com wikia.com stackexchange.com stackoverflow.com github.com gitlab.com producthunt.com hackernews.com slashdot.org digg.com fark.com somethingawful.com resetera.com neogaf.com gaiaonline.com xanga.com myspace.com tagged.com badoo.com care2.com`.split(/\s+/);

const curated = { news, video, shopping, social };
const seen = new Set();
const corpus = [];
for (const [cat, list] of Object.entries(curated)) {
  for (const d of list) {
    if (seen.has(d) || corpus.filter((c) => c.category === cat).length >= TARGET[cat]) continue;
    seen.add(d); corpus.push({ domain: d, category: cat, source: 'curated' });
  }
}

// deterministic long-tail sample (mulberry32)
let st = SEED;
const rnd = () => { st |= 0; st = (st + 0x6d2b79f5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const tranco = fs.readFileSync(path.join(dir, 'raw/top-1m.csv'), 'utf8').split('\n').map((l) => l.split(',')[1]?.trim()).filter(Boolean);
const pool = tranco.slice(5000, 100000).filter((d) => !seen.has(d) && !/(^|\.)(googleapis|gstatic|akamai|cloudfront|amazonaws|windows|microsoft|apple|office|live|cdn|edgekey|akadns|doubleclick|googlesyndication|adnxs|criteo|rubiconproject|pubmatic|openx|taboola|outbrain|scorecardresearch|demdex|omtrdc|googletagmanager|google-analytics|facebook|fbcdn|sentry|newrelic|cloudflare|fastly|azure|gvt1|gvt2|ggpht|ytimg|licdn|twimg|tiktokcdn|whatsapp|digicert|letsencrypt|godaddy|sectigo|globalsign|ntp|arpa|in-addr|mcafee|avast|kaspersky|norton|symantec|trendmicro|sophos|bitdefender|eset)\./.test(d) && !/\.(gov|mil|edu|int)$/.test(d) && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d));
while (corpus.filter((c) => c.category === 'longtail').length < TARGET.longtail && pool.length) {
  const i = Math.floor(rnd() * pool.length);
  const d = pool.splice(i, 1)[0];
  const rank = tranco.indexOf(d) + 1;
  seen.add(d); corpus.push({ domain: d, category: 'longtail', source: `tranco#${rank}` });
}
const counts = Object.fromEntries(Object.keys(TARGET).map((k) => [k, corpus.filter((c) => c.category === k).length]));
fs.writeFileSync(path.join(dir, 'corpus.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), seed: SEED, tranco: 'top-1m.csv snapshot in bench/corpus/raw (date in zip)', counts, sites: corpus }, null, 1));
console.log(counts, corpus.length);
