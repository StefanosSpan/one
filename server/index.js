import express from 'express';
import QRCode from 'qrcode';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import {
  db, ready, now, newToken, getSettings, setSetting,
  mapCategory, mapItem, mapTable, UPLOAD_DIR, SPOT_KINDS,
} from './db.js';
import { LANGS } from './seed.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 3000;

await ready;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '6mb' }));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// ---------------------------------------------------------------------------
// Realtime (Server-Sent Events)
// ---------------------------------------------------------------------------
const channels = new Map(); // channel -> Set<res>

function subscribe(channel, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  if (!channels.has(channel)) channels.set(channel, new Set());
  channels.get(channel).add(res);
  req.on('close', () => channels.get(channel)?.delete(res));
}

function emit(channel, event, data = {}) {
  const subs = channels.get(channel);
  if (!subs) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) res.write(payload);
}

setInterval(() => {
  for (const subs of channels.values()) for (const res of subs) res.write(': ping\n\n');
}, 25_000).unref();

// ---------------------------------------------------------------------------
// Staff authentication (PIN -> signed cookie)
// ---------------------------------------------------------------------------
const ROLES = ['admin', 'waiter', 'kitchen'];
const SESSION_HOURS = 16;

const sign = (value) => createHmac('sha256', getSettings().secret).update(value).digest('base64url');

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function staffRole(req) {
  const raw = readCookie(req, 'staff');
  if (!raw) return null;
  const [role, exp, sig] = raw.split('.');
  if (!ROLES.includes(role) || !(Number(exp) > Date.now()) || !sig) return null;
  const expected = Buffer.from(sign(`${role}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return role;
}

const requireStaff = (...roles) => (req, res, next) => {
  const role = staffRole(req);
  if (!role) return res.status(401).json({ error: 'Απαιτείται σύνδεση' });
  if (role !== 'admin' && roles.length && !roles.includes(role)) {
    return res.status(403).json({ error: 'Δεν έχετε πρόσβαση' });
  }
  req.role = role;
  next();
};

// Simple in-memory rate limiter
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const t = Date.now();
  const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (list.length >= max) return false;
  list.push(t);
  hits.set(key, list);
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

function cleanI18n(obj, max = 300) {
  const out = {};
  if (obj && typeof obj === 'object') {
    for (const l of LANGS) if (obj[l] != null && String(obj[l]).trim()) out[l] = cleanText(obj[l], max);
  }
  return out;
}

const ALLERGENS = ['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'nuts',
  'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'];
const TAGS = ['vegetarian', 'vegan', 'gluten_free', 'spicy', 'popular', 'new'];

async function tableByToken(token) {
  const t = mapTable(await db.get('SELECT * FROM tables WHERE token = ?', [String(token)]));
  if (!t || !t.active) fail(404, 'invalid_table');
  return t;
}

function publicRestaurant(s = getSettings()) {
  const r = s.restaurant || {};
  return {
    name: r.name, description: r.description || {}, hours: r.hours || {},
    address: r.address, phone: r.phone, email: r.email, mapsUrl: r.mapsUrl,
    wifiName: r.wifiName, wifiPassword: r.wifiPassword, instagram: r.instagram,
    reviewUrl: r.reviewUrl, logoUrl: r.logoUrl || '', coverUrl: r.coverUrl || '',
    brandColor: s.brandColor || '#1f3a5f',
  };
}

async function loadOrders(where, params = [], { order = 'o.id', limit } = {}) {
  const orders = await db.all(`
    SELECT o.*, t.label AS table_label, t.kind AS table_kind FROM orders o JOIN tables t ON t.id = o.table_id
    WHERE ${where} ORDER BY ${order}${limit ? ` LIMIT ${Number(limit)}` : ''}`, params);
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const items = await db.all(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
  const byOrder = new Map(ids.map((id) => [id, []]));
  for (const it of items) byOrder.get(it.order_id).push({ ...it, name: JSON.parse(it.name) });
  return orders.map((o) => ({
    id: o.id, tableId: o.table_id, tableLabel: o.table_label, tableKind: o.table_kind, status: o.status, note: o.note,
    lang: o.lang, total: o.total_cents, paid: !!o.paid, closed: !!o.closed,
    createdAt: o.created_at, updatedAt: o.updated_at,
    items: byOrder.get(o.id).map((i) => ({ itemId: i.item_id, name: i.name, qty: i.qty, price: i.price_cents, note: i.note })),
  }));
}

const loadOrder = async (id) => (await loadOrders('o.id = ?', [id]))[0];

async function loadCalls(where = "c.status = 'open'", params = []) {
  return (await db.all(`SELECT c.*, t.label AS table_label, t.kind AS table_kind FROM calls c JOIN tables t ON t.id = c.table_id
    WHERE ${where} ORDER BY c.id`, params))
    .map((c) => ({ id: c.id, tableId: c.table_id, tableLabel: c.table_label, tableKind: c.table_kind, type: c.type,
      paymentMethod: c.payment_method, status: c.status, createdAt: c.created_at }));
}

async function tableState(table) {
  const orders = await loadOrders('o.table_id = ? AND o.closed = 0', [table.id]);
  const billable = orders.filter((o) => o.status !== 'rejected');
  const total = billable.reduce((s, o) => s + o.total, 0);
  const paid = billable.filter((o) => o.paid).reduce((s, o) => s + o.total, 0);
  const calls = await loadCalls("c.status = 'open' AND c.table_id = ?", [table.id]);
  return { orders, calls, bill: { total, paid, due: total - paid } };
}

async function notifyTable(tableId) {
  const t = mapTable(await db.get('SELECT * FROM tables WHERE id = ?', [tableId]));
  if (t) emit(`table:${t.id}`, 'state', await tableState(t));
}

function baseUrl(req) {
  const configured = getSettings().publicBaseUrl;
  return (configured || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    if (out instanceof Promise) out.catch(next);
  } catch (e) { next(e); }
};

// ---------------------------------------------------------------------------
// Public (customer) API
// ---------------------------------------------------------------------------
app.get('/api/public/table/:token', wrap(async (req, res) => {
  const table = await tableByToken(req.params.token);
  const s = getSettings();
  res.json({
    restaurant: publicRestaurant(s),
    languages: s.languages,
    defaultLanguage: s.defaultLanguage,
    onlinePayments: s.onlinePayments,
    requireApproval: s.requireApproval,
    currency: s.currency,
    table: { label: table.label, kind: table.kind },
    categories: (await db.all('SELECT * FROM categories WHERE active = 1 ORDER BY sort, id')).map(mapCategory),
    items: (await db.all(`SELECT i.* FROM items i JOIN categories c ON c.id = i.category_id
      WHERE c.active = 1 ORDER BY i.sort, i.id`)).map(mapItem)
      .map(({ sort, ...i }) => i),
  });
}));

app.get('/api/public/table/:token/state', wrap(async (req, res) => {
  res.json(await tableState(await tableByToken(req.params.token)));
}));

app.get('/api/public/table/:token/stream', wrap(async (req, res) => {
  const table = await tableByToken(req.params.token);
  const state = await tableState(table);
  subscribe(`table:${table.id}`, req, res);
  res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
}));

app.post('/api/public/table/:token/orders', wrap(async (req, res) => {
  const table = await tableByToken(req.params.token);
  if (!rateLimit(`order:${table.id}`, 6, 60_000)) fail(429, 'too_many_requests');
  const lines = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!lines.length || lines.length > 40) fail(400, 'empty_order');

  const prepared = [];
  for (const l of lines) {
    const item = mapItem(await db.get('SELECT * FROM items WHERE id = ?', [Number(l.id)]));
    if (!item) fail(400, 'unknown_item');
    if (!item.available) fail(409, 'item_unavailable');
    const qty = Math.trunc(Number(l.qty));
    if (!(qty >= 1 && qty <= 50)) fail(400, 'bad_quantity');
    prepared.push({ item, qty, note: cleanText(l.note, 200) });
  }
  const total = prepared.reduce((s, p) => s + p.item.price_cents * p.qty, 0);
  const s = getSettings();
  const status = s.requireApproval ? 'pending' : 'accepted';
  const lang = LANGS.includes(req.body?.lang) ? req.body.lang : 'el';

  const orderId = await db.tx(async (t) => {
    const ts = now();
    const id = await t.insert(`INSERT INTO orders (table_id, status, note, lang, total_cents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [table.id, status, cleanText(req.body?.note, 300), lang, total, ts, ts]);
    for (const p of prepared) {
      await t.insert('INSERT INTO order_items (order_id, item_id, name, qty, price_cents, note) VALUES (?, ?, ?, ?, ?, ?)',
        [id, p.item.id, JSON.stringify(p.item.name), p.qty, p.item.price_cents, p.note]);
    }
    return id;
  });

  const order = await loadOrder(orderId);
  emit('staff', 'order:new', order);
  await notifyTable(table.id);
  res.status(201).json(order);
}));

