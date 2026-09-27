// Viva Connect (ISV partner): an owner connects with one button, guests pay the venue's merchant account and
// Kalimenu's fee is sent to Viva. A local mock stands in for Viva.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- Mock Viva ---------------------------------------------------------------
const seen = { orders: [], accounts: [] };
const accounts = new Map();
const orders = new Map();
const viva = createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  const url = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/connect/token') {
    const [id, secret] = Buffer.from(req.headers.authorization.split(' ')[1], 'base64').toString().split(':');
    return id === 'isv-id' && secret === 'isv-secret' ? send(200, { access_token: 'tok', expires_in: 3600 }) : send(401, {});
  }
  if (req.headers.authorization !== 'Bearer tok') return send(401, {});
  if (url.pathname === '/isv/v1/accounts' && req.method === 'POST') {
    const body = JSON.parse(raw);
    seen.accounts.push(body);
    const accountId = `acc-${accounts.size + 1}`;
    accounts.set(accountId, { accountId, email: body.email, verified: false, merchantId: null });
    return send(200, { accountId, redirectUrl: `https://viva.example/onboard/${accountId}` });
  }
  const acc = url.pathname.match(/^\/isv\/v1\/accounts\/(.+)$/);
  if (acc) return accounts.has(acc[1]) ? send(200, accounts.get(acc[1])) : send(404, {});
  if (url.pathname === '/checkout/v2/isv/orders' && req.method === 'POST') {
    const body = JSON.parse(raw);
    const orderCode = 1000 + orders.size;
    seen.orders.push({ ...body, merchantId: url.searchParams.get('merchantId') });
    orders.set(String(orderCode), { amount: body.amount, merchantId: url.searchParams.get('merchantId') });
    return send(200, { orderCode });
  }
  const tr = url.pathname.match(/^\/checkout\/v2\/isv\/transactions\/tx-(\d+)$/);
  if (tr) {
    const o = orders.get(tr[1]);
    if (!o || o.merchantId !== url.searchParams.get('merchantId')) return send(404, {});
    return send(200, { statusId: 'F', amount: o.amount / 100, orderCode: Number(tr[1]) });
  }
  send(404, {});
});
await new Promise((r) => viva.listen(0, '127.0.0.1', r));

const dir = mkdtempSync(join(tmpdir(), 'kalimenu-viva-'));
Object.assign(process.env, {
  DATA_DIR: dir, VIVA_TEST_HOST: `http://127.0.0.1:${viva.address().port}`,
  VIVA_ISV_CLIENT_ID: 'isv-id', VIVA_ISV_CLIENT_SECRET: 'isv-secret', VIVA_ISV_SOURCE_CODE: '1234', VIVA_ISV_ENV: 'demo',
  VIVA_ISV_FEE_PERCENT: '1', VIVA_ISV_FEE_CENTS: '5',
});
if (process.env.DATABASE_URL) {
  const { openDatabase, dropAll } = await import('../server/db/adapter.js');
  const tmp = await openDatabase();
  await dropAll(tmp);
  await tmp.close();
}
const { app } = await import('../server/index.js');
const { db } = await import('../server/db.js');

