// Search engines and link previews: robots.txt, sitemaps, canonical and language links, structured data,
// previews of each venue's menu, and private pages kept out of search results.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kalimenu-seo-'));
Object.assign(process.env, { DATA_DIR: dir, BASE_DOMAIN: 'kalimenu.test', US_BASE_DOMAIN: 'kalimenu-us.test',
  APP_URL: 'http://kalimenu.test', US_APP_URL: 'http://kalimenu-us.test' });
if (process.env.DATABASE_URL) {
  const { openDatabase, dropAll } = await import('../server/db/adapter.js');
  const tmp = await openDatabase();
  await dropAll(tmp);
  await tmp.close();
}
const { app } = await import('../server/index.js');
const { db } = await import('../server/db.js');

let server, port;
const jar = {};
const get = (host, path, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
  const data = body === undefined ? undefined : JSON.stringify(body);
  const req = request({ host: '127.0.0.1', port, path, method, headers: { Host: host, 'Content-Type': 'application/json',
    Cookie: Object.entries(jar[host] || {}).map(([k, v]) => `${k}=${v}`).join('; '), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let raw = '';
    res.on('data', (c) => { raw += c; });
    res.on('end', () => {
      for (const c of res.headers['set-cookie'] || []) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); (jar[host] ||= {})[k] = v.join('='); }
      let json = null;
      try { json = JSON.parse(raw); } catch { /* page */ }
      resolve({ status: res.statusCode, headers: res.headers, text: raw, data: json });
    });
  });
  req.on('error', reject);
  req.end(data);
});
const GR = 'kalimenu.test';
const US = 'kalimenu-us.test';
let slug;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;
  const r = await get(GR, '/api/account/signup', { method: 'POST', body: { business: 'Ταβέρνα Θάλασσα', email: 'seo@example.com', password: 'secret-pass-1', acceptTerms: true, tables: 4 } });
  assert.equal(r.status, 201);
  slug = r.data.venue.slug;
});
after(async () => { server.close(); await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('robots.txt and sitemaps: the website pages and the menus of the venues, each on its own address', async () => {
  const robots = (await get(GR, '/robots.txt')).text;
  assert.match(robots, /Disallow: \/staff/);
  assert.match(robots, /Allow: \/api\/public\//);
  assert.match(robots, /Sitemap: http:\/\/kalimenu\.test\/sitemap\.xml/);
  const map = (await get(GR, '/sitemap.xml')).text;
  assert.match(map, /<loc>http:\/\/kalimenu\.test\/terms<\/loc><xhtml:link rel="alternate" hreflang="el"/);
  assert.match(map, new RegExp(`<loc>http://${slug}\\.kalimenu\\.test/m/${slug}</loc>`));
  assert.doesNotMatch(map, /\/m\/demo</, 'the demo is not listed');
  assert.doesNotMatch((await get(US, '/sitemap.xml')).text, new RegExp(`/m/${slug}<`), 'Greek venues are not in the United States sitemap');
  // A venue's address lists its own menu.
  const host = `${slug}.${GR}`;
  assert.match((await get(host, '/robots.txt')).text, new RegExp(`Sitemap: http://${slug}\\.kalimenu\\.test/sitemap\\.xml`));
  assert.match((await get(host, '/sitemap.xml')).text, new RegExp(`<loc>http://${host}/m/${slug}</loc>`));
});

test('website pages: canonical address, both languages, description and structured data', async () => {
  const home = (await get(GR, '/')).text;
  assert.match(home, /<link rel="canonical" href="http:\/\/kalimenu\.test\/">/);
  const data = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const types = data['@graph'].map((x) => x['@type']);
  assert.deepEqual(types, ['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage']);
  assert.deepEqual(data['@graph'][2].offers.map((o) => [o.price, o.priceCurrency]), [['14.90', 'EUR'], ['29.90', 'EUR']]);
  assert.ok(data['@graph'][3].mainEntity.length >= 5);
  const us = (await get(US, '/')).text;
  assert.deepEqual(JSON.parse(us.match(/application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'][2].offers.map((o) => o.price), ['29.00', '59.00']);
  assert.match(us, /<meta property="og:url" content="http:\/\/kalimenu-us\.test\/">/);
  const terms = (await get(US, '/terms')).text;
  assert.match(terms, /<link rel="canonical" href="http:\/\/kalimenu-us\.test\/terms">/);
  assert.match(terms, /hreflang="el" href="http:\/\/kalimenu\.test\/terms"/);
  assert.match(terms, /<meta name="description" content="Terms of Service/);
});

test('the menu link of a venue has its own title, preview and restaurant data; private pages stay out of search', async () => {
  const host = `${slug}.${GR}`;
  const menu = (await get(host, `/m/${slug}`)).text;
  assert.match(menu, /<title>Ταβέρνα Θάλασσα · Μενού<\/title>/);
  assert.match(menu, new RegExp(`<link rel="canonical" href="http://${host}/m/${slug}">`));
  const data = JSON.parse(menu.match(/application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual([data['@type'], data.name, data.hasMenu], ['Restaurant', 'Ταβέρνα Θάλασσα', `http://${host}/m/${slug}`]);
  // The demo menu is not indexed.
  assert.match((await get(`demo.${GR}`, '/m/demo')).text, /<meta name="robots" content="noindex">/);
  // Table links, staff screens and sign-in are private.
  const { token } = await db.get("SELECT t.token FROM tables t JOIN venues v ON v.id = t.venue_id WHERE v.slug = ? AND t.kind = 'table' ORDER BY t.id LIMIT 1", [slug]);
  assert.equal((await get(host, `/t/${token}`)).headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal((await get(host, '/staff')).headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal((await get(GR, '/login')).headers['x-robots-tag'], 'noindex, nofollow');
});

test('pages for searches: one per market, with their own title, language links, questions, and listed in the sitemap', async () => {
  const { LANDING } = await import('../server/landing.js');
  const page = await get(GR, '/psifiako-menou');
  assert.equal(page.status, 200);
  assert.match(page.text, /<title>Ψηφιακό μενού εστιατορίου σε 8 γλώσσες \| Kalimenu<\/title>/);
  assert.match(page.text, /<link rel="canonical" href="http:\/\/kalimenu\.test\/psifiako-menou">/);
  assert.match(page.text, /<h1>Ψηφιακό μενού εστιατορίου/);
  const data = JSON.parse(page.text.match(/application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(data['@graph'].map((x) => x['@type']), ['WebPage', 'BreadcrumbList', 'FAQPage']);
  assert.ok(data['@graph'][2].mainEntity.length >= 3);
  // The same page in the other language is linked both ways.
  assert.match((await get(GR, '/qr-menu')).text, /hreflang="en-us" href="http:\/\/kalimenu-us\.test\/qr-code-menu"/);
  assert.match((await get(US, '/qr-code-menu')).text, /hreflang="el" href="http:\/\/kalimenu\.test\/qr-menu"/);
  // Each website has only its own pages; venue addresses have none.
  assert.equal((await get(US, '/psifiako-menou')).status, 404);
  assert.equal((await get(GR, '/qr-code-menu')).status, 404);
  assert.equal((await get(`${slug}.${GR}`, '/qr-menu')).status, 404);
  // Unique titles and descriptions, each page in its website's sitemap with the date it changed.
  for (const [market, host] of [['gr', GR], ['us', US]]) {
    const pages = LANDING[market];
    assert.equal(new Set(pages.map((p) => p.title)).size, pages.length);
    assert.equal(new Set(pages.map((p) => p.description)).size, pages.length);
    for (const p of pages) assert.ok(p.description.length <= 170, `${p.path}: description of ${p.description.length} characters`);
    const map = (await get(host, '/sitemap.xml')).text;
    for (const p of pages) assert.match(map, new RegExp(`<loc>http://${host.replace(/\./g, '\\.')}${p.path}</loc>.*<lastmod>\\d{4}-\\d\\d-\\d\\d</lastmod>`));
    // The home page links to every page for searches.
    const home = (await get(host, '/')).text;
    for (const p of pages) assert.ok(home.includes(`href="${p.path}"`), `the home page links to ${p.path}`);
  }
});

test('Search Console and Bing ownership tags, and the IndexNow key', async () => {
  process.env.GOOGLE_SITE_VERIFICATION = 'google-code-1, google-code-2';
  process.env.US_BING_SITE_VERIFICATION = 'bing-code';
  try {
    const home = (await get(GR, '/')).text;
    assert.match(home, /<meta name="google-site-verification" content="google-code-1">/);
    assert.match(home, /<meta name="google-site-verification" content="google-code-2">/);
    assert.doesNotMatch(home, /msvalidate/);
    const us = (await get(US, '/')).text;
    assert.match(us, /<meta name="msvalidate\.01" content="bing-code">/);
    assert.doesNotMatch(us, /google-code-1/, 'each website has its own codes');
  } finally {
    delete process.env.GOOGLE_SITE_VERIFICATION;
    delete process.env.US_BING_SITE_VERIFICATION;
  }
  // Without codes there are no empty tags.
  assert.doesNotMatch((await get(GR, '/')).text, /google-site-verification/);
  // IndexNow: the key file of each website is served at /<key>.txt and other .txt addresses are not.
  const { createHash } = await import('node:crypto');
  const key = createHash('sha256').update('kalimenu-indexnow:http://kalimenu.test').digest('hex').slice(0, 32);
  const r = await get(GR, `/${key}.txt`);
  assert.equal(r.status, 200);
  assert.equal(r.text, key);
  assert.equal((await get(US, `/${key}.txt`)).status, 404);
  assert.equal((await get(GR, '/0123456789abcdef.txt')).status, 404);
});
