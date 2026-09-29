// The United States market: kalimenu.com in English with dollar prices (New York), venues on <code>.kalimenu.com,
// an English demo, exports in English and no phone payments yet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kalimenu-us-'));
Object.assign(process.env, { DATA_DIR: dir, BASE_DOMAIN: 'kalimenu.test', US_BASE_DOMAIN: 'kalimenu-us.test', US_APP_URL: 'http://kalimenu-us.test',
  SUPERADMIN_EMAIL: 'boss@kalimenu.test', SUPERADMIN_PASSWORD: 'a-very-long-password-1' });
if (process.env.DATABASE_URL) {
  const { openDatabase, dropAll } = await import('../server/db/adapter.js');
  const tmp = await openDatabase();
  await dropAll(tmp);
  await tmp.close();
}
const { app } = await import('../server/index.js');
const { db, DEMO_PINS } = await import('../server/db.js');

let server, port;
function browser() {
  const jars = {};
  const call = (host, path, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
    const jar = (jars[host] ||= {});
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request({ host: '127.0.0.1', port, path, method, headers: {
      Host: host, 'Content-Type': 'application/json', Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
      ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
    } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        for (const c of res.headers['set-cookie'] || []) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); jar[k] = v.join('='); }
        let json = null;
        try { json = JSON.parse(raw); } catch { /* page */ }
        resolve({ status: res.statusCode, location: res.headers.location, data: json, text: raw });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
  call.open = (url) => { const u = new URL(url); return call(u.host, u.pathname + u.search); };
  return call;
}
const US = 'kalimenu-us.test';
const GR = 'kalimenu.test';
const owner = browser();
let slug;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;
});
after(async () => { server.close(); await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('each site shows its own market and prices', async () => {
  const g = browser();
  assert.equal((await g(US, '/api/site')).data.market, 'us');
  assert.equal((await g(GR, '/api/site')).data.market, 'gr');
  const us = (await g(US, '/api/plans')).data.plans;
  const gr = (await g(GR, '/api/plans')).data.plans;
  assert.deepEqual([us.pro.month, us.plus.month, us.pro.currency], [2900, 5900, 'USD']);
  assert.deepEqual([gr.pro.month, gr.plus.month, gr.pro.currency], [1490, 2990, 'EUR']);
  // www.kalimenu.com goes to kalimenu.com.
  assert.equal((await g(`www.${US}`, '/pricing?x=1')).location, `http://${US}/pricing?x=1`);
});

test('the New York demo: English, dollars, New York time, no phone payments', async () => {
  const g = browser();
  const demo = (await g(US, '/api/demo')).data;
  assert.equal(demo.venue, 'demo-us');
  const token = demo.tables[0].url.split('/').pop();
  const menu = (await g(`demo-us.${US}`, `/api/public/table/${token}`)).data;
  assert.equal(menu.defaultLanguage, 'en');
  assert.equal(menu.currency, 'USD');
  assert.equal(menu.restaurant.name, 'Your Restaurant');
  assert.equal(menu.payments.provider, 'off');
  const gr = (await g(GR, '/api/demo')).data;
  const grMenu = (await g(`demo.${GR}`, `/api/public/table/${gr.tables[0].url.split('/').pop()}`)).data;
  const salad = (m) => m.items.find((i) => i.name.en === 'Greek salad' || i.name.el === 'Χωριάτικη σαλάτα');
  assert.equal(salad(menu).price_cents, 2 * salad(grMenu).price_cents); // New York prices
  // Staff screens know the venue is in the United States.
  const pin = await g(`demo-us.${US}`, '/api/staff/login', { method: 'POST', body: { pin: DEMO_PINS.waiter } });
  assert.equal(pin.status, 200);
  const me = (await g(`demo-us.${US}`, '/api/staff/me')).data;
  assert.deepEqual([me.venue.market, me.venue.currency], ['us', 'USD']);
  assert.deepEqual(me.stations.map((s) => s.name), ['Kitchen', 'Bar']);
  assert.equal((await g(`demo-us.${US}`, '/api/demo')).data.pins.admin, DEMO_PINS.admin);
});

test('signing up on kalimenu.com creates a United States venue on its own .com address', async () => {
  const r = await owner(US, '/api/account/signup', { method: 'POST', body: {
    business: 'Mulberry Street Grill', email: 'owner@nyc.example', password: 'secret-pass-1', acceptTerms: true, tables: 8 } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  slug = r.data.venue.slug;
  assert.equal(r.data.venue.market, 'us');
  assert.match(r.data.next, new RegExp(`^http://${slug}\\.kalimenu-us\\.test/auth/handoff`));
  await owner.open(r.data.next);
  const host = `${slug}.${US}`;
  const account = (await owner(host, '/api/account')).data;
  assert.deepEqual([account.plans.pro.month, account.plans.pro.currency], [2900, 'USD']);
  const settings = (await owner(host, '/api/admin/settings')).data;
  assert.deepEqual([settings.currency, settings.defaultLanguage, settings.timezone, settings.payments.provider], ['USD', 'en', 'America/New_York', 'off']);
  // The Greek domain sends the venue to its .com address.
  assert.equal((await browser()(`${slug}.${GR}`, '/staff')).location, `http://${host}/staff`);
  // A second venue of the same owner stays in the United States.
  const more = await owner(host, '/api/account/venues', { method: 'POST', body: { business: 'Mulberry Street Bar' } });
  assert.equal(more.data.venue.market, 'us');
  // Viva is not offered in the United States.
  assert.equal((await owner(host, '/api/admin/payments/viva-connect', { method: 'POST', body: { email: 'x@y.z' } })).status, 400);
});

test('exports of a United States venue are in English with dollar amounts', async () => {
  const host = `${slug}.${US}`;
  const tables = (await owner(host, '/api/admin/tables')).data;
  const menu = (await owner(host, `/api/staff/tables/${tables[0].id}/menu`)).data;
  const dish = menu.items.find((i) => !i.options.length);
  const o = await owner(host, `/api/staff/tables/${tables[0].id}/orders`, { method: 'POST', body: { items: [{ id: dish.id, qty: 1 }] } });
  assert.equal(o.data.takenBy, 'Admin');
  const csv = (await owner(host, '/api/admin/orders.csv')).text;
  assert.match(csv, /"Number";"Date";"Time";"Spot"/);
  assert.match(csv, new RegExp(`"Table 1";"Approved";"EN";"1x ${dish.name.en}"`));
  assert.match(csv, new RegExp(`"${(dish.price / 100).toFixed(2)}"`));
});

test('the platform administration counts dollar and euro revenue apart', async () => {
  const boss = browser();
  await boss(GR, '/api/super/login', { method: 'POST', body: { email: 'boss@kalimenu.test', password: 'a-very-long-password-1' } });
  const venue = (await boss(GR, '/api/super/overview')).data.venues.find((v) => v.slug === slug);
  await boss(GR, `/api/super/venues/${venue.id}`, { method: 'PUT', body: { plan: 'pro', status: 'active' } });
  const o = (await boss(GR, '/api/super/overview')).data;
  assert.equal(o.totals.mrrUsd, 2900);
  assert.equal(o.totals.mrr, 0);
  assert.equal(o.totals.usVenues, 2);
  assert.equal(o.venues.find((v) => v.slug === slug).url, `http://${slug}.${US}`);
});

test('each domain shows its own website: English on kalimenu.com, Greek on kalimenu.gr', async () => {
  const g = browser();
  for (const path of ['/', '/signup', '/login', '/terms', '/privacy', '/cookies', '/demo']) {
    const us = await g(US, path);
    const gr = await g(GR, path);
    assert.match(us.text, /<html lang="en">/, `${path} on kalimenu.com`);
    assert.match(gr.text, /<html lang="el">/, `${path} on kalimenu.gr`);
  }
  const home = (await g(US, '/')).text;
  assert.match(home, /walkupdigital\.com/);
  assert.match((await g(GR, '/')).text, /walkupdigital\.com/);
  // No analytics or ads unless their ids are set (and then only after consent, in the browser).
  assert.deepEqual((await g(US, '/api/site')).data.tracking, { ga: '', metaPixel: '' });
});
