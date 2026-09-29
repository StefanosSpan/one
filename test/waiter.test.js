// The waiter at the table: taking an order, correcting it (kept on the order for the owner), moving the party to
// another spot, and orders nobody approved staying off the bill.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kalimenu-waiter-'));
process.env.DATA_DIR = dir;
if (process.env.DATABASE_URL) {
  const { openDatabase, dropAll } = await import('../server/db/adapter.js');
  const tmp = await openDatabase();
  await dropAll(tmp);
  await tmp.close();
}
const { app } = await import('../server/index.js');
const { db } = await import('../server/db.js');

let server, base;
const cookies = {};
async function call(path, { method = 'GET', body, as } = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(as ? { Cookie: cookies[as] } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null), setCookie: res.headers.get('set-cookie') };
}
let tables;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [pin, as] of [['1111', 'waiter'], ['2222', 'kitchen'], ['1234', 'admin']]) {
    cookies[as] = (await call('/api/staff/login', { method: 'POST', body: { pin } })).setCookie.split(';')[0];
  }
  tables = (await call('/api/admin/tables', { as: 'admin' })).data;
});
after(async () => { server.close(); await db.close(); rmSync(dir, { recursive: true, force: true }); });

const state = (t) => call(`/api/public/table/${t.token}/state`).then((r) => r.data);

test('the waiter takes an order at the table: it skips approval and goes on the bill', async () => {
  const t = tables[0];
  assert.equal((await call(`/api/staff/tables/${t.id}/menu`, { as: 'kitchen' })).status, 403);
  const menu = (await call(`/api/staff/tables/${t.id}/menu`, { as: 'waiter' })).data;
  assert.ok(menu.categories.length && menu.items.length);
  const withChoice = menu.items.find((i) => i.options.some((g) => g.required));
  const plain = menu.items.find((i) => !i.options.length);
  const send = (items) => call(`/api/staff/tables/${t.id}/orders`, { method: 'POST', as: 'waiter', body: { items, note: 'Γρήγορα' } });
  // A required choice cannot be left out.
  assert.equal((await send([{ id: withChoice.id, qty: 1 }])).data.error, 'option_required');
  const g = withChoice.options.findIndex((x) => x.required);
  const r = await send([{ id: plain.id, qty: 2, note: 'χωρίς αλάτι' }, { id: withChoice.id, qty: 1, options: [[g, 0]] }]);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.status, 'accepted'); // the demo venue asks for approval, but not for the waiter's own orders
  assert.equal(r.data.takenBy, 'Σερβιτόρος');
  assert.equal(r.data.items[0].note, 'χωρίς αλάτι');
  assert.equal((await state(t)).bill.total, r.data.total);
  // The kitchen sees it right away.
  assert.ok((await call('/api/staff/overview', { as: 'kitchen' })).data.orders.some((o) => o.id === r.data.id && o.status === 'accepted'));
});

test('orders nobody approved are not on the bill and are cancelled when the spot closes', async () => {
  const t = tables[1];
  const dish = (await call(`/api/public/table/${t.token}`)).data.items.find((i) => i.available && !i.options.length);
  const o = (await call(`/api/public/table/${t.token}/orders`, { method: 'POST', body: { items: [{ id: dish.id, qty: 1 }] } })).data;
  assert.equal(o.status, 'pending');
  assert.equal((await state(t)).bill.total, 0);
  assert.equal((await call(`/api/public/table/${t.token}/pay`, { method: 'POST', body: { mode: 'all' } })).data.error, 'nothing_to_pay');
  const card = (await call('/api/staff/overview', { as: 'waiter' })).data.tables.find((x) => x.id === t.id);
  assert.deepEqual([card.orders, card.total], [1, 0]);
  const closed = await call(`/api/staff/tables/${t.id}/close`, { method: 'POST', as: 'waiter', body: {} });
  assert.equal(closed.data.receipt, null);
  assert.equal((await db.get('SELECT status FROM orders WHERE id = ?', [o.id])).status, 'rejected');
});

