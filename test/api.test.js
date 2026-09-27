import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'taverna-test-'));
process.env.DATA_DIR = dir;
// With DATABASE_URL set the same tests run against PostgreSQL (the database is emptied first).
if (process.env.DATABASE_URL) {
  const { openDatabase, dropAll } = await import('../server/db/adapter.js');
  const tmp = await openDatabase();
  await dropAll(tmp);
  await tmp.close();
}
const { app } = await import('../server/index.js');
const { db } = await import('../server/db.js');

let server, base, token;
const cookies = {};

async function call(path, { method = 'GET', body, as } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as ? { Cookie: cookies[as] } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, data: await res.json().catch(() => null), setCookie };
}

async function login(pin, as) {
  const r = await call('/api/staff/login', { method: 'POST', body: { pin } });
  assert.equal(r.status, 200);
  cookies[as] = r.setCookie.split(';')[0];
}

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await call('/api/demo')).data.tables[0].url.split('/').pop();
  await login('1111', 'waiter');
  await login('2222', 'kitchen');
  await login('1234', 'admin');
});

after(async () => { server.close(); await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('public menu has 8 languages and items', async () => {
  const { status, data } = await call(`/api/public/table/${token}`);
  assert.equal(status, 200);
  assert.equal(data.languages.length, 8);
  assert.ok(data.items.length > 10);
  assert.ok(data.items[0].name.de);
});

test('invalid table is rejected', async () => {
  assert.equal((await call('/api/public/table/nope')).status, 404);
});

test('full order flow: pending → accepted → preparing → ready → served → closed', async () => {
  const o = await call(`/api/public/table/${token}/orders`, { method: 'POST', body: { items: [{ id: 1, qty: 2 }], lang: 'de' } });
  assert.equal(o.status, 201);
  assert.equal(o.data.status, 'pending');
  assert.equal(o.data.total, 1700); // price is taken from the server, not the client

  // Kitchen cannot approve orders
  assert.equal((await call(`/api/staff/orders/${o.data.id}/status`, { method: 'POST', body: { status: 'accepted' }, as: 'kitchen' })).status, 403);
  for (const [status, as] of [['accepted', 'waiter'], ['preparing', 'kitchen'], ['ready', 'kitchen'], ['served', 'waiter']]) {
    const r = await call(`/api/staff/orders/${o.data.id}/status`, { method: 'POST', body: { status }, as });
    assert.equal(r.status, 200, `${status} by ${as}`);
  }
  // Invalid transition
  assert.equal((await call(`/api/staff/orders/${o.data.id}/status`, { method: 'POST', body: { status: 'pending' }, as: 'waiter' })).status, 409);

  let state = (await call(`/api/public/table/${token}/state`)).data;
  assert.equal(state.bill.total, 1700);
  const tableId = o.data.tableId;
  assert.equal((await call(`/api/staff/tables/${tableId}/close`, { method: 'POST', as: 'waiter' })).status, 200);
  state = (await call(`/api/public/table/${token}/state`)).data;
  assert.equal(state.orders.length, 0);
});

test('waiter call is de-duplicated and bill request stores payment method', async () => {
  const a = await call(`/api/public/table/${token}/calls`, { method: 'POST', body: { type: 'waiter' } });
  const b = await call(`/api/public/table/${token}/calls`, { method: 'POST', body: { type: 'waiter' } });
  assert.equal(a.data.id, b.data.id);
  const bill = await call(`/api/public/table/${token}/calls`, { method: 'POST', body: { type: 'bill', paymentMethod: 'card' } });
  assert.equal(bill.data.paymentMethod, 'card');
});

test('sold-out items cannot be ordered', async () => {
  await call('/api/staff/items/2/available', { method: 'POST', body: { available: false }, as: 'waiter' });
  const r = await call(`/api/public/table/${token}/orders`, { method: 'POST', body: { items: [{ id: 2, qty: 1 }] } });
  assert.equal(r.status, 409);
  await call('/api/staff/items/2/available', { method: 'POST', body: { available: true }, as: 'waiter' });
});

test('admin endpoints require admin role', async () => {
  assert.equal((await call('/api/admin/settings')).status, 401);
  assert.equal((await call('/api/admin/settings', { as: 'waiter' })).status, 403);
  const r = await call('/api/admin/settings', { as: 'admin' });
  assert.equal(r.status, 200);
  assert.equal(r.data.secret, undefined);
});

test('admin can create an item with translations', async () => {
  const r = await call('/api/admin/items', { method: 'POST', as: 'admin', body: {
    name: { el: 'Λουκουμάδες', en: 'Loukoumades' }, description: {}, price: '5.5', categoryId: 5, allergens: ['gluten', 'bogus'], tags: ['vegetarian'],
  } });
  assert.equal(r.status, 201);
  assert.equal(r.data.price_cents, 550);
  assert.deepEqual(r.data.allergens, ['gluten']);
});

test('orders are stored and can be listed and exported as CSV', async () => {
  await call(`/api/public/table/${token}/orders`, { method: 'POST', body: { items: [{ id: 3, qty: 1 }], lang: 'fr' } });
  const h = await call('/api/admin/orders', { as: 'admin' });
  assert.equal(h.status, 200);
  assert.ok(h.data.orders.length >= 2);
  assert.equal(h.data.orders[0].lang, 'fr'); // newest first
  assert.ok(h.data.summary.revenue > 0);

  const res = await fetch(`${base}/api/admin/orders.csv`, { headers: { Cookie: cookies.admin } });
  assert.equal(res.status, 200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
  const csv = new TextDecoder().decode(bytes);
  assert.match(csv, /Τζατζίκι/);
  assert.match(csv, /4,50/);
});

test('stats are numeric on every database', async () => {
  const { data } = await call('/api/admin/stats?days=7', { as: 'admin' });
  assert.equal(typeof data.orders, 'number');
  assert.equal(typeof data.revenue, 'number');
  assert.equal(typeof data.top[0].qty, 'number');
});

test('dish options are validated and priced on the server', async () => {
  const other = (await call('/api/demo')).data.tables[1].url.split('/').pop(); // separate table: orders are rate-limited per table
  const url = `/api/public/table/${other}/orders`;
  // Lamb chops (id 10) require a cooking choice.
  assert.equal((await call(url, { method: 'POST', body: { items: [{ id: 10, qty: 1 }] } })).data.error, 'option_required');
  assert.equal((await call(url, { method: 'POST', body: { items: [{ id: 10, qty: 1, options: [[0, 0], [0, 1]] }] } })).data.error, 'bad_option');
  assert.equal((await call(url, { method: 'POST', body: { items: [{ id: 10, qty: 1, options: [[0, 7]] }] } })).data.error, 'bad_option');
  // Greek salad (id 1): 8.50 + extra feta 1.50 + capers 0.50, twice.
  const r = await call(url, { method: 'POST', body: { items: [{ id: 1, qty: 2, options: [[0, 0], [0, 1]] }] } });
  assert.equal(r.status, 201);
  assert.equal(r.data.items[0].price, 1050);
  assert.equal(r.data.total, 2100);
  assert.equal(r.data.items[0].options.length, 2);
  assert.equal(r.data.items[0].options[0].choice.en, 'Extra feta');
});

test('QR codes can be downloaded as PNG', async () => {
  const res = await fetch(`${base}/api/admin/tables/1/qr.png?ecl=H`, { headers: { Cookie: cookies.admin } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(1, 4)], [0x50, 0x4e, 0x47]); // "PNG"
});

test('closing a spot stores a numbered receipt that can be reprinted and shared with the guest', async () => {
  const spot = (await call('/api/demo')).data.tables[2].url.split('/').pop();
  const url = `/api/public/table/${spot}/orders`;
  await call(url, { method: 'POST', body: { items: [{ id: 3, qty: 1 }, { id: 17, qty: 1, options: [[0, 1]] }] } });
  await call(url, { method: 'POST', body: { items: [{ id: 3, qty: 2 }] } });
  const tableId = (await call(`/api/public/table/${spot}/state`)).data.orders[0].tableId;

  const closed = await call(`/api/staff/tables/${tableId}/close`, { method: 'POST', as: 'waiter', body: { paymentMethod: 'card', fiscalRef: 'ΜΑΡΚ 123' } });
  assert.equal(closed.status, 200);
  const r = closed.data.receipt;
  assert.match(r.number, /^\d{4}-\d{5}$/);
  assert.equal(r.payment, 'card');
  assert.equal(r.fiscalRef, 'ΜΑΡΚ 123');
  const tzatziki = r.lines.find((l) => l.name.el === 'Τζατζίκι');
  assert.equal(tzatziki.qty, 3); // same dish from two orders merged into one line
  assert.equal(r.total, 3 * 450 + 700);

  // Stored: staff can reprint it, the guest copy hides internal fields.
  assert.equal((await call(`/api/staff/receipts/${r.id}`, { as: 'waiter' })).data.receipt.number, r.number);
  assert.equal((await call(`/api/staff/receipts/${r.id}`, { as: 'kitchen' })).status, 403);
  const pub = await call(`/api/public/receipt/${r.token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.receipt.token, undefined);
  assert.equal(pub.data.receipt.orderIds, undefined);
  assert.equal((await call('/api/public/receipt/nope')).status, 404);

  // Fiscal reference can be completed later; appears in the admin list and CSV.
  await call(`/api/staff/receipts/${r.id}`, { method: 'PUT', as: 'waiter', body: { fiscalRef: 'ΑΠΥ 55' } });
  const list = await call('/api/admin/receipts', { as: 'admin' });
  assert.equal(list.data.receipts.find((x) => x.id === r.id).fiscalRef, 'ΑΠΥ 55');
  assert.ok(list.data.summary.byPayment.card >= r.total);
  const csv = await (await fetch(`${base}/api/admin/receipts.csv`, { headers: { Cookie: cookies.admin } })).text();
  assert.match(csv, new RegExp(r.number));

  // Closing an empty spot issues no receipt.
  assert.equal((await call(`/api/staff/tables/${tableId}/close`, { method: 'POST', as: 'waiter' })).data.receipt, null);
});

test('the menu look can be customised and is sanitised', async () => {
  const r = await call('/api/admin/settings', { method: 'PUT', as: 'admin', body: {
    theme: { background: '#F6EFE3', text: 'red', category: '#8a4b2a', font: 'elegant', corners: 'bogus' },
  } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.theme, { background: '#f6efe3', text: '', category: '#8a4b2a', font: 'elegant', corners: 'soft' });
  const pub = (await call(`/api/public/table/${token}`)).data;
  assert.equal(pub.restaurant.theme.background, '#f6efe3');
  assert.equal(pub.restaurant.theme.font, 'elegant');
});

test('menu rules: schedules, zones, happy hour, stock and all-inclusive', async () => {
  const { venueClock, inWindow } = await import('../server/menu-rules.js');
  // Windows past midnight belong to the evening before.
  assert.equal(inWindow({ days: [5], from: '22:00', to: '02:00' }, { day: 6, minutes: 60 }), true);
  assert.equal(inWindow({ days: [5], from: '22:00', to: '02:00' }, { day: 6, minutes: 23 * 60 }), false);

  const today = venueClock().day;
  const other = today === 7 ? 1 : today + 1;
  const spot = (await call('/api/admin/tables', { as: 'admin' })).data[5].token;
  const url = `/api/public/table/${spot}`;
  const menu = (await call('/api/admin/menu', { as: 'admin' })).data;
  const cat = menu.categories[0];
  const item = menu.items.find((i) => i.category_id === cat.id);
  const put = (c, extra) => call(`/api/admin/categories/${c.id}`, { method: 'PUT', as: 'admin', body: { name: c.name, active: true, station: c.station, ...extra } });

  // Category shown only on another day: hidden and not orderable today.
  await put(cat, { schedule: { days: [other] } });
  assert.ok(!(await call(url)).data.categories.some((c) => c.id === cat.id));
  assert.equal((await call(`${url}/orders`, { method: 'POST', body: { items: [{ id: item.id, qty: 1 }] } })).data.error, 'item_unavailable');
  await put(cat, { schedule: null });

  // Per-zone menu: only for the "Πισίνα" zone.
  const tables = (await call('/api/admin/tables', { as: 'admin' })).data;
  const t4 = tables.find((t) => t.token === spot);
  await put(cat, { zones: ['Πισίνα'] });
  assert.ok(!(await call(url)).data.categories.some((c) => c.id === cat.id));
  await call(`/api/admin/tables/${t4.id}`, { method: 'PUT', as: 'admin', body: { label: t4.label, kind: t4.kind, zone: 'Πισίνα' } });
  assert.ok((await call(url)).data.categories.some((c) => c.id === cat.id));
  await put(cat, { zones: [] });

  // Happy hour price, and stock that runs out.
  const body = { ...item, price: item.price_cents / 100, categoryId: item.category_id, happyPrice: '1.00', stock: 2 };
  await call(`/api/admin/items/${item.id}`, { method: 'PUT', as: 'admin', body });
  await call('/api/admin/settings', { method: 'PUT', as: 'admin', body: { happyHour: { enabled: true, days: [], from: '00:00', to: '23:59' } } });
  const pub = (await call(url)).data.items.find((i) => i.id === item.id);
  assert.equal(pub.happy, true);
  assert.equal(pub.price_cents, 100);
  assert.equal(pub.lowStock, 2);
  assert.equal((await call(`${url}/orders`, { method: 'POST', body: { items: [{ id: item.id, qty: 3 }] } })).data.error, 'item_unavailable');
  const o = await call(`${url}/orders`, { method: 'POST', body: { items: [{ id: item.id, qty: 2 }] } });
  assert.equal(o.data.total, 200);
  const after = (await call('/api/admin/menu', { as: 'admin' })).data.items.find((i) => i.id === item.id);
  assert.equal(after.stock, 0);
  assert.equal(after.available, false);
  await call('/api/admin/settings', { method: 'PUT', as: 'admin', body: { happyHour: { enabled: false } } });
  await call(`/api/admin/items/${item.id}`, { method: 'PUT', as: 'admin', body: { ...body, happyPrice: '', stock: '', available: true } });

  // All-inclusive spot: dishes free unless premium.
  await call(`/api/admin/tables/${t4.id}`, { method: 'PUT', as: 'admin', body: { label: t4.label, kind: t4.kind, allInclusive: true } });
  const ai = (await call(url)).data;
  assert.equal(ai.table.allInclusive, true);
  assert.ok(ai.items.every((i) => i.price_cents === 0 && i.included));
  await call(`/api/admin/tables/${t4.id}`, { method: 'PUT', as: 'admin', body: { label: t4.label, kind: t4.kind, allInclusive: false } });
});

test('stations, estimated time and named staff with zones', async () => {
  const tables = (await call('/api/admin/tables', { as: 'admin' })).data;
  const spot = tables[6];
  await call(`/api/admin/tables/${spot.id}`, { method: 'PUT', as: 'admin', body: { label: spot.label, kind: spot.kind, zone: 'Βεράντα' } });
  // Named waiter with a zone, alongside the shared role PINs.
  const r = await call('/api/admin/settings', { method: 'PUT', as: 'admin', body: {
    staff: [{ name: 'Γιάννης', role: 'waiter', pin: '4455', zones: ['Βεράντα', 'Άγνωστη'] }], pins: { admin: '', waiter: '', kitchen: '' } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.staff[0].zones, ['Βεράντα']);
  assert.equal((await call('/api/admin/settings', { method: 'PUT', as: 'admin', body: {
    staff: [{ name: 'Α', role: 'waiter', pin: '1111' }] } })).status, 400); // same as the waiter role PIN
  const login = await call('/api/staff/login', { method: 'POST', body: { pin: '4455' } });
  assert.equal(login.data.name, 'Γιάννης');
  cookies.giannis = login.setCookie.split(';')[0];
  const me = (await call('/api/staff/me', { as: 'giannis' })).data;
  assert.deepEqual(me.member, { name: 'Γιάννης', zones: ['Βεράντα'] });

  // Drinks go to the bar, food to the kitchen; each marks its own part ready.
  const menu = (await call('/api/admin/menu', { as: 'admin' })).data;
  const drinks = menu.categories.at(-1);
  await call(`/api/admin/categories/${drinks.id}`, { method: 'PUT', as: 'admin', body: { name: drinks.name, active: true, station: 'bar' } });
  const drink = menu.items.find((i) => i.category_id === drinks.id && !i.options.some((g) => g.required));
  const food = menu.items.find((i) => i.category_id !== drinks.id && !i.options.some((g) => g.required));
  const o = await call(`/api/public/table/${spot.token}/orders`, { method: 'POST', body: { items: [{ id: drink.id, qty: 1 }, { id: food.id, qty: 1 }] } });
  assert.deepEqual(o.data.items.map((i) => i.station).sort(), ['bar', 'kitchen']);
  await call(`/api/staff/orders/${o.data.id}/status`, { method: 'POST', as: 'giannis', body: { status: 'accepted' } });
  let order = (await call(`/api/staff/orders/${o.data.id}`, { as: 'kitchen' })).data.order;
  assert.ok(new Date(order.etaAt) > new Date()); // estimate starts when it reaches the kitchen
  order = (await call(`/api/staff/orders/${o.data.id}/station-ready`, { method: 'POST', as: 'kitchen', body: { station: 'bar' } })).data;
  assert.equal(order.status, 'preparing');
  order = (await call(`/api/staff/orders/${o.data.id}/station-ready`, { method: 'POST', as: 'kitchen', body: { station: 'kitchen' } })).data;
  assert.equal(order.status, 'ready');
  // Removing the member ends their session.
  await call('/api/admin/settings', { method: 'PUT', as: 'admin', body: { staff: [] } });
  assert.equal((await call('/api/staff/me', { as: 'giannis' })).status, 401);
});

test('guests pay from the phone: own dishes, equal shares, tip, room charge', async () => {
  const tables = (await call('/api/admin/tables', { as: 'admin' })).data;
  const spot = tables[7];
  const url = `/api/public/table/${spot.token}`;
  const pub = (await call(url)).data;
  assert.equal(pub.payments.provider, 'demo'); // demo venue, local testing
  const items = pub.items.filter((i) => i.available && !i.options.some((g) => g.required)).slice(0, 2);
  const o = await call(`${url}/orders`, { method: 'POST', body: { items: [{ id: items[0].id, qty: 2 }, { id: items[1].id, qty: 1 }], guestId: 'guest-aaaa-1111' } });
  const total = o.data.total;

  // One portion of the first dish, with 10% tip.
  const line = o.data.items[0];
  const mine = await call(`${url}/pay`, { method: 'POST', body: { mode: 'items', items: [[line.id, 1]], tipPercent: 10 } });
  assert.equal(mine.data.amount, line.price);
  assert.equal(mine.data.tip, Math.round(line.price * 0.1));
  let state = (await call(`${url}/state`)).data;
  assert.equal(state.bill.paid, line.price);
  assert.equal(state.orders[0].items[0].paidQty, 1);
  assert.equal((await call(`${url}/pay`, { method: 'POST', body: { mode: 'items', items: [[line.id, 2]] } })).status, 400); // only 1 left

  // Equal share for 2 people, then the rest.
  const share = await call(`${url}/pay`, { method: 'POST', body: { mode: 'share', people: 2 } });
  assert.equal(share.data.amount, Math.min(Math.ceil(total / 2), total - line.price));
  const rest = await call(`${url}/pay`, { method: 'POST', body: { mode: 'all' } });
  state = (await call(`${url}/state`)).data;
  assert.equal(state.bill.due, 0);
  assert.equal(line.price + share.data.amount + rest.data.amount, total);
  assert.equal((await call(`${url}/pay`, { method: 'POST', body: {} })).data.error, 'nothing_to_pay');

  // Closing the spot: receipt paid online, tips kept, guest remembered.
  const closed = (await call(`/api/staff/tables/${spot.id}/close`, { method: 'POST', as: 'waiter', body: {} })).data.receipt;
  assert.equal(closed.payment, 'online');
  assert.equal(closed.tip, mine.data.tip);
  assert.equal((await call(`${url}/state`)).data.bill.paid, 0);

  // Room charge only for rooms, when the venue allows it.
  const room = tables.find((t) => t.kind === 'room');
  const rurl = `/api/public/table/${room.token}`;
  await call(`${rurl}/orders`, { method: 'POST', body: { items: [{ id: items[1].id, qty: 1 }] } });
  assert.equal((await call(`${rurl}/pay`, { method: 'POST', body: { method: 'room' } })).status, 400);
  await call('/api/admin/settings', { method: 'PUT', as: 'admin', body: { payments: { provider: 'demo', roomCharge: true } } });
  assert.equal((await call(rurl)).data.payments.roomCharge, true);
  assert.equal((await call(`${url}`)).data.payments.roomCharge, false); // not for tables
  assert.equal((await call(`${rurl}/pay`, { method: 'POST', body: { method: 'room', tipPercent: 10 } })).data.tip, 0);
  const rr = (await call(`/api/staff/tables/${room.id}/close`, { method: 'POST', as: 'waiter', body: {} })).data.receipt;
  assert.equal(rr.payment, 'room');

  // The Viva secret is never sent back to the browser.
  await call('/api/admin/settings', { method: 'PUT', as: 'admin', body: { payments: { provider: 'viva', clientId: 'id', clientSecret: 'topsecret', sourceCode: '1234' } } });
  const settings = (await call('/api/admin/settings', { as: 'admin' })).data;
  assert.equal(settings.payments.hasSecret, true);
  assert.ok(!JSON.stringify(settings).includes('topsecret'));
  await call('/api/admin/settings', { method: 'PUT', as: 'admin', body: { payments: { provider: 'demo' } } });
  const back = await fetch(`${base}/pay/viva/return?s=999&t=x`, { redirect: 'manual' });
  assert.equal(back.status, 302);
});

test('public menu link and pick-up orders', async () => {
  const menu = await call('/api/public/menu/demo');
  assert.equal(menu.status, 200);
  assert.equal(menu.data.features.ordering, false); // pick-up is off by default
  assert.equal((await call('/api/public/menu/nope')).status, 404);
  await call('/api/admin/settings', { method: 'PUT', as: 'admin', body: { takeaway: { enabled: true, minMinutes: 15 } } });
  const on = (await call('/api/public/menu/demo')).data;
  assert.equal(on.features.ordering, true);
  const dish = on.items.find((i) => i.available && !i.options.some((g) => g.required));
  const post = (body) => call('/api/public/menu/demo/orders', { method: 'POST', body: { items: [{ id: dish.id, qty: 1 }], ...body } });
  assert.equal((await post({ name: 'Μ', phone: '69' })).data.error, 'bad_contact');
  assert.equal((await post({ name: 'Μαρία', phone: '6912345678', pickupAt: new Date(Date.now() + 60_000).toISOString() })).data.error, 'bad_pickup_time');
  const o = await post({ name: 'Μαρία', phone: '6912345678' });
  assert.equal(o.status, 201);
  const track = (await call(`/api/public/pickup/${o.data.code}`)).data;
  assert.equal(track.id, o.data.id);
  // Staff see it with the customer; the hidden pick-up spot is not a table.
  const overview = (await call('/api/staff/overview', { as: 'waiter' })).data;
  const staffOrder = overview.orders.find((x) => x.id === o.data.id);
  assert.equal(staffOrder.channel, 'takeaway');
  assert.equal(staffOrder.customer.phone, '6912345678');
  assert.ok(!overview.tables.some((t) => t.kind === 'takeaway'));
  assert.ok(!(await call('/api/admin/tables', { as: 'admin' })).data.some((t) => t.kind === 'takeaway'));
  // Handover: own receipt, order closed.
  const h = await call(`/api/staff/orders/${o.data.id}/handover`, { method: 'POST', as: 'waiter', body: { paymentMethod: 'card' } });
  assert.equal(h.data.receipt.total, o.data.total);
  assert.equal((await call(`/api/staff/orders/${o.data.id}/handover`, { method: 'POST', as: 'waiter', body: {} })).status, 409);
  await call('/api/admin/settings', { method: 'PUT', as: 'admin', body: { takeaway: { enabled: false } } });
});

test('loyalty card, feedback, dish views and Wi-Fi QR', async () => {
  const tables = (await call('/api/admin/tables', { as: 'admin' })).data;
  const spot = tables[8];
  const url = `/api/public/table/${spot.token}`;
  const guest = 'guest-loyal-0001';
  await call('/api/admin/settings', { method: 'PUT', as: 'admin', body: { loyalty: { enabled: true, visits: 2, reward: { el: 'Δωρεάν γλυκό', en: 'Free dessert' } } } });
  const dish = (await call(url)).data.items.find((i) => i.available && !i.options.some((g) => g.required));
  const visit = async () => {
    const o = await call(`${url}/orders`, { method: 'POST', body: { items: [{ id: dish.id, qty: 1 }], guestId: guest } });
    return o.data;
  };
  let receipt;
  for (let i = 0; i < 2; i++) {
    await visit();
    receipt = (await call(`/api/staff/tables/${spot.id}/close`, { method: 'POST', as: 'waiter', body: {} })).data.receipt;
  }
  const card = (await call(`${url}/loyalty?guest=${guest}`)).data.loyalty;
  assert.deepEqual([card.visits, card.needed, card.ready], [2, 2, true]);
  const third = await visit();
  const shown = (await call('/api/staff/overview', { as: 'waiter' })).data.orders.find((o) => o.id === third.id);
  assert.equal(shown.loyaltyReward.el, 'Δωρεάν γλυκό');
  assert.equal((await call(`/api/staff/orders/${third.id}/redeem`, { method: 'POST', as: 'waiter' })).status, 200);
  assert.equal((await call(`${url}/loyalty?guest=${guest}`)).data.loyalty.visits, 0); // new card
  assert.equal((await call(`/api/staff/orders/${third.id}/redeem`, { method: 'POST', as: 'waiter' })).status, 409);
  await call(`/api/staff/tables/${spot.id}/close`, { method: 'POST', as: 'waiter', body: {} });

  // Feedback once per bill; happy guests get the review link.
  await call('/api/admin/settings', { method: 'PUT', as: 'admin', body: { restaurant: { ...(await call('/api/admin/settings', { as: 'admin' })).data.restaurant, reviewUrl: 'https://g.page/r/x' } } });
  const fb = await call(`/api/public/receipt/${receipt.token}/feedback`, { method: 'POST', body: { rating: 5, comment: 'Τέλεια!' } });
  assert.equal(fb.data.reviewUrl, 'https://g.page/r/x');
  assert.equal((await call(`/api/public/receipt/${receipt.token}/feedback`, { method: 'POST', body: { rating: 1 } })).status, 409);
  const list = (await call('/api/admin/feedback', { as: 'admin' })).data;
  assert.equal(list.list[0].comment, 'Τέλεια!');

  // Dish views vs orders.
  await call(`${url}/view`, { method: 'POST', body: { itemId: dish.id } });
  const stats = (await call('/api/admin/dish-stats', { as: 'admin' })).data.items.find((i) => i.id === dish.id);
  assert.equal(stats.views, 1);
  assert.ok(stats.ordered >= 3);

  const wifi = await fetch(`${base}${url}/wifi.svg`);
  assert.equal(wifi.status, 200);
  assert.match(await wifi.text(), /<svg/);
});
