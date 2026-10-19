// Search engines and link previews: robots.txt, sitemap.xml, canonical and language links, structured data (JSON-LD),
// previews of each venue's menu (title, description, image) and "noindex" on private pages (tables, staff, receipts).
// The website pages are plain HTML files; the tags that depend on the address are added here when a page is sent.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PLANS } from './plans.js';
import { LANDING, LANDING_UPDATED, landingFor, pairOf, renderLanding } from './landing.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// JSON inside <script>: "<" is escaped so the text can never close the tag.
const ldJson = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
const absolute = (origin, url) => (!url ? '' : /^https?:\/\//.test(url) ? url : `${origin}${url.startsWith('/') ? '' : '/'}${url}`);
const plain = (html) => String(html).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// Pages of the websites that search engines should find, with their address.
export const SITE_PAGES = { 'index.html': '/', 'demo.html': '/demo', 'signup.html': '/signup', 'terms.html': '/terms',
  'privacy.html': '/privacy', 'dpa.html': '/dpa', 'cookies.html': '/cookies', 'login.html': '/login' };
// Descriptions for pages that have none of their own.
const DESCRIPTIONS = {
  gr: {
    'demo.html': 'Δοκιμάστε το Kalimenu ζωντανά: μενού σε 8 γλώσσες, παραγγελία από το τραπέζι, οθόνες σερβιτόρου και κουζίνας.',
    'login.html': 'Σύνδεση στη διαχείριση του καταστήματός σας στο Kalimenu.',
    'terms.html': 'Οι όροι χρήσης της υπηρεσίας Kalimenu για καταστήματα εστίασης.',
    'privacy.html': 'Πώς το Kalimenu προστατεύει τα προσωπικά δεδομένα καταστημάτων και πελατών (GDPR).',
    'dpa.html': 'Σύμβαση επεξεργασίας δεδομένων (άρθρο 28 GDPR) μεταξύ του Kalimenu και των καταστημάτων.',
    'cookies.html': 'Ποια cookies χρησιμοποιεί το Kalimenu και πώς αλλάζετε την επιλογή σας.',
  },
  us: {
    'demo.html': 'Try Kalimenu live: a QR menu in 8 languages, ordering from the table, server and kitchen screens.',
    'login.html': 'Sign in to manage your restaurant on Kalimenu.',
    'terms.html': 'Terms of Service of Kalimenu for restaurants, bars, cafés and hotels.',
    'privacy.html': 'How Kalimenu protects the personal information of restaurants and their guests.',
    'dpa.html': 'Data processing terms between Kalimenu and the businesses that use it.',
    'cookies.html': 'Which cookies Kalimenu uses and how to change your choice.',
  },
};
// The date the website pages last changed, for <lastmod> in the sitemap.
const SITE_UPDATED = '2026-10-12';
// Ownership checks of Google Search Console and Bing Webmaster Tools (the "HTML tag" method): the codes they give,
// set on the hosting (GOOGLE_SITE_VERIFICATION, BING_SITE_VERIFICATION; for kalimenu.com US_GOOGLE_SITE_VERIFICATION…)
// or here. Several codes, comma-separated, verify several accounts.
const VERIFY = {
  gr: { google: '-vAIS2TvKaHCJ1pI8zX3IzwFAKW82fRVFCJh-30h9nc', bing: '' },
  us: { google: '', bing: '' },
};
const verification = (market) => {
  const prefix = market === 'us' ? 'US_' : '';
  // A code copied as the DNS record ("google-site-verification=…") works too.
  const codes = (name, key) => String(process.env[`${prefix}${name}`] || VERIFY[market][key] || '').split(',')
    .map((c) => c.trim().replace(/^google-site-verification=/, '')).filter(Boolean);
  return [...codes('GOOGLE_SITE_VERIFICATION', 'google').map((c) => `<meta name="google-site-verification" content="${esc(c)}">`),
    ...codes('BING_SITE_VERIFICATION', 'bing').map((c) => `<meta name="msvalidate.01" content="${esc(c)}">`)];
};
const LOCALE = { gr: 'el_GR', us: 'en_US' };
// The picture shown when a link to the websites is shared, in the language of each website (see assets.js), and its size.
const previewImage = (origin, market) => `${origin}/assets/og-${market === 'us' ? 'us' : 'gr'}.jpg`;
const PREVIEW_ALT = { gr: 'Kalimenu: QR menu σε 8 γλώσσες με παραγγελία από το τραπέζι', us: 'Kalimenu: a QR code menu in 8 languages with ordering from the table' };
const previewTags = (origin, market, html = '') => [
  !html.includes('og:image"') ? `<meta property="og:image" content="${esc(previewImage(origin, market))}">` : '',
  '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
  `<meta property="og:image:alt" content="${esc(PREVIEW_ALT[market])}">`,
  `<meta name="twitter:image" content="${esc(previewImage(origin, market))}">`,
];
const LANG = { gr: 'el', us: 'en-US' };
// Private pages: never in search results. Tables and receipts have secret links; staff and administration need a login.
const PRIVATE = /^\/(t|r|staff|super|auth|pay|reset|login)(\/|$)/;
const MENU_WORD = { el: 'Μενού', en: 'Menu', de: 'Speisekarte', fr: 'Menu', it: 'Menù', es: 'Menú', nl: 'Menu', pl: 'Menu' };

/**
 * Adds the search engine routes and returns `sitePage(file)` and `menuPage` for the page routes.
 * `ctx` gives what depends on the service: markets, addresses and venues.
 */
export function installSeo(app, ctx) {
  const { PUBLIC_DIR, PRODUCTION, marketOf, mainOrigin, venueOrigin, MAIN_URLS, BASE_DOMAIN, db, getVenue, venueBySlug, features, publicRestaurant } = ctx;
  const files = new Map();
  const load = async (file) => {
    if (PRODUCTION && files.has(file)) return files.get(file);
    const html = await readFile(join(PUBLIC_DIR, file), 'utf8');
    if (PRODUCTION) files.set(file, html);
    return html;
  };
  const inHead = (html, tags) => html.replace('</head>', `${tags.filter(Boolean).join('\n  ')}\n</head>`);
  const has = (html, what) => html.includes(what);
  const bothMarkets = () => !!(MAIN_URLS.gr && MAIN_URLS.us);
  const menuUrl = (venue, req) => `${BASE_DOMAIN ? venueOrigin(venue, req) : mainOrigin(req, venue.market)}/m/${venue.slug}`;
  // Venues whose menu is public: a running trial or subscription, not the demos.
  const listed = (venue) => venue && !venue.isDemo && venue.status !== 'suspended' && !features(venue).inactive;
  // A page for searches and the same page in the other language, when both websites have an address.
  const landingAlternates = (market, page) => {
    const pair = pairOf(market, page);
    if (!pair || !bothMarkets()) return [];
    const [gr, us] = market === 'us' ? [pair, page] : [page, pair];
    return [['el', `${MAIN_URLS.gr}${gr.path}`], ['en-US', `${MAIN_URLS.us}${us.path}`]];
  };

  // Private pages and venue pages other than the menu stay out of search results.
  app.use((req, res, next) => {
    if (PRIVATE.test(req.path) || req.path.startsWith('/api/') || req.path.startsWith('/staff')) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  app.get('/robots.txt', (req, res) => {
    const origin = req.hostVenue ? venueOrigin(req.hostVenue, req) : mainOrigin(req);
    res.type('text/plain').send([
      'User-agent: *',
      // The menu of a venue loads its dishes from /api/public, so search engines may read it.
      'Allow: /api/public/',
      ...['/api/', '/staff', '/super', '/auth/', '/pay/'].map((p) => `Disallow: ${p}`),
      '',
      `Sitemap: ${origin}/sitemap.xml`,
      '',
    ].join('\n'));
  });

  // IndexNow (Bing, Yandex, Seznam, Naver): the key is published at /<key>.txt so the engines know the pings are ours.
  const indexNowKey = (market) => process.env.INDEXNOW_KEY
    || createHash('sha256').update(`kalimenu-indexnow:${MAIN_URLS[market] || market}`).digest('hex').slice(0, 32);
  app.get('/:key.txt', (req, res, next) => {
    if (req.hostVenue || req.params.key !== indexNowKey(marketOf(req))) return next();
    res.type('text/plain').send(indexNowKey(marketOf(req)));
  });

  let cached = { gr: null, us: null };
  app.get('/sitemap.xml', async (req, res, next) => {
    try {
      const urls = [];
      if (req.hostVenue) {
        if (listed(req.hostVenue)) urls.push({ loc: menuUrl(req.hostVenue, req) });
      } else {
        const market = marketOf(req);
        const hit = cached[market];
        if (hit && Date.now() - hit.at < 3600_000) return res.type('application/xml').send(hit.xml);
        const origin = mainOrigin(req, market);
        for (const [file, path] of Object.entries(SITE_PAGES)) {
          if (file === 'login.html') continue;
          const alt = bothMarkets() ? [['el', `${MAIN_URLS.gr}${path}`], ['en-US', `${MAIN_URLS.us}${path}`]] : [];
          urls.push({ loc: `${origin}${path}`, alt, priority: path === '/' ? '1.0' : '0.6', lastmod: SITE_UPDATED });
        }
        // The pages for searches, with the same page of the other language where there is one.
        for (const page of LANDING[market] || []) {
          urls.push({ loc: `${origin}${page.path}`, alt: landingAlternates(market, page), priority: '0.8', lastmod: LANDING_UPDATED });
        }
        // The menus of the venues of this market (each on its own address).
        for (const { id } of await db.all('SELECT id FROM venues ORDER BY id')) {
          const venue = await getVenue(id);
          if (listed(venue) && venue.market === market) urls.push({ loc: menuUrl(venue, req), priority: '0.5' });
        }
      }
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${(u.alt || []).map(([l, h]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(h)}"/>`).join('')}${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}${u.priority ? `<priority>${u.priority}</priority>` : ''}</url>`).join('\n')}
</urlset>
`;
      if (!req.hostVenue) cached[marketOf(req)] = { at: Date.now(), xml };
      res.type('application/xml').send(xml);
    } catch (e) { next(e); }
  });

  /** A page of the websites (Greek on kalimenu.gr, English on kalimenu.com) with its search engine tags. */
  const sitePage = (file) => async (req, res, next) => {
    try {
      const market = marketOf(req);
      const localFile = market === 'us' && ctx.EN_PAGES.has(file) ? `en/${file}` : file;
      let html = await load(localFile);
      const path = SITE_PAGES[file];
      if (!path) return res.type('html').send(html);
      const origin = mainOrigin(req, market);
      const url = `${origin}${path}`;
      const title = plain(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] || 'Kalimenu');
      const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] || DESCRIPTIONS[market][file] || '';
      const tags = [
        !has(html, 'name="description"') && description ? `<meta name="description" content="${esc(description)}">` : '',
        file === 'login.html' ? '<meta name="robots" content="noindex">' : '',
        `<link rel="canonical" href="${esc(url)}">`,
        ...(bothMarkets() && !has(html, 'hreflang=') ? [
          `<link rel="alternate" hreflang="el" href="${esc(MAIN_URLS.gr + path)}">`,
          `<link rel="alternate" hreflang="en-us" href="${esc(MAIN_URLS.us + path)}">`,
          `<link rel="alternate" hreflang="x-default" href="${esc(MAIN_URLS.gr + path)}">`,
        ] : []),
        !has(html, 'og:url') ? `<meta property="og:url" content="${esc(url)}">` : '',
        !has(html, 'og:title') ? `<meta property="og:title" content="${esc(title)}">` : '',
        !has(html, 'og:description') && description ? `<meta property="og:description" content="${esc(description)}">` : '',
        ...previewTags(origin, market, html),
        !has(html, 'og:type') ? '<meta property="og:type" content="website">' : '',
        '<meta property="og:site_name" content="Kalimenu">',
        `<meta property="og:locale" content="${LOCALE[market]}">`,
        !has(html, 'twitter:card') ? '<meta name="twitter:card" content="summary_large_image">' : '',
        file === 'index.html' ? homeData(html, market, origin) : '',
        ...(file === 'index.html' ? verification(market) : []),
      ];
      // The hard-coded address of the home page follows the address the page is served on.
      html = html.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(url)}">`)
        .replace(/(<meta property="og:image" content=")https:\/\/kalimenu\.(gr|com)/, `$1${origin}`);
      res.type('html').send(inHead(html, tags));
    } catch (e) { next(e); }
  };

  // Structured data of the home page: the company, the product with its prices, and the questions and answers.
  function homeData(html, market, origin) {
    const currency = market === 'us' ? 'USD' : 'EUR';
    const faq = [...html.matchAll(/<details><summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)]
      .map(([, q, a]) => ({ '@type': 'Question', name: plain(q), acceptedAnswer: { '@type': 'Answer', text: plain(a) } }));
    const graph = [
      { '@type': 'Organization', '@id': `${origin}/#org`, name: 'Kalimenu', url: `${origin}/`, logo: `${origin}/brand/icon-512.png` },
      { '@type': 'WebSite', '@id': `${origin}/#site`, url: `${origin}/`, name: 'Kalimenu', inLanguage: LANG[market], publisher: { '@id': `${origin}/#org` } },
      {
        '@type': 'SoftwareApplication', name: 'Kalimenu', applicationCategory: 'BusinessApplication', operatingSystem: 'Web',
        url: `${origin}/`, image: previewImage(origin, market), publisher: { '@id': `${origin}/#org` },
        offers: Object.values(PLANS).map((p) => ({ '@type': 'Offer', name: p.name, price: ((p.prices[currency] ?? p.month) / 100).toFixed(2), priceCurrency: currency,
          url: `${origin}/signup` })),
      },
      ...(faq.length ? [{ '@type': 'FAQPage', mainEntity: faq }] : []),
    ];
    return ldJson({ '@context': 'https://schema.org', '@graph': graph });
  }

  /** The menu of a venue without a table (/m/<code>): title, description and image for search results and shared links. */
  const menuPage = async (req, res, next) => {
    try {
      let html = await load('customer.html');
      const venue = req.hostVenue || await venueBySlug(req.params.slug);
      if (!venue || (req.hostVenue && req.params.slug !== venue.slug)) return res.type('html').send(html);
      const r = publicRestaurant(venue);
      const lang = venue.settings.defaultLanguage || (venue.market === 'us' ? 'en' : 'el');
      const url = menuUrl(venue, req);
      const origin = new URL(url).origin;
      const pick = (obj) => (obj && (obj[lang] || obj.en || obj.el || Object.values(obj)[0])) || '';
      const title = `${r.name} · ${MENU_WORD[lang] || 'Menu'}`;
      const description = [pick(r.description), r.address].filter(Boolean).join(' · ').slice(0, 300)
        || `${MENU_WORD[lang] || 'Menu'} ${r.name}`;
      const image = absolute(origin, r.coverUrl || r.logoUrl) || previewImage(mainOrigin(req, venue.market), venue.market);
      const restaurant = {
        '@context': 'https://schema.org', '@type': 'Restaurant', name: r.name, url, hasMenu: url, image,
        ...(r.address ? { address: r.address } : {}), ...(r.phone ? { telephone: r.phone } : {}),
        ...(pick(r.description) ? { description: pick(r.description) } : {}), currenciesAccepted: venue.currency,
      };
      html = html.replace('<html lang="el">', `<html lang="${esc(lang)}">`).replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
      res.type('html').send(inHead(html, [
        `<meta name="description" content="${esc(description)}">`,
        listed(venue) ? `<link rel="canonical" href="${esc(url)}">` : '<meta name="robots" content="noindex">',
        `<meta property="og:type" content="website">`,
        `<meta property="og:url" content="${esc(url)}">`,
        `<meta property="og:title" content="${esc(title)}">`,
        `<meta property="og:description" content="${esc(description)}">`,
        `<meta property="og:image" content="${esc(image)}">`,
        '<meta name="twitter:card" content="summary_large_image">',
        listed(venue) ? ldJson(restaurant) : '',
      ]));
    } catch (e) { next(e); }
  };

  /** The pages for searches (/qr-menu, /psifiako-menou… on kalimenu.gr, /qr-code-menu… on kalimenu.com), see landing.js. */
  const landingPage = (req, res, next) => {
    const market = marketOf(req);
    const page = !req.hostVenue && landingFor(market, req.path);
    if (!page) return next();
    const origin = mainOrigin(req, market);
    const url = `${origin}${page.path}`;
    const alt = landingAlternates(market, page);
    const graph = [
      { '@type': 'WebPage', '@id': url, url, name: page.title, description: page.description, inLanguage: LANG[market],
        isPartOf: { '@type': 'WebSite', '@id': `${origin}/#site`, url: `${origin}/`, name: 'Kalimenu' }, breadcrumb: { '@id': `${url}#crumbs` },
        primaryImageOfPage: previewImage(origin, market) },
      { '@type': 'BreadcrumbList', '@id': `${url}#crumbs`, itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Kalimenu', item: `${origin}/` },
        { '@type': 'ListItem', position: 2, name: page.name, item: url }] },
      { '@type': 'FAQPage', mainEntity: page.faq.map(([q, a]) => ({ '@type': 'Question', name: plain(q), acceptedAnswer: { '@type': 'Answer', text: plain(a) } })) },
    ];
    const head = [
      `<link rel="canonical" href="${esc(url)}">`,
      ...(alt.length ? [...alt.map(([l, h]) => `<link rel="alternate" hreflang="${l.toLowerCase()}" href="${esc(h)}">`),
        `<link rel="alternate" hreflang="x-default" href="${esc(alt[0][1])}">`] : []),
      '<meta property="og:type" content="website">',
      `<meta property="og:url" content="${esc(url)}">`,
      `<meta property="og:title" content="${esc(page.title)}">`,
      `<meta property="og:description" content="${esc(page.description)}">`,
      ...previewTags(origin, market),
      '<meta property="og:site_name" content="Kalimenu">',
      `<meta property="og:locale" content="${LOCALE[market]}">`,
      '<meta name="twitter:card" content="summary_large_image">',
      ldJson({ '@context': 'https://schema.org', '@graph': graph }),
    ].join('\n  ');
    res.type('html').send(renderLanding(market, page, head));
  };
  for (const path of new Set(Object.values(LANDING).flat().map((p) => p.path))) app.get(path, landingPage);

  /**
   * Tells the search engines that support IndexNow (Bing, Yandex…) about the pages of the websites, so new and changed
   * pages are read within days. Google reads the sitemap (submitted once in Search Console).
   */
  async function notifySearchEngines() {
    for (const market of ['gr', 'us']) {
      const origin = MAIN_URLS[market];
      if (!origin) continue;
      const urlList = [...Object.entries(SITE_PAGES).filter(([f]) => f !== 'login.html').map(([, path]) => `${origin}${path}`),
        ...(LANDING[market] || []).map((p) => `${origin}${p.path}`)];
      const key = indexNowKey(market);
      try {
        const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ host: new URL(origin).host, key, keyLocation: `${origin}/${key}.txt`, urlList }), signal: AbortSignal.timeout(15000) });
        console.log(`IndexNow ${new URL(origin).host}: ${r.status} (${urlList.length} pages)`);
      } catch (e) { console.error('IndexNow', origin, e.message); }
    }
  }

  return { sitePage, menuPage, notifySearchEngines };
}