test('corrections: fewer portions or a dish removed, recorded with who did it; paid portions stay', async () => {
  const t = tables[2];
  const menu = (await call(`/api/staff/tables/${t.id}/menu`, { as: 'waiter' })).data;
  const [a, b] = menu.items.filter((i) => !i.options.length);
  const o = (await call(`/api/staff/tables/${t.id}/orders`, { method: 'POST', as: 'waiter', body: { items: [{ id: a.id, qty: 3 }, { id: b.id, qty: 1 }] } })).data;
  const [la, lb] = o.items;
  const fix = (line, qty, as = 'waiter', reason = '') => call(`/api/staff/orders/${o.id}/void`, { method: 'POST', as, body: { line, qty, reason } });
  assert.equal((await fix(la.id, 1, 'kitchen')).status, 403);
  let r = await fix(la.id, 1, 'waiter', 'λάθος καταχώριση');
  assert.equal(r.status, 200);
  assert.equal(r.data.items.find((i) => i.id === la.id).qty, 2);
  assert.equal(r.data.total, 2 * la.price + lb.price);
  assert.deepEqual([r.data.voids[0].qty, r.data.voids[0].by, r.data.voids[0].reason], [1, 'Σερβιτόρος', 'λάθος καταχώριση']);
  assert.equal((await fix(la.id, 5)).status, 409);

  // One portion paid from the phone cannot be removed.
  const paid = await call(`/api/public/table/${t.token}/pay`, { method: 'POST', body: { mode: 'items', items: [[la.id, 1]] } });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.equal((await fix(la.id, 2)).status, 409);
  assert.equal((await fix(la.id, 1)).status, 200);

  // The owner sees the corrections in the order history and the export.
  const hist = (await call('/api/admin/orders', { as: 'admin' })).data.orders.find((x) => x.id === o.id);
  assert.equal(hist.voids.length, 2);
  assert.equal(hist.takenBy, 'Σερβιτόρος');
  const csv = await (await fetch(`${base}/api/admin/orders.csv`, { headers: { Cookie: cookies.admin } })).text();
  assert.match(csv, /Διορθώσεις/);
  assert.match(csv, /λάθος καταχώριση/);

  // Removing the other dish leaves only the paid portion on the order.
  r = await fix(lb.id, 1);
  assert.equal(r.data.status, 'accepted');
  assert.equal(r.data.total, la.price);

  // An order with nothing left on it is cancelled.
  const one = (await call(`/api/staff/tables/${t.id}/orders`, { method: 'POST', as: 'waiter', body: { items: [{ id: b.id, qty: 1 }] } })).data;
  const gone = await call(`/api/staff/orders/${one.id}/void`, { method: 'POST', as: 'waiter', body: { line: one.items[0].id, qty: 1 } });
  assert.deepEqual([gone.data.status, gone.data.total, gone.data.items.length], ['rejected', 0, 0]);
});

test('cancelled portions of dishes with stock go back to stock', async () => {
  const t = tables[3];
  const dish = (await call(`/api/public/table/${t.token}`)).data.items.find((i) => i.available && !i.options.length);
  await db.run('UPDATE items SET stock = 2 WHERE id = ?', [dish.id]);
  const o = (await call(`/api/public/table/${t.token}/orders`, { method: 'POST', body: { items: [{ id: dish.id, qty: 2 }] } })).data;
  let row = await db.get('SELECT stock, available FROM items WHERE id = ?', [dish.id]);
  assert.deepEqual([Number(row.stock), Number(row.available)], [0, 0]); // sold out
  await call(`/api/staff/orders/${o.id}/status`, { method: 'POST', as: 'waiter', body: { status: 'rejected' } });
  row = await db.get('SELECT stock, available FROM items WHERE id = ?', [dish.id]);
  assert.deepEqual([Number(row.stock), Number(row.available)], [2, 1]);
  await db.run('UPDATE items SET stock = NULL WHERE id = ?', [dish.id]);
});

test('the party moves to another spot with its orders and phone payments', async () => {
  const [from, to] = [tables[4], tables[5]];
  const menu = (await call(`/api/staff/tables/${from.id}/menu`, { as: 'waiter' })).data;
  const dish = menu.items.find((i) => !i.options.length);
  const o = (await call(`/api/staff/tables/${from.id}/orders`, { method: 'POST', as: 'waiter', body: { items: [{ id: dish.id, qty: 2 }] } })).data;
  await call(`/api/public/table/${from.token}/pay`, { method: 'POST', body: { mode: 'items', items: [[o.items[0].id, 1]] } });
  assert.equal((await call(`/api/staff/tables/${from.id}/move`, { method: 'POST', as: 'waiter', body: { to: from.id } })).status, 400);
  const r = await call(`/api/staff/tables/${from.id}/move`, { method: 'POST', as: 'waiter', body: { to: to.id } });
  assert.equal(r.status, 200);
  assert.equal((await state(from)).orders.length, 0);
  const moved = await state(to);
  assert.deepEqual([moved.orders[0].id, moved.bill.total, moved.bill.paid], [o.id, o.total, dish.price]);
  // Nothing left to move.
  assert.equal((await call(`/api/staff/tables/${from.id}/move`, { method: 'POST', as: 'waiter', body: { to: to.id } })).status, 409);
});
