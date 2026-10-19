// Notifications on the waiters' phones (Web Push): subscribing, what is sent and when, the encryption and the
// signature the browsers' push services check, and phones that unsubscribed. A local server plays the push service.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kalimenu-push-'));
process.env.DATA_DIR = dir;
if (process.env.DATABASE_URL) {
  const { openDatabase, dropAll } = await import('../server/db/adapter.js');
  const tmp = await openDatabase();
  await dropAll(tmp);
  await tmp.close();
}
const { app } = await import('../server/index.js');
const { db } = await import('../server/db.js');
const { pushEndpointAllowed, encryptFor } = await import('../server/push.js');

let server, base, pushService, pushBase, tokens;
const cookies = {};
const received = [];
let waiting = [];

async function call(path, { method = 'GET', body, as } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(as ? { Cookie: cookies[as] } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null), setCookie: res.headers.get('set-cookie') };
}
const nextPush = () => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('no notification arrived')), 3000);
  waiting.push((p) => { clearTimeout(timer); resolve(p); });
});
const settle = () => new Promise((r) => setTimeout(r, 300));

// The phone's side: its key pair and secret, and how it reads a message (RFC 8291).
const phone = createECDH('prime256v1');
phone.generateKeys();
const auth = randomBytes(16);
const keys = { p256dh: phone.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
function decrypt(body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const serverKey = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const ikm = Buffer.from(hkdfSync('sha256', phone.computeSecret(serverKey), auth, Buffer.concat([Buffer.from('WebPush: info\0'), phone.getPublicKey(), serverKey]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'the last record ends with the delimiter 2');
  return JSON.parse(plain.subarray(0, -1).toString());
}

before(async () => {
  pushService = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      // "/gone": a phone that unsubscribed; the push services answer 410.
      res.writeHead(req.url.startsWith('/gone') ? 410 : 201).end();
      const p = { url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
      received.push(p);
      if (!req.url.startsWith('/gone')) { const w = waiting; waiting = []; w.forEach((f) => f(p)); }
    });
  }).listen(0, '127.0.0.1');
  server = app.listen(0);
  await Promise.all([new Promise((r) => server.once('listening', r)), new Promise((r) => pushService.once('listening', r))]);
  base = `http://127.0.0.1:${server.address().port}`;
  pushBase = `http://127.0.0.1:${pushService.address().port}`;
  tokens = (await call('/api/demo')).data.tables.map((t) => t.url.split('/').pop());
  for (const [pin, as] of [['1111', 'waiter'], ['2222', 'kitchen']]) {
    const r = await call('/api/staff/login', { method: 'POST', body: { pin } });
    cookies[as] = r.setCookie.split(';')[0];
  }
});
after(async () => { server.close(); pushService.close(); await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('the encryption gives exactly the example of RFC 8291', () => {
  const body = encryptFor({ p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    'When I grow up, I want to be a watermelon', { privateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
  assert.equal(body.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('only the browsers\' push services are accepted as addresses', () => {
  assert.ok(pushEndpointAllowed('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(pushEndpointAllowed('https://web.push.apple.com/QAbc'));
  assert.ok(pushEndpointAllowed('https://updates.push.services.mozilla.com/wpush/v2/abc'));
  assert.ok(pushEndpointAllowed('https://wns2-par02p.notify.windows.com/w/?token=abc'));
  assert.ok(pushEndpointAllowed('https://jmt17.google.com/fcm/send/abc'));
  for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://evil.com/fcm.googleapis.com', 'https://fcm.googleapis.com:8443/x',
    'http://127.0.0.1:9/x', 'https://169.254.169.254/latest', 'https://jmt17.google.com.evil.com/x', 'https://accounts.google.com/x', 'not a url']) assert.ok(!pushEndpointAllowed(bad), bad);
  assert.ok(pushEndpointAllowed('http://127.0.0.1:9/x', { allowLocal: true }));
});

test('a waiter\'s phone subscribes; bad subscriptions and other roles are refused', async () => {
  const key = (await call('/api/staff/push', { as: 'waiter' })).data.publicKey;
  assert.equal(Buffer.from(key, 'base64url').length, 65);
  assert.equal((await call('/api/staff/push', { method: 'POST', as: 'waiter', body: { endpoint: 'https://evil.example.com/x', keys } })).status, 400);
  assert.equal((await call('/api/staff/push', { method: 'POST', as: 'waiter', body: { endpoint: `${pushBase}/p/1`, keys: { ...keys, auth: 'short' } } })).status, 400);
  assert.equal((await call('/api/staff/push', { method: 'POST', as: 'kitchen', body: { endpoint: `${pushBase}/p/1`, keys } })).status, 403);
  assert.equal((await call('/api/staff/push', { method: 'POST', body: { endpoint: `${pushBase}/p/1`, keys } })).status, 401);
  assert.equal((await call('/api/staff/push', { method: 'POST', as: 'waiter', body: { endpoint: `${pushBase}/p/1`, keys } })).status, 201);
  // Renewing does not duplicate it.
  assert.equal((await call('/api/staff/push', { method: 'POST', as: 'waiter', body: { endpoint: `${pushBase}/p/1`, keys } })).status, 201);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM push_subscriptions')).n, 1);
});

test('a guest\'s call reaches the phone encrypted and signed; the same call is not sent twice', async () => {
  const arriving = nextPush();
  assert.equal((await call(`/api/public/table/${tokens[0]}/calls`, { method: 'POST', body: { type: 'waiter' } })).status, 201);
  const p = await arriving;
  assert.equal(p.url, '/p/1');
  assert.equal(p.headers['content-encoding'], 'aes128gcm');
  assert.ok(Number(p.headers.ttl) > 0);
  const m = decrypt(p.body);
  assert.match(m.title, /^Κλήση · Τραπέζι /);
  assert.equal(m.body, 'Ο πελάτης ζητά σερβιτόρο');
  assert.equal(m.url, '/staff/waiter');
  // The VAPID signature checks out with the service's public key, for the push service's own address.
  const [, jwt, k] = p.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, (await call('/api/staff/push', { as: 'waiter' })).data.publicKey);
  const [h, c, s] = jwt.split('.');
  const raw = Buffer.from(k, 'base64url');
  const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, pushBase);
  assert.ok(claims.exp > Date.now() / 1000);
  // Pressing again sends nothing new; asking for the bill with a card does.
  const count = received.length;
  await call(`/api/public/table/${tokens[0]}/calls`, { method: 'POST', body: { type: 'waiter' } });
  await settle();
  assert.equal(received.length, count);
  const bill = nextPush();
  await call(`/api/public/table/${tokens[0]}/calls`, { method: 'POST', body: { type: 'bill', paymentMethod: 'card' } });
  const b = decrypt((await bill).body);
  assert.match(b.title, /^Λογαριασμός · /);
  assert.equal(b.body, 'Θα πληρώσει με κάρτα');
});

test('an order waiting for approval and an order ready to serve are notified', async () => {
  const menu = (await call(`/api/public/table/${tokens[1]}`)).data;
  const dish = menu.items.find((i) => i.available && !(i.options || []).some((g) => g.required));
  const arriving = nextPush();
  const o = await call(`/api/public/table/${tokens[1]}/orders`, { method: 'POST', body: { items: [{ id: dish.id, qty: 2 }] } });
  assert.equal(o.data.status, 'pending');
  const m = decrypt((await arriving).body);
  assert.match(m.title, /^Νέα παραγγελία · Τραπέζι /);
  assert.match(m.body, new RegExp(`^2× ${dish.name.el}.*περιμένει έγκριση$`));
  assert.equal(m.tag, `order-${o.data.id}`);
  await call(`/api/staff/orders/${o.data.id}/status`, { method: 'POST', as: 'waiter', body: { status: 'accepted' } });
  const ready = nextPush();
  await call(`/api/staff/orders/${o.data.id}/status`, { method: 'POST', as: 'kitchen', body: { status: 'ready' } });
  assert.match(decrypt((await ready).body).title, /^Έτοιμη για σερβίρισμα · Τραπέζι /);
});

test('phones that unsubscribed are forgotten, and a waiter can turn notifications off', async () => {
  await call('/api/staff/push', { method: 'POST', as: 'waiter', body: { endpoint: `${pushBase}/gone/1`, keys } });
  const arriving = nextPush();
  await call(`/api/public/table/${tokens[2]}/calls`, { method: 'POST', body: { type: 'waiter' } });
  await arriving;
  await settle();
  assert.ok(received.some((p) => p.url === '/gone/1'));
  assert.equal(await db.get('SELECT id FROM push_subscriptions WHERE endpoint = ?', [`${pushBase}/gone/1`]), undefined);
  assert.equal((await call('/api/staff/push/off', { method: 'POST', as: 'waiter', body: { endpoint: `${pushBase}/p/1` } })).status, 200);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM push_subscriptions')).n, 0);
  const count = received.length;
  await call(`/api/public/table/${tokens[1]}/calls`, { method: 'POST', body: { type: 'waiter' } });
  await settle();
  assert.equal(received.length, count, 'nothing is sent without subscriptions');
});