let server, base;
function browser() {
  const jar = {};
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); jar[k] = v.join('='); }
    return { status: res.status, location: res.headers.get('location'), data: await res.json().catch(() => null) };
  };
}
const owner = browser();
const guest = browser();

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await owner('/api/account/signup', { method: 'POST', body: {
    business: 'Beach Bar Viva', email: 'viva-owner@example.com', password: 'secret-pass-1', acceptTerms: true, plan: 'pro', tables: 4,
  } });
  assert.equal(r.status, 201);
});
after(async () => { server.close(); viva.close(); await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('owner connects with Viva, guest pays the venue merchant and the Kalimenu fee is sent', async () => {
  let s = (await owner('/api/admin/settings')).data;
  assert.equal(s.vivaConnect.available, true);
  assert.equal(s.vivaConnect.feePercent, 1);

  // Start onboarding: Viva gives an onboarding page for the owner.
  const start = await owner('/api/admin/payments/viva-connect', { method: 'POST', body: { email: 'Viva-Owner@Example.com' } });
  assert.equal(start.status, 200);
  assert.equal(start.data.redirectUrl, 'https://viva.example/onboard/acc-1');
  assert.equal(seen.accounts[0].email, 'viva-owner@example.com');
  assert.match(seen.accounts[0].returnUrl, /\/staff\/admin\?tab=settings&viva=return$/);

  // Not finished yet: no payments for guests.
  let refresh = await owner('/api/admin/payments/viva-connect/refresh', { method: 'POST' });
  assert.equal(refresh.data.isv.merchantId, '');
  const token = (await owner('/api/admin/tables')).data[0].token;
  assert.equal((await guest(`/api/public/table/${token}`)).data.payments.provider, 'off');

  // Viva verifies the business: the venue switches to Viva payments by itself.
  Object.assign(accounts.get('acc-1'), { verified: true, merchantId: 'm-111' });
  refresh = await owner('/api/admin/payments/viva-connect/refresh', { method: 'POST' });
  assert.equal(refresh.data.isv.merchantId, 'm-111');
  s = (await owner('/api/admin/settings')).data;
  assert.equal(s.payments.provider, 'viva-connect');
  assert.equal((await guest(`/api/public/table/${token}`)).data.payments.provider, 'viva');

  // Saving other settings keeps the connection.
  await owner('/api/admin/settings', { method: 'PUT', body: { payments: { provider: 'viva-connect', tips: [0, 10] } } });
  assert.equal((await owner('/api/admin/settings')).data.payments.isv.merchantId, 'm-111');

  // A guest orders and pays 20 € + 10% tip.
  const menu = (await guest(`/api/public/table/${token}`)).data;
  const dish = menu.items.find((i) => i.available && !i.options.some((o) => o.required));
  const qty = 2;
  const order = await guest(`/api/public/table/${token}/orders`, { method: 'POST', body: { items: [{ id: dish.id, qty }] } });
  assert.equal(order.status, 201, JSON.stringify(order.data));
  await owner(`/api/staff/orders/${order.data.id}/status`, { method: 'POST', body: { status: 'accepted' } });
  const total = (await guest(`/api/public/table/${token}/state`)).data.bill.due;
  const pay = await guest(`/api/public/table/${token}/pay`, { method: 'POST', body: { mode: 'all', tipPercent: 10 } });
  assert.equal(pay.status, 200);
  assert.match(pay.data.url, /\/web\/checkout\?ref=1000$/);
  const sent = seen.orders[0];
  assert.equal(sent.merchantId, 'm-111');
  assert.equal(sent.sourceCode, '1234');
  assert.equal(sent.amount, total + Math.round(total / 10));
  assert.equal(sent.isvAmount, Math.round(total / 100) + 5, 'fee: 1% of the bill (not the tip) + 5 cents');

  // Viva sends the guest back; the transaction is checked against the venue's merchant id.
  const back = await guest('/pay/viva/return?t=tx-1000&s=1000');
  assert.match(back.location, /\?pay=ok$/);
  const state = (await guest(`/api/public/table/${token}/state`)).data;
  assert.equal(state.bill.due, 0);
  const row = await db.get('SELECT status, fee_cents FROM payments WHERE ref = ?', ['1000']);
  assert.equal(row.status, 'paid');
  assert.equal(Number(row.fee_cents), Math.round(total / 100) + 5);

  // Disconnect: payments from the phone stop.
  await owner('/api/admin/payments/viva-connect', { method: 'DELETE' });
  assert.equal((await guest(`/api/public/table/${token}`)).data.payments.provider, 'off');
});

test('a demo merchant id can be entered in the demo environment only', async () => {
  const bad = await owner('/api/admin/payments/viva-connect', { method: 'POST', body: { merchantId: 'x' } });
  assert.equal(bad.status, 400);
  const ok = await owner('/api/admin/payments/viva-connect', { method: 'POST', body: { merchantId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' } });
  assert.equal(ok.status, 200);
  assert.equal((await owner('/api/admin/settings')).data.payments.provider, 'viva-connect');
});