app.post('/api/public/table/:token/calls', wrap(async (req, res) => {
  const table = await tableByToken(req.params.token);
  const type = req.body?.type === 'bill' ? 'bill' : 'waiter';
  const method = ['cash', 'card'].includes(req.body?.paymentMethod) ? req.body.paymentMethod : '';
  if (!rateLimit(`call:${table.id}`, 10, 60_000)) fail(429, 'too_many_requests');

  const existing = await db.get("SELECT id FROM calls WHERE table_id = ? AND type = ? AND status = 'open'", [table.id, type]);
  let id;
  if (existing) {
    id = existing.id;
    if (method) await db.run('UPDATE calls SET payment_method = ? WHERE id = ?', [method, id]);
  } else {
    id = await db.insert('INSERT INTO calls (table_id, type, payment_method, created_at) VALUES (?, ?, ?, ?)',
      [table.id, type, method, now()]);
  }
  const call = (await loadCalls('c.id = ?', [id]))[0];
  emit('staff', existing ? 'call:update' : 'call:new', call);
  await notifyTable(table.id);
  res.status(201).json(call);
}));

// Demo online payment: marks the table's open bill as paid. Replace with Viva Wallet / Stripe for production.
app.post('/api/public/table/:token/pay', wrap(async (req, res) => {
  const table = await tableByToken(req.params.token);
  if (getSettings().onlinePayments !== 'demo') fail(400, 'payments_disabled');
  const { bill } = await tableState(table);
  if (bill.due <= 0) fail(400, 'nothing_to_pay');
  await db.run("UPDATE orders SET paid = 1, updated_at = ? WHERE table_id = ? AND closed = 0 AND status != 'rejected'",
    [now(), table.id]);
  emit('staff', 'table:paid', { tableId: table.id, tableLabel: table.label, amount: bill.due });
  await notifyTable(table.id);
  res.json({ ok: true, amount: bill.due });
}));

