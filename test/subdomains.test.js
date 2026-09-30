// Every venue on its own address (<code>.kalimenu.test): logins stay on their venue's address, the main address
// hands them over with a one-time link, and one venue's address never serves another venue's data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kalimenu-sub-'));
Object.assign(process.env, { DATA_DIR: dir, BASE_DOMAIN: 'kalimenu.test',
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

// A browser that keeps cookies per address, like a real one (cookies without Domain are host-only).
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
        resolve({ status: res.statusCode, location: res.headers.location, data: json });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
  call.jar = (host) => jars[host] || {};
  // Follows a link on an address of the service: its host decides which cookies go with it.
  call.open = (url) => { const u = new URL(url); return call(u.host, u.pathname + u.search); };
  return call;
}

const MAIN = 'kalimenu.test';
const ownerA = browser();
const ownerB = browser();
let a, b; // venue codes

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;
  const signup = async (who, business, email) => {
    const r = await who(MAIN, '/api/account/signup', { method: 'POST', body: {
      business, email, password: 'secret-pass-1', acceptTerms: true, plan: 'pro', tables: 3 } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r;
  };
  const ra = await signup(ownerA, 'Ταβέρνα Άλφα', 'alfa@example.com');
  const rb = await signup(ownerB, 'Beach Bar Βήτα', 'vita@example.com');
  a = ra.data.venue.slug; b = rb.data.venue.slug;
  // Sign-up on the main address: no login there, a one-time link to the venue's own address instead.
  assert.equal(Object.keys(ownerA.jar(MAIN)).length, 0);
  assert.match(ra.data.next, new RegExp(`^http://${a}\\.kalimenu\\.test/auth/handoff\\?t=`));
  const landed = await ownerA.open(ra.data.next);
  assert.equal(landed.location, '/staff/admin?welcome=1');
  assert.equal((await ownerB.open(rb.data.next)).location, '/staff/admin?welcome=1');
});
after(async () => { server.close(); await db.close(); rmSync(dir, { recursive: true, force: true }); });

test('a login counts only on its own venue address', async () => {
  const me = await ownerA(`${a}.kalimenu.test`, '/api/staff/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.venue.slug, a);
  // The same cookie taken to another venue's address, or to the main address, is not a login there.
  const stolen = browser();
  stolen.jar(`${b}.kalimenu.test`);
  const cookie = ownerA.jar(`${a}.kalimenu.test`).staff;
  const send = (host, path) => new Promise((resolve) => {
    request({ host: '127.0.0.1', port, path, headers: { Host: host, Cookie: `staff=${cookie}` } }, (res) => { res.resume(); resolve(res.statusCode); }).end();
  });
  assert.equal(await send(`${b}.kalimenu.test`, '/api/staff/me'), 401);
  assert.equal(await send(`${b}.kalimenu.test`, '/api/admin/settings'), 401);
  assert.equal(await send(MAIN, '/api/staff/me'), 401);
  assert.equal((await ownerB(`${b}.kalimenu.test`, '/api/staff/me')).data.venue.slug, b);
});

test('a one-time link works once, only on its own address and only for a minute', async () => {
  const r = await ownerA(MAIN, '/api/account/login', { method: 'POST', body: { email: 'alfa@example.com', password: 'secret-pass-1' } });
  assert.equal(r.status, 200);
  const u = new URL(r.data.next);
  assert.equal(u.host, `${a}.kalimenu.test`);
  const fresh = browser();
  // On another venue's address the link is refused.
  const elsewhere = await fresh(`${b}.kalimenu.test`, u.pathname + u.search);
  assert.equal(elsewhere.location, '/staff');
  assert.equal(fresh.jar(`${b}.kalimenu.test`).staff, undefined);
  assert.equal((await fresh.open(r.data.next)).location, '/staff/admin');
  assert.ok(fresh.jar(`${a}.kalimenu.test`).staff);
  // Used once: a second browser with the same link gets nothing.
  const replay = browser();
  assert.equal((await replay.open(r.data.next)).location, '/staff');
  assert.equal(replay.jar(`${a}.kalimenu.test`).staff, undefined);
  // A forged link is refused.
  const forged = browser();
  assert.equal((await forged(`${a}.kalimenu.test`, `/auth/handoff?t=${u.searchParams.get('t').slice(0, -3)}abc`)).location, '/staff');
});

test('owner login on a venue address stays there; on someone else\'s address it goes to the owner\'s own venue', async () => {
  const own = await ownerA(`${a}.kalimenu.test`, '/api/account/login', { method: 'POST', body: { email: 'alfa@example.com', password: 'secret-pass-1' } });
  assert.equal(own.data.next, '/staff/admin');
  const wrong = browser();
  const r = await wrong(`${b}.kalimenu.test`, '/api/account/login', { method: 'POST', body: { email: 'alfa@example.com', password: 'secret-pass-1' } });
  assert.equal(new URL(r.data.next).host, `${a}.kalimenu.test`);
  assert.equal(wrong.jar(`${b}.kalimenu.test`).staff, undefined);
});

test('staff PINs work only on their own venue address', async () => {
  const guest = browser();
  // The demo venue's PIN on venue A's address: A is used whatever code is sent, so the demo PIN does not open it.
  const r = await guest(`${a}.kalimenu.test`, '/api/staff/login', { method: 'POST', body: { pin: DEMO_PINS.admin, venue: 'demo' } });
  assert.equal(r.status, 403, 'this device is not approved by the owner of A');
  // The owner of A approves the device on A's address only; the owner of another venue cannot.
  const approve = (host, email) => guest(host, '/api/staff/approve-device', { method: 'POST', body: { email, password: 'secret-pass-1' } });
  assert.equal((await approve(`${a}.kalimenu.test`, 'vita@example.com')).status, 401);
  assert.equal((await approve(`${a}.kalimenu.test`, 'alfa@example.com')).status, 200);
  assert.equal((await guest(`${a}.kalimenu.test`, '/api/staff/login', { method: 'POST', body: { pin: DEMO_PINS.admin, venue: 'demo' } })).status, 401);
  // The approval of A does not open B.
  assert.equal((await guest(`${b}.kalimenu.test`, '/api/staff/login', { method: 'POST', body: { pin: '0000' } })).status, 403);
  const ok = await guest('demo.kalimenu.test', '/api/staff/login', { method: 'POST', body: { pin: DEMO_PINS.waiter, venue: a } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.venue, 'demo');
  assert.equal(ok.data.next, '/staff/waiter');
  // From the main address the PIN login moves to the venue's address.
  const main = await browser()(MAIN, '/api/staff/login', { method: 'POST', body: { pin: DEMO_PINS.kitchen, venue: 'demo' } });
  assert.match(main.data.next, /^http:\/\/demo\.kalimenu\.test\/auth\/handoff/);
  // Demo PINs are shown on the demo address only.
  assert.ok((await guest('demo.kalimenu.test', '/api/demo')).data.pins);
  assert.equal((await guest(`${a}.kalimenu.test`, '/api/demo')).data.pins, null);
});

test('guest links: each address serves only its own venue, the main address forwards', async () => {
  const token = (await ownerA(`${a}.kalimenu.test`, '/api/admin/tables')).data[0].token;
  const g = browser();
  assert.equal((await g(`${a}.kalimenu.test`, `/api/public/table/${token}`)).status, 200);
  assert.equal((await g(`${b}.kalimenu.test`, `/api/public/table/${token}`)).status, 404);
  assert.equal((await g(`${b}.kalimenu.test`, `/api/public/menu/${a}`)).status, 404);
  assert.equal((await g(`${a}.kalimenu.test`, `/api/public/menu/${a}`)).status, 200);
  // Older QR codes and links on the main address move to the venue's address.
  assert.equal((await g(MAIN, `/t/${token}?pay=ok`)).location, `http://${a}.kalimenu.test/t/${token}?pay=ok`);
  assert.equal((await g(MAIN, `/m/${b}`)).location, `http://${b}.kalimenu.test/m/${b}`);
  assert.equal((await g(MAIN, '/staff?v=demo')).location, 'http://demo.kalimenu.test/staff');
  assert.equal((await g(`${a}.kalimenu.test`, '/')).location, `/m/${a}`);
  // QR codes and staff links of the venue use its address.
  const s = (await ownerA(`${a}.kalimenu.test`, '/api/admin/settings')).data;
  assert.equal(s.staffUrl, `http://${a}.kalimenu.test/staff`);
  assert.equal(s.menuUrl, `http://${a}.kalimenu.test/m/${a}`);
  // Unknown addresses go to the main site.
  assert.equal((await g('nobody.kalimenu.test', '/')).location, 'http://kalimenu.test');
  assert.equal((await g('nobody.kalimenu.test', '/api/public/menu/nobody')).status, 404);
});

test('the platform administration lives on the main address only and opens venues on their address', async () => {
  const boss = browser();
  assert.equal((await boss(`${a}.kalimenu.test`, '/super')).location, 'http://kalimenu.test/super');
  assert.equal((await boss(`${a}.kalimenu.test`, '/api/super/login', { method: 'POST', body: { email: 'boss@kalimenu.test', password: 'a-very-long-password-1' } })).status, 404);
  assert.equal((await boss(MAIN, '/api/super/login', { method: 'POST', body: { email: 'boss@kalimenu.test', password: 'a-very-long-password-1' } })).status, 200);
  const o = (await boss(MAIN, '/api/super/overview')).data;
  const venueB = o.venues.find((v) => v.slug === b);
  assert.equal(venueB.url, `http://${b}.kalimenu.test`);
  const imp = await boss(MAIN, `/api/super/venues/${venueB.id}/impersonate`, { method: 'POST' });
  assert.equal(new URL(imp.data.next).host, `${b}.kalimenu.test`);
  await boss.open(imp.data.next);
  assert.equal((await boss(`${b}.kalimenu.test`, '/api/staff/me')).data.venue.slug, b);
});

test('venue codes never take a name of the service', async () => {
  const r = await browser()(MAIN, '/api/account/signup', { method: 'POST', body: {
    business: 'WWW', email: 'www@example.com', password: 'secret-pass-1', acceptTerms: true, tables: 1 } });
  assert.equal(r.status, 201);
  assert.equal(r.data.venue.slug, 'www-2');
});

test('a new super admin password on the hosting replaces the old one on the next start', async () => {
  const { ensureSuperAdmin } = await import('../server/db.js');
  assert.equal(await ensureSuperAdmin('boss@kalimenu.test', 'a-very-long-password-1'), false, 'same password: nothing to change');
  assert.equal(await ensureSuperAdmin('boss@kalimenu.test', 'another-long-password-2'), true);
  const boss = browser();
  const login = (password) => boss(MAIN, '/api/super/login', { method: 'POST', body: { email: 'boss@kalimenu.test', password } });
  assert.equal((await login('a-very-long-password-1')).status, 401);
  assert.equal((await login('another-long-password-2')).status, 200);
});
