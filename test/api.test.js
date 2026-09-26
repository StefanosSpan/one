import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'taverna-test-'));
process.env.DATA_DIR = dir;
const { app } = await import('../server/index.js');

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

after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

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