// ---------------------------------------------------------------------------
// Staff API
// ---------------------------------------------------------------------------
app.post('/api/staff/login', wrap((req, res) => {
  const ip = req.ip || 'x';
  if (!rateLimit(`login:${ip}`, 10, 60_000)) fail(429, 'Πολλές προσπάθειες. Δοκιμάστε σε ένα λεπτό.');
  const pin = String(req.body?.pin ?? '');
  const pins = getSettings().pins || {};
  const role = ROLES.find((r) => pins[r] && pins[r] === pin);
  if (!role) fail(401, 'Λάθος PIN');
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  const value = `${role}.${exp}`;
  res.setHeader('Set-Cookie', `staff=${value}.${sign(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`);
  res.json({ role });
}));

app.post('/api/staff/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'staff=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/staff/me', (req, res) => {
  const role = staffRole(req);
  if (!role) return res.status(401).json({ error: 'Απαιτείται σύνδεση' });
  res.json({ role, restaurant: getSettings().restaurant?.name });
});

app.get('/api/staff/stream', requireStaff(), (req, res) => subscribe('staff', req, res));

app.get('/api/staff/overview', requireStaff(), wrap(async (req, res) => {
  const tables = (await db.all('SELECT * FROM tables ORDER BY id')).map(mapTable);
  const orders = await loadOrders('o.closed = 0');
  const calls = await loadCalls();
  const s = getSettings();
  const tableSummaries = tables.map((t) => {
    const mine = orders.filter((o) => o.tableId === t.id && o.status !== 'rejected');
    const total = mine.reduce((a, o) => a + o.total, 0);
    const paid = mine.filter((o) => o.paid).reduce((a, o) => a + o.total, 0);
    return { id: t.id, label: t.label, kind: t.kind, active: t.active, orders: mine.length, total, paid,
      calls: calls.filter((c) => c.tableId === t.id).map((c) => c.type) };
  });
  res.json({ role: req.role, requireApproval: s.requireApproval, tables: tableSummaries, orders, calls });
}));

