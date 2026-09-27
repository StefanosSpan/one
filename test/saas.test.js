// Online sign-up, venues kept apart, plan limits, billing webhooks, super admin and migration of old databases.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'kalimenu-saas-'));
process.env.DATA_DIR = dir;
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
if (process.env.DATABASE_URL) {
  const { openDatabase, dropAll } = await import('../server/db/adapter.js');
  const tmp = await openDatabase();
  await dropAll(tmp);
  await tmp.close();
}
const { app } = await import('../server/index.js');
const { db, ensureSuperAdmin } = await import('../server/db.js');

let server, base;

// Minimal cookie-keeping client: each "browser" has its own cookies.
function browser() {
  const jar = {};
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv.split('=');
      jar[k] = v.join('=');
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

const owner = browser();
let signup;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  signup = await owner('/api/account/signup', { method: 'POST', body: {
    business: 'Ψαροταβέρνα Το Κύμα', email: 'Owner@Example.com', password: 'secret-pass-1', acceptTerms: true, plan: 'pro', tables: 8,
  } });
});

after(async () => { server.close(); await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('an owner signs up online and gets a venue with a free trial', async () => {
  assert.equal(signup.status, 201);
  assert.equal(signup.data.venue.slug, 'psarotaverna-to-kyma');
  assert.equal(signup.data.venue.status, 'trialing');
  assert.equal(signup.data.venue.effectivePlan, 'pro');
  const days = (new Date(signup.data.venue.trialEndsAt) - Date.now()) / 86400_000;
  assert.ok(days > 59 && days <= 60);

  const me = await owner('/api/staff/me');
  assert.equal(me.data.role, 'admin');
  assert.equal(me.data.owner, true);
  const tables = await owner('/api/admin/tables');
  assert.equal(tables.data.length, 8);
  // New venues get their own random six-digit PINs, never the demo ones.
  const settings = (await owner('/api/admin/settings')).data;
  assert.match(settings.pins.admin, /^\d{6}$/);
  assert.notEqual(settings.pins.admin, '1234');
  assert.match(settings.staffUrl, /\/staff\?v=psarotaverna-to-kyma$/);
  assert.equal(settings.restaurant.address, ''); // the demo address is not copied

  assert.equal((await owner('/api/account/signup', { method: 'POST', body: {
    business: 'Άλλο', email: 'owner@example.com', password: 'secret-pass-1', acceptTerms: true,
  } })).status, 409);
  assert.equal((await browser()('/api/account/signup', { method: 'POST', body: {
    business: 'Άλλο', email: 'x@example.com', password: 'short', acceptTerms: true,
  } })).status, 400);
});

test('owners log in with e-mail and password', async () => {
  const b = browser();
  assert.equal((await b('/api/account/login', { method: 'POST', body: { email: 'owner@example.com', password: 'wrong-pass' } })).status, 401);
  assert.equal((await b('/api/account/login', { method: 'POST', body: { email: 'OWNER@example.com', password: 'secret-pass-1' } })).status, 200);
  assert.equal((await b('/api/staff/me')).data.venue.slug, 'psarotaverna-to-kyma');
});

test('venues cannot see or change each other\'s data', async () => {
  const demo = browser();
  assert.equal((await demo('/api/staff/login', { method: 'POST', body: { venue: 'demo', pin: '1234' } })).status, 200);
  const demoItems = (await demo('/api/admin/menu')).data.items;
  const mine = (await owner('/api/admin/menu')).data;
  assert.equal(mine.items.length, 21); // own copy of the example menu
  assert.ok(!mine.items.some((i) => demoItems.some((d) => d.id === i.id)));

  const foreign = demoItems[0];
  const put = await owner(`/api/admin/items/${foreign.id}`, { method: 'PUT', body: { ...foreign, categoryId: mine.categories[0].id, price: 1 } });
  assert.equal(put.status, 404);
  assert.equal((await owner(`/api/staff/items/${foreign.id}/available`, { method: 'POST', body: { available: false } })).status, 404);

  // An order at the new venue with a dish of the demo venue is refused.
  const token = (await owner('/api/admin/tables')).data[0].token;
  assert.equal((await owner(`/api/public/table/${token}/orders`, { method: 'POST', body: { items: [{ id: foreign.id, qty: 1 }] } })).data.error, 'unknown_item');
  const order = await owner(`/api/public/table/${token}/orders`, { method: 'POST', body: { items: [{ id: mine.items[2].id, qty: 1 }] } });
  assert.equal(order.status, 201);
  assert.equal((await demo(`/api/staff/orders/${order.data.id}`)).status, 404);
  assert.ok(!(await demo('/api/staff/overview')).data.orders.some((o) => o.id === order.data.id));
  assert.ok((await owner('/api/staff/overview')).data.orders.some((o) => o.id === order.data.id));
});

test('staff log in with the venue code once there is more than one venue', async () => {
  const b = browser();
  const r = await b('/api/staff/login', { method: 'POST', body: { pin: '1111' } });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'venue_required');
  const pins = (await owner('/api/admin/settings')).data.pins;
  assert.equal((await b('/api/staff/login', { method: 'POST', body: { venue: 'demo', pin: pins.waiter } })).status, 401);
  const ok = await b('/api/staff/login', { method: 'POST', body: { venue: 'psarotaverna-to-kyma', pin: pins.waiter } });
  assert.equal(ok.data.role, 'waiter');
  assert.equal((await b('/api/account')).status, 403); // billing needs the owner's e-mail login
});

test('the free plan limits dishes, spots and ordering', async () => {
  const b = browser();
  await b('/api/account/signup', { method: 'POST', body: {
    business: 'Καντίνα', email: 'free@example.com', password: 'secret-pass-2', acceptTerms: true, plan: 'free', tables: 50, sample: false,
  } });
  const acc = (await b('/api/account')).data;
  assert.equal(acc.venue.effectivePlan, 'free');
  assert.equal(acc.usage.spots, 10); // capped by the plan
  assert.equal(acc.usage.items, 0);

  const tables = (await b('/api/admin/tables')).data;
  const pub = (await b(`/api/public/table/${tables[0].token}`)).data;
  assert.deepEqual(pub.features, { ordering: false, calls: false });
  assert.equal(pub.restaurant.poweredBy, true);
  assert.equal((await b(`/api/public/table/${tables[0].token}/calls`, { method: 'POST', body: { type: 'waiter' } })).status, 403);

  const more = await b('/api/admin/tables', { method: 'POST', body: { count: 1 } });
  assert.equal(more.status, 403);
  assert.equal(more.data.code, 'plan_limit');
  assert.equal((await b('/api/admin/tables', { method: 'POST', body: { count: 1, kind: 'room' } })).data.code, 'plan_limit');

  const cat = (await b('/api/admin/menu')).data.categories[0].id;
  for (let i = 0; i < 40; i++) {
    assert.equal((await b('/api/admin/items', { method: 'POST', body: { name: { el: `Πιάτο ${i}` }, price: 1, categoryId: cat } })).status, 201);
  }
  const over = await b('/api/admin/items', { method: 'POST', body: { name: { el: 'Ένα ακόμα' }, price: 1, categoryId: cat } });
  assert.equal(over.data.code, 'plan_limit');
  const items = (await b(`/api/public/table/${tables[0].token}`)).data.items;
  assert.equal((await b(`/api/public/table/${tables[0].token}/orders`, { method: 'POST', body: { items: [{ id: items[0].id, qty: 1 }] } })).data.error, 'ordering_disabled');

  // Without Stripe keys (local testing) choosing a plan activates it straight away.
  const upgrade = await b('/api/account/checkout', { method: 'POST', body: { plan: 'pro', interval: 'year' } });
  assert.equal(upgrade.data.demo, true);
  const after = (await b('/api/account')).data.venue;
  assert.equal(after.effectivePlan, 'pro');
  assert.equal(after.interval, 'year');
  assert.equal((await b('/api/admin/items', { method: 'POST', body: { name: { el: 'Ένα ακόμα' }, price: 1, categoryId: cat } })).status, 201);
  // Seasonal pause: back to the free features, menu still online.
  assert.equal((await b('/api/account/pause', { method: 'POST', body: { paused: true } })).data.venue.effectivePlan, 'free');
  assert.equal((await b(`/api/public/table/${tables[0].token}`)).status, 200);
  assert.equal((await b('/api/account/pause', { method: 'POST', body: { paused: false } })).data.venue.effectivePlan, 'pro');
});

test('Stripe webhooks are verified and update the subscription', async () => {
  const venueId = (await db.get("SELECT id FROM venues WHERE slug = 'psarotaverna-to-kyma'")).id;
  const send = (event, secret = 'whsec_test') => {
    const payload = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
    return fetch(`${base}/api/stripe/webhook`, { method: 'POST', body: payload,
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` } });
  };
  const completed = { type: 'checkout.session.completed', data: { object: {
    mode: 'subscription', customer: 'cus_1', subscription: 'sub_1', client_reference_id: String(venueId),
    metadata: { venue_id: String(venueId), plan: 'hotel', interval: 'month' } } } };
  assert.equal((await send(completed, 'wrong')).status, 400);
  assert.equal((await send(completed)).status, 200);
  let me = (await owner('/api/account')).data;
  assert.equal(me.venue.plan, 'hotel');
  assert.equal(me.venue.status, 'active');
  assert.equal(me.billing.subscription, true);

  await send({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'past_due', metadata: {} } } });
  assert.equal((await owner('/api/account')).data.venue.status, 'past_due');
  await send({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled', metadata: {} } } });
  me = (await owner('/api/account')).data;
  assert.equal(me.venue.status, 'canceled');
  assert.equal(me.venue.effectivePlan, 'free');
});

test('the super admin manages every venue', async () => {
  await ensureSuperAdmin('boss@example.com', 'super-secret-123');
  const boss = browser();
  assert.equal((await boss('/api/super/overview')).status, 401);
  assert.equal((await owner('/api/super/overview')).status, 401); // an owner is not an administrator
  assert.equal((await boss('/api/super/login', { method: 'POST', body: { email: 'boss@example.com', password: 'nope-nope-nope' } })).status, 401);
  assert.equal((await boss('/api/super/login', { method: 'POST', body: { email: 'boss@example.com', password: 'super-secret-123' } })).status, 200);

  const { data } = await boss('/api/super/overview');
  assert.equal(data.totals.venues, 2); // the demo venue is not counted
  const kyma = data.venues.find((v) => v.slug === 'psarotaverna-to-kyma');
  assert.equal(kyma.email, 'owner@example.com');
  assert.equal(kyma.orders30, 1);
  assert.equal(data.venues.find((v) => v.slug === 'kantina').mrr, Math.round(1490 * 10 / 12)); // yearly Pro: 10 months spread over 12

  // Give a customer more trial time.
  const ext = await boss(`/api/super/venues/${kyma.id}`, { method: 'PUT', body: { plan: 'pro', extendTrialDays: 30 } });
  assert.equal(ext.data.venue.status, 'trialing');
  assert.equal(ext.data.venue.effectivePlan, 'pro');

  // A password link for the owner, e.g. to send by message.
  const link = (await boss(`/api/super/venues/${kyma.id}/reset-link`, { method: 'POST' })).data.link;
  const token = new URL(link).searchParams.get('token');
  const b = browser();
  assert.equal((await b('/api/account/reset', { method: 'POST', body: { token, password: 'new-password-9' } })).status, 200);
  assert.equal((await b('/api/account/reset', { method: 'POST', body: { token, password: 'new-password-9' } })).status, 400);
  assert.equal((await browser()('/api/account/login', { method: 'POST', body: { email: 'owner@example.com', password: 'new-password-9' } })).status, 200);

  // Open a venue's administration.
  const imp = await boss(`/api/super/venues/${kyma.id}/impersonate`, { method: 'POST' });
  assert.equal(imp.status, 200);
  assert.equal((await boss('/api/staff/me')).data.venue.slug, 'psarotaverna-to-kyma');

  // Suspend: the menu and the logins stop working.
  const qr = (await owner('/api/admin/tables')).data[0].token;
  await boss(`/api/super/venues/${kyma.id}`, { method: 'PUT', body: { status: 'suspended' } });
  assert.equal((await owner(`/api/public/table/${qr}`)).status, 404);
  assert.equal((await owner('/api/staff/me')).status, 401);
  await boss(`/api/super/venues/${kyma.id}`, { method: 'PUT', body: { status: 'active' } });
  assert.equal((await owner(`/api/public/table/${qr}`)).status, 200);

  // Delete needs the venue code typed in.
  const free = data.venues.find((v) => v.slug === 'kantina');
  assert.equal((await boss(`/api/super/venues/${free.id}`, { method: 'DELETE', body: { confirm: 'x' } })).status, 400);
  assert.equal((await boss(`/api/super/venues/${free.id}`, { method: 'DELETE', body: { confirm: 'kantina' } })).status, 200);
  assert.equal((await boss('/api/super/overview')).data.totals.venues, 1);
  assert.equal((await browser()('/api/account/login', { method: 'POST', body: { email: 'free@example.com', password: 'secret-pass-2' } })).status, 401);
});

test('uploads are stored in the database', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const up = await owner('/api/admin/upload', { method: 'POST', body: { dataUrl: `data:image/png;base64,${png}` } });
  assert.equal(up.status, 200);
  const res = await fetch(base + up.data.url);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(png, 'base64'));
});

test('a database from the single-venue version is moved into venue 1', { skip: !!process.env.DATABASE_URL }, async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const file = join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, icon TEXT DEFAULT '', sort INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
    CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT DEFAULT '{}', price_cents INTEGER NOT NULL, allergens TEXT DEFAULT '[]', tags TEXT DEFAULT '[]',
      emoji TEXT DEFAULT '', image_url TEXT DEFAULT '', available INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);
    CREATE TABLE tables (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, token TEXT NOT NULL UNIQUE, active INTEGER DEFAULT 1);
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE, status TEXT NOT NULL,
      note TEXT DEFAULT '', lang TEXT DEFAULT 'el', total_cents INTEGER NOT NULL, paid INTEGER DEFAULT 0, closed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      item_id INTEGER, name TEXT NOT NULL, qty INTEGER NOT NULL, price_cents INTEGER NOT NULL, note TEXT DEFAULT '');
    CREATE TABLE calls (id INTEGER PRIMARY KEY AUTOINCREMENT, table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE, type TEXT NOT NULL,
      payment_method TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL);
    CREATE INDEX idx_orders_table ON orders(table_id, closed);
    INSERT INTO settings VALUES ('restaurant', '{"name":"Παλιά Ταβέρνα"}'), ('pins', '{"admin":"4321","waiter":"1111","kitchen":"2222"}');
    INSERT INTO categories (id, name) VALUES (7, '{"el":"Ορεκτικά"}');
    INSERT INTO items (id, category_id, name, price_cents) VALUES (30, 7, '{"el":"Φάβα"}', 550);
    INSERT INTO tables (id, label, token) VALUES (5, '5', 'oldtoken');
    INSERT INTO orders (id, table_id, status, total_cents, created_at, updated_at) VALUES (9, 5, 'served', 550, '2026-01-01', '2026-01-01');
    INSERT INTO order_items (order_id, item_id, name, qty, price_cents) VALUES (9, 30, '{"el":"Φάβα"}', 1, 550);
  `);
  old.close();
  const { openDatabase } = await import('../server/db/adapter.js');
  const moved = await openDatabase({ file, url: '' });
  const venue = await moved.get('SELECT * FROM venues');
  assert.equal(venue.id, 1);
  assert.equal(venue.name, 'Παλιά Ταβέρνα');
  assert.equal(venue.plan, 'hotel');
  assert.equal((await moved.get("SELECT value FROM settings WHERE venue_id = 1 AND key = 'pins'")).value.includes('4321'), true);
  assert.equal((await moved.get('SELECT * FROM items WHERE id = 30')).options, '[]');
  const table = await moved.get("SELECT * FROM tables WHERE token = 'oldtoken'");
  assert.equal(table.venue_id, 1);
  assert.equal(table.kind, 'table');
  assert.equal((await moved.get('SELECT venue_id FROM orders WHERE id = 9')).venue_id, 1);
  assert.equal((await moved.get('SELECT COUNT(*) AS n FROM order_items')).n, 1);
  // New rows continue after the old ids.
  assert.ok(await moved.insert("INSERT INTO categories (venue_id, name) VALUES (1, '{}')") > 7);
  await moved.close();
  // Opening again does nothing more.
  const again = await openDatabase({ file, url: '' });
  assert.equal((await again.get('SELECT COUNT(*) AS n FROM venues')).n, 1);
  await again.close();
});