const TRANSITIONS = {
  pending: ['accepted', 'rejected'],
  accepted: ['preparing', 'ready', 'rejected'],
  preparing: ['ready', 'accepted'],
  ready: ['served', 'preparing'],
  served: ['ready'],
};
const KITCHEN_ALLOWED = new Set(['preparing', 'ready', 'accepted']);

app.post('/api/staff/orders/:id/status', requireStaff(), wrap(async (req, res) => {
  const order = await loadOrder(Number(req.params.id));
  if (!order) fail(404, 'Η παραγγελία δεν βρέθηκε');
  const next = String(req.body?.status);
  if (!TRANSITIONS[order.status]?.includes(next)) fail(409, 'Μη επιτρεπτή αλλαγή κατάστασης');
  if (req.role === 'kitchen' && (order.status === 'pending' || !KITCHEN_ALLOWED.has(next))) {
    fail(403, 'Δεν επιτρέπεται από την κουζίνα');
  }
  await db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [next, now(), order.id]);
  const updated = await loadOrder(order.id);
  emit('staff', 'order:update', updated);
  await notifyTable(order.tableId);
  res.json(updated);
}));

app.post('/api/staff/calls/:id/done', requireStaff('waiter'), wrap(async (req, res) => {
  const call = (await loadCalls('c.id = ?', [Number(req.params.id)]))[0];
  if (!call) fail(404, 'Δεν βρέθηκε');
  await db.run("UPDATE calls SET status = 'done' WHERE id = ?", [call.id]);
  emit('staff', 'call:done', { id: call.id });
  await notifyTable(call.tableId);
  res.json({ ok: true });
}));

app.post('/api/staff/tables/:id/close', requireStaff('waiter'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const table = mapTable(await db.get('SELECT * FROM tables WHERE id = ?', [id]));
  if (!table) fail(404, 'Το τραπέζι δεν βρέθηκε');
  await db.tx(async (t) => {
    await t.run('UPDATE orders SET closed = 1, paid = 1, updated_at = ? WHERE table_id = ? AND closed = 0', [now(), id]);
    await t.run("UPDATE calls SET status = 'done' WHERE table_id = ? AND status = 'open'", [id]);
  });
  emit('staff', 'table:closed', { tableId: id });
  await notifyTable(id);
  res.json({ ok: true });
}));

// Any staff member may mark an item as sold out / available again.
app.get('/api/staff/items', requireStaff(), wrap(async (req, res) => {
  res.json((await db.all('SELECT * FROM items ORDER BY category_id, sort, id')).map(mapItem));
}));

app.post('/api/staff/items/:id/available', requireStaff(), wrap(async (req, res) => {
  const id = Number(req.params.id);
  await db.run('UPDATE items SET available = ? WHERE id = ?', [req.body?.available ? 1 : 0, id]);
  const item = mapItem(await db.get('SELECT * FROM items WHERE id = ?', [id]));
  if (!item) fail(404, 'Δεν βρέθηκε');
  emit('staff', 'menu:update', {});
  broadcastMenuUpdate();
  res.json(item);
}));

function broadcastMenuUpdate() {
  for (const ch of channels.keys()) if (ch.startsWith('table:')) emit(ch, 'menu', {});
}

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------
const admin = express.Router();
admin.use(requireStaff('admin'));

const adminSettings = () => {
  const { secret, ...s } = getSettings();
  return { ...s, allLanguages: LANGS, database: db.dialect };
};

admin.get('/settings', (req, res) => res.json(adminSettings()));

admin.put('/settings', wrap(async (req, res) => {
  const b = req.body || {};
  const cur = getSettings();
  if (b.restaurant) {
    const r = b.restaurant;
    await setSetting('restaurant', {
      ...cur.restaurant,
      name: cleanText(r.name, 80) || cur.restaurant.name,
      description: cleanI18n(r.description, 400),
      hours: cleanI18n(r.hours, 200),
      address: cleanText(r.address, 200), phone: cleanText(r.phone, 40), email: cleanText(r.email, 120),
      mapsUrl: cleanText(r.mapsUrl, 500), wifiName: cleanText(r.wifiName, 60), wifiPassword: cleanText(r.wifiPassword, 60),
      instagram: cleanText(r.instagram, 200), reviewUrl: cleanText(r.reviewUrl, 500), logoUrl: cleanText(r.logoUrl, 500), coverUrl: cleanText(r.coverUrl, 500),
    });
  }
  if (Array.isArray(b.languages)) {
    const langs = LANGS.filter((l) => b.languages.includes(l));
    if (!langs.length) fail(400, 'Επιλέξτε τουλάχιστον μία γλώσσα');
    await setSetting('languages', langs);
    const def = langs.includes(b.defaultLanguage) ? b.defaultLanguage : langs[0];
    await setSetting('defaultLanguage', def);
  }
  if (typeof b.requireApproval === 'boolean') await setSetting('requireApproval', b.requireApproval);
  if (['off', 'demo'].includes(b.onlinePayments)) await setSetting('onlinePayments', b.onlinePayments);
  if (typeof b.publicBaseUrl === 'string') await setSetting('publicBaseUrl', cleanText(b.publicBaseUrl, 200));
  if (typeof b.brandColor === 'string') {
    if (!/^#[0-9a-fA-F]{6}$/.test(b.brandColor)) fail(400, 'Μη έγκυρο χρώμα');
    await setSetting('brandColor', b.brandColor.toLowerCase());
  }
  if (b.pins) {
    const pins = { ...cur.pins };
    for (const r of ROLES) {
      if (b.pins[r] == null || b.pins[r] === '') continue;
      const p = String(b.pins[r]);
      if (!/^\d{4,8}$/.test(p)) fail(400, 'Τα PIN πρέπει να έχουν 4-8 ψηφία');
      pins[r] = p;
    }
    if (new Set(Object.values(pins)).size !== ROLES.length) fail(400, 'Κάθε ρόλος χρειάζεται διαφορετικό PIN');
    await setSetting('pins', pins);
  }
  broadcastMenuUpdate();
  res.json(adminSettings());
}));

admin.get('/menu', wrap(async (req, res) => {
  res.json({
    categories: (await db.all('SELECT * FROM categories ORDER BY sort, id')).map(mapCategory),
    items: (await db.all('SELECT * FROM items ORDER BY sort, id')).map(mapItem),
    allergens: ALLERGENS, tags: TAGS,
  });
}));

function categoryInput(b) {
  const name = cleanI18n(b.name, 80);
  if (!name.el && !name.en) fail(400, 'Δώστε όνομα κατηγορίας (τουλάχιστον στα Ελληνικά)');
  return { name: JSON.stringify(name), icon: cleanText(b.icon, 8), active: b.active === false ? 0 : 1 };
}

admin.post('/categories', wrap(async (req, res) => {
  const c = categoryInput(req.body || {});
  const { s: sort } = await db.get('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM categories');
  const id = await db.insert('INSERT INTO categories (name, icon, active, sort) VALUES (?, ?, ?, ?)', [c.name, c.icon, c.active, sort]);
  broadcastMenuUpdate();
  res.status(201).json(mapCategory(await db.get('SELECT * FROM categories WHERE id = ?', [id])));
}));

admin.put('/categories/:id', wrap(async (req, res) => {
  const c = categoryInput(req.body || {});
  const r = await db.run('UPDATE categories SET name = ?, icon = ?, active = ? WHERE id = ?', [c.name, c.icon, c.active, Number(req.params.id)]);
  if (!r.changes) fail(404, 'Δεν βρέθηκε');
  broadcastMenuUpdate();
  res.json(mapCategory(await db.get('SELECT * FROM categories WHERE id = ?', [Number(req.params.id)])));
}));

admin.delete('/categories/:id', wrap(async (req, res) => {
  await db.run('DELETE FROM categories WHERE id = ?', [Number(req.params.id)]);
  broadcastMenuUpdate();
  res.json({ ok: true });
}));

admin.post('/reorder', wrap(async (req, res) => {
  const { kind, ids } = req.body || {};
  const table = kind === 'categories' ? 'categories' : kind === 'items' ? 'items' : fail(400, 'bad kind');
  if (!Array.isArray(ids)) fail(400, 'bad ids');
  await db.tx(async (t) => {
    for (const [i, id] of ids.entries()) await t.run(`UPDATE ${table} SET sort = ? WHERE id = ?`, [i, Number(id)]);
  });
  broadcastMenuUpdate();
  res.json({ ok: true });
}));

async function itemInput(b) {
  const name = cleanI18n(b.name, 100);
  if (!name.el && !name.en) fail(400, 'Δώστε όνομα πιάτου (τουλάχιστον στα Ελληνικά)');
  const price = Math.round(Number(b.price) * 100);
  if (!(price >= 0 && price <= 1_000_000)) fail(400, 'Μη έγκυρη τιμή');
  const cat = await db.get('SELECT id FROM categories WHERE id = ?', [Number(b.categoryId) || 0]);
  if (!cat) fail(400, 'Επιλέξτε κατηγορία');
  return {
    category_id: cat.id, name: JSON.stringify(name), description: JSON.stringify(cleanI18n(b.description, 400)),
    price_cents: price,
    allergens: JSON.stringify(ALLERGENS.filter((a) => (b.allergens || []).includes(a))),
    tags: JSON.stringify(TAGS.filter((a) => (b.tags || []).includes(a))),
    emoji: cleanText(b.emoji, 8), image_url: cleanText(b.imageUrl, 500), available: b.available === false ? 0 : 1,
  };
}

admin.post('/items', wrap(async (req, res) => {
  const i = await itemInput(req.body || {});
  const { s: sort } = await db.get('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM items');
  const id = await db.insert(`INSERT INTO items (category_id, name, description, price_cents, allergens, tags, emoji, image_url, available, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [i.category_id, i.name, i.description, i.price_cents, i.allergens, i.tags,
    i.emoji, i.image_url, i.available, sort]);
  broadcastMenuUpdate();
  res.status(201).json(mapItem(await db.get('SELECT * FROM items WHERE id = ?', [id])));
}));

admin.put('/items/:id', wrap(async (req, res) => {
  const i = await itemInput(req.body || {});
  const r = await db.run(`UPDATE items SET category_id = ?, name = ?, description = ?, price_cents = ?, allergens = ?, tags = ?,
    emoji = ?, image_url = ?, available = ? WHERE id = ?`, [i.category_id, i.name, i.description, i.price_cents,
    i.allergens, i.tags, i.emoji, i.image_url, i.available, Number(req.params.id)]);
  if (!r.changes) fail(404, 'Δεν βρέθηκε');
  broadcastMenuUpdate();
  res.json(mapItem(await db.get('SELECT * FROM items WHERE id = ?', [Number(req.params.id)])));
}));

admin.delete('/items/:id', wrap(async (req, res) => {
  await db.run('DELETE FROM items WHERE id = ?', [Number(req.params.id)]);
  broadcastMenuUpdate();
  res.json({ ok: true });
}));

admin.post('/upload', wrap((req, res) => {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.dataUrl || ''));
  if (!m) fail(400, 'Υποστηρίζονται εικόνες PNG, JPG, WEBP, GIF');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) fail(400, 'Η εικόνα ξεπερνά τα 4MB');
  const name = `${Date.now()}-${randomBytes(4).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  writeFileSync(join(UPLOAD_DIR, name), buf);
  res.json({ url: `/uploads/${name}` });
}));

admin.get('/tables', wrap(async (req, res) => {
  const base = baseUrl(req);
  res.json((await db.all('SELECT * FROM tables ORDER BY id')).map(mapTable)
    .map((t) => ({ ...t, url: `${base}/t/${t.token}` })));
}));

admin.post('/tables', wrap(async (req, res) => {
  const b = req.body || {};
  const count = Math.min(Math.max(Math.trunc(Number(b.count) || 1), 1), 100);
  const kind = SPOT_KINDS.includes(b.kind) ? b.kind : 'table';
  const ins = 'INSERT INTO tables (label, token, kind) VALUES (?, ?, ?)';
  await db.tx(async (t) => {
    if (count === 1 && cleanText(b.label, 20)) return t.insert(ins, [cleanText(b.label, 20), newToken(), kind]);
    const { n } = await t.get('SELECT COUNT(*) AS n FROM tables WHERE kind = ?', [kind]);
    for (let i = 1; i <= count; i++) await t.insert(ins, [String(Number(n) + i), newToken(), kind]);
  });
  res.status(201).json({ ok: true });
}));

admin.put('/tables/:id', wrap(async (req, res) => {
  const label = cleanText(req.body?.label, 20);
  if (!label) fail(400, 'Δώστε όνομα τραπεζιού');
  const kind = SPOT_KINDS.includes(req.body?.kind) ? req.body.kind : 'table';
  await db.run('UPDATE tables SET label = ?, active = ?, kind = ? WHERE id = ?',
    [label, req.body?.active === false ? 0 : 1, kind, Number(req.params.id)]);
  res.json({ ok: true });
}));

admin.post('/tables/:id/regenerate', wrap(async (req, res) => {
  await db.run('UPDATE tables SET token = ? WHERE id = ?', [newToken(), Number(req.params.id)]);
  res.json({ ok: true });
}));

admin.delete('/tables/:id', wrap(async (req, res) => {
  await db.run('DELETE FROM tables WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
}));

admin.get('/tables/:id/qr.svg', wrap(async (req, res) => {
  const t = await db.get('SELECT * FROM tables WHERE id = ?', [Number(req.params.id)]);
  if (!t) fail(404, 'Δεν βρέθηκε');
  const svg = await QRCode.toString(`${baseUrl(req)}/t/${t.token}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.type('image/svg+xml').send(svg);
}));

admin.get('/stats', wrap(async (req, res) => {
  const days = Math.min(Math.max(Math.trunc(Number(req.query.days) || 1), 1), 365);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const since = start.toISOString();
  const agg = await db.get(`SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS revenue
    FROM orders WHERE created_at >= ? AND status != 'rejected'`, [since]);
  agg.orders = Number(agg.orders);
  agg.revenue = Number(agg.revenue);
  const top = (await db.all(`SELECT oi.item_id, MIN(oi.name) AS name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.price_cents) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.created_at >= ? AND o.status != 'rejected'
    GROUP BY oi.item_id ORDER BY qty DESC LIMIT 8`, [since]))
    .map((r) => ({ ...r, qty: Number(r.qty), revenue: Number(r.revenue), name: JSON.parse(r.name) }));
  const langs = (await db.all(`SELECT lang, COUNT(*) AS n FROM orders WHERE created_at >= ? AND status != 'rejected'
    GROUP BY lang ORDER BY n DESC`, [since])).map((r) => ({ ...r, n: Number(r.n) }));
  const byDay = (await db.all(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS orders, SUM(total_cents) AS revenue
    FROM orders WHERE created_at >= ? AND status != 'rejected' GROUP BY substr(created_at, 1, 10) ORDER BY day`, [since]))
    .map((r) => ({ ...r, orders: Number(r.orders), revenue: Number(r.revenue) }));
  const { n: rejected } = await db.get("SELECT COUNT(*) AS n FROM orders WHERE created_at >= ? AND status = 'rejected'", [since]);
  res.json({ days, ...agg, avg: agg.orders ? Math.round(agg.revenue / agg.orders) : 0, rejected: Number(rejected), top, langs, byDay });
}));

// Order history (everything is kept in the database) and export for accounting / Excel.
function dateRange(q) {
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? new Date(`${v}T00:00:00`) : null);
  const to = day(q.to) || new Date(new Date().setHours(0, 0, 0, 0));
  const from = day(q.from) || new Date(to.getTime() - 6 * 86400_000);
  const end = new Date(to.getTime() + 86400_000);
  return { from: from.toISOString(), to: end.toISOString() };
}

const STATUS_EL = { pending: 'Αναμονή έγκρισης', accepted: 'Εγκρίθηκε', preparing: 'Ετοιμάζεται', ready: 'Έτοιμη',
  served: 'Σερβιρίστηκε', rejected: 'Απορρίφθηκε' };
const KIND_EL = { table: 'Τραπέζι', room: 'Δωμάτιο', sunbed: 'Ξαπλώστρα' };

async function historyQuery(q) {
  const { from, to } = dateRange(q);
  const where = ['o.created_at >= ?', 'o.created_at < ?'];
  const params = [from, to];
  if (STATUS_EL[q.status]) { where.push('o.status = ?'); params.push(q.status); }
  return loadOrders(where.join(' AND '), params, { order: 'o.id DESC', limit: 2000 });
}

admin.get('/orders', wrap(async (req, res) => {
  const orders = await historyQuery(req.query);
  const counted = orders.filter((o) => o.status !== 'rejected');
  res.json({
    orders,
    summary: { count: counted.length, revenue: counted.reduce((s, o) => s + o.total, 0), rejected: orders.length - counted.length },
  });
}));

admin.get('/orders.csv', wrap(async (req, res) => {
  const orders = await historyQuery(req.query);
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const money = (c) => (c / 100).toFixed(2).replace('.', ',');
  const rows = [['Αριθμός', 'Ημερομηνία', 'Ώρα', 'Θέση', 'Κατάσταση', 'Γλώσσα', 'Πιάτα', 'Σημείωση', 'Σύνολο (€)', 'Εξοφλήθηκε']];
  for (const o of [...orders].reverse()) {
    const d = new Date(o.createdAt);
    rows.push([o.id, d.toLocaleDateString('el-GR'), d.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }),
      `${KIND_EL[o.tableKind] || ''} ${o.tableLabel}`, STATUS_EL[o.status] || o.status, o.lang.toUpperCase(),
      o.items.map((i) => `${i.qty}x ${i.name.el || i.name.en || ''}`).join(', '), o.note, money(o.total), o.paid ? 'Ναι' : 'Όχι']);
  }
  // Semicolons + BOM so Excel in Greek locale opens it with correct columns and characters.
  const csv = `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
  const { from, to } = dateRange(req.query);
  res.setHeader('Content-Disposition', `attachment; filename="paraggelies_${from.slice(0, 10)}_${to.slice(0, 10)}.csv"`);
  res.type('text/csv; charset=utf-8').send(csv);
}));

app.use('/api/admin', admin);

// ---------------------------------------------------------------------------
// Pages & static files
// ---------------------------------------------------------------------------
const page = (file) => (req, res) => res.sendFile(join(PUBLIC_DIR, file));
app.get('/t/:token', page('customer.html'));
app.get('/staff', page('staff/login.html'));
app.get('/staff/waiter', page('staff/waiter.html'));
app.get('/staff/kitchen', page('staff/kitchen.html'));
app.get('/staff/admin', page('staff/admin.html'));
app.get('/staff/qr', page('staff/qr.html'));

// Demo landing page needs a real table link.
app.get('/api/demo', wrap(async (req, res) => {
  const t = await db.all('SELECT label, token, kind FROM tables WHERE active = 1 ORDER BY id LIMIT 3');
  const { pins } = getSettings();
  // Only reveal PINs while the demo defaults are still in use.
  const isDemo = pins.admin === '1234' && pins.waiter === '1111' && pins.kitchen === '2222';
  res.json({ tables: t.map((x) => ({ label: x.label, kind: x.kind, url: `/t/${x.token}` })), pins: isDemo ? pins : null });
}));

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'server_error' : err.message });
});

export { app };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  app.listen(PORT, '0.0.0.0', () => {
    const lan = Object.values(networkInterfaces()).flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    console.log(`\n  Taverna QR τρέχει\n`);
    console.log(`  Στον υπολογιστή:  http://localhost:${PORT}`);
    if (lan) console.log(`  Από κινητό (ίδιο Wi-Fi): http://${lan}:${PORT}`);
    console.log(`  Βάση δεδομένων: ${db.dialect === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : 'SQLite (data/taverna.db)'}`);
    console.log(`\n  PIN demo → Admin: 1234 · Σερβιτόρος: 1111 · Κουζίνα: 2222\n`);
  });
}
