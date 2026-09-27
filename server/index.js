import express from 'express';
import QRCode from 'qrcode';
import { createHmac, timingSafeEqual, randomBytes, scrypt as scryptCb, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import {
  db, ready, now, newToken, setSetting, getVenue, venueBySlug, updateVenue, createVenue, deleteVenue, resetDemoVenue, DEMO_PINS,
  hashPassword,
  mapCategory, mapItem, mapTable, UPLOAD_DIR, SPOT_KINDS,
} from './db.js';
import { LANGS } from './seed.js';
import { PLANS, PAID_PLANS, TRIAL_DAYS, STANDARD_SPOTS, effectivePlan, features, priceCents, planOf, planForSpots } from './plans.js';
import { stripe, stripeEnabled, verifyWebhook, venueStatus } from './billing.js';
import { vivaCreateOrder, vivaVerify } from './payments.js';
import { sendMail } from './mail.js';
import { DEFAULT_TZ, venueClock, inWindow, cleanWindow, cleanZones, categoryVisible, happyHourActive, dishPrice } from './menu-rules.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const PRODUCTION = process.env.NODE_ENV === 'production';
// Public address of the service, e.g. https://kalimenu.gr (used in e-mails, payment redirects and QR codes).
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
const scrypt = promisify(scryptCb);
// Version of the terms of use / privacy policy / data processing terms that owners accept at sign-up.
const TERMS_VERSION = '2026-09-27';
// Details of the business that runs the service, shown in the footer and the legal pages (set on the hosting).
const COMPANY = {
  name: process.env.COMPANY_NAME || '', vat: process.env.COMPANY_VAT || '', taxOffice: process.env.COMPANY_TAX_OFFICE || '',
  gemi: process.env.COMPANY_GEMI || '', address: process.env.COMPANY_ADDRESS || '',
  email: process.env.CONTACT_EMAIL || '', phone: process.env.CONTACT_PHONE || '',
};

await ready;

const app = express();
app.disable('x-powered-by');
// Behind the hosting provider's proxy: trust X-Forwarded-Proto so secure cookies and links use https.
if (PRODUCTION || process.env.TRUST_PROXY) app.set('trust proxy', 1);
// Other domains of the service (e.g. kalimenu.com, www.kalimenu.gr) redirect permanently to APP_URL.
const REDIRECT_HOSTS = new Set((process.env.REDIRECT_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
if (APP_URL && REDIRECT_HOSTS.size) {
  app.use((req, res, next) => (REDIRECT_HOSTS.has(String(req.hostname).toLowerCase())
    ? res.redirect(301, APP_URL + req.originalUrl) : next()));
}
// Basic security headers (the pages load no third-party scripts).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Staff, admin and account pages must not be shown inside other sites (clickjacking).
  if (!req.path.startsWith('/t/')) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});

app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res, next) => stripeWebhook(req, res).catch(next));
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
// Authentication. Staff log in with a PIN, owners with e-mail and password; both get a cookie
// "venueId.role.expiry.accountId.signature" signed with the venue's secret (accountId is 0 for PIN logins).
// ---------------------------------------------------------------------------
const ROLES = ['admin', 'waiter', 'kitchen'];
const SESSION_HOURS = 16;
const OWNER_SESSION_HOURS = 24 * 30;

const sign = (venue, value) => createHmac('sha256', venue.settings.secret).update(value).digest('base64url');

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// `who` is the owner's account id, `s<id>` for a named staff member, or 0 for a shared role PIN.
function setSession(req, res, venue, role, who = 0) {
  const hours = typeof who === 'number' && who ? OWNER_SESSION_HOURS : SESSION_HOURS;
  const value = `${venue.id}.${role}.${Date.now() + hours * 3600_000}.${who}`;
  res.setHeader('Set-Cookie', `staff=${value}.${sign(venue, value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${hours * 3600}${req.secure ? '; Secure' : ''}`);
}

async function staffSession(req) {
  const raw = readCookie(req, 'staff');
  if (!raw) return null;
  const [venueId, role, exp, accountId, sig] = raw.split('.');
  if (!ROLES.includes(role) || !(Number(exp) > Date.now()) || !sig) return null;
  const venue = await getVenue(Number(venueId));
  if (!venue || venue.status === 'suspended') return null;
  const expected = Buffer.from(sign(venue, `${venueId}.${role}.${exp}.${accountId}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const memberId = accountId?.startsWith('s') ? accountId.slice(1) : '';
  const member = memberId ? (venue.settings.staff || []).find((m) => m.id === memberId) : null;
  if (memberId && (!member || member.role !== role)) return null; // removed or changed since login
  return { venue, role, accountId: memberId ? 0 : Number(accountId) || 0, member };
}

const requireStaff = (...roles) => (req, res, next) => {
  staffSession(req).then((session) => {
    if (!session) return res.status(401).json({ error: 'Απαιτείται σύνδεση' });
    if (session.role !== 'admin' && roles.length && !roles.includes(session.role)) {
      return res.status(403).json({ error: 'Δεν έχετε πρόσβαση' });
    }
    req.venue = session.venue;
    req.role = session.role;
    req.accountId = session.accountId;
    req.member = session.member;
    next();
  }, next);
};

// Billing and account pages need the owner's e-mail login, not only the admin PIN.
const requireOwner = [requireStaff('admin'), (req, res, next) => (req.accountId
  ? next() : res.status(403).json({ error: 'Συνδεθείτε με το e-mail του ιδιοκτήτη για τη συνδρομή' }))];

async function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const given = await scrypt(String(password), salt, 64);
  const expected = Buffer.from(hash, 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
const sha256 = (v) => createHash('sha256').update(String(v)).digest('hex');

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
const TAGS = ['vegetarian', 'vegan', 'gluten_free', 'spicy', 'popular', 'new', 'suggest'];

// Validates the customer's option choices ([[groupIndex, choiceIndex], ...]) and returns the unit price.
// `base` is the dish price for this spot and moment (happy hour, all-inclusive); options are free when the dish is included.
function priceWithOptions(item, picks, base = item.price_cents, included = false) {
  const groups = item.options || [];
  const selected = groups.map(() => new Set());
  for (const pair of Array.isArray(picks) ? picks.slice(0, 50) : []) {
    const [g, c] = Array.isArray(pair) ? pair.map(Number) : [];
    if (!groups[g]?.choices?.[c]) fail(400, 'bad_option');
    selected[g].add(c);
  }
  let unit = base;
  const chosen = [];
  groups.forEach((group, g) => {
    const picked = [...selected[g]].sort((a, b) => a - b);
    if (group.required && !picked.length) fail(400, 'option_required');
    if (!group.multi && picked.length > 1) fail(400, 'bad_option');
    for (const c of picked) {
      const choice = group.choices[c];
      const extra = included ? 0 : choice.price_cents || 0;
      unit += extra;
      chosen.push({ group: group.name, choice: choice.name, price_cents: extra });
    }
  });
  return { unit, chosen };
}

function cleanOptions(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 10).map((g) => ({
    name: cleanI18n(g?.name, 60),
    required: !!g?.required,
    multi: !!g?.multi,
    choices: (Array.isArray(g?.choices) ? g.choices : []).slice(0, 20).map((c) => ({
      name: cleanI18n(c?.name, 60),
      price_cents: Math.max(0, Math.min(100_000, Math.round(Number(c?.price || 0) * 100) || 0)),
    })).filter((c) => c.name.el || c.name.en),
  })).filter((g) => (g.name.el || g.name.en) && g.choices.length);
}

// Finds the spot of a QR link and loads its venue into req.venue.
async function tableByToken(req, token = req.params.token) {
  const t = mapTable(await db.get('SELECT * FROM tables WHERE token = ?', [String(token)]));
  if (!t || !t.active) fail(404, 'invalid_table');
  req.venue = await getVenue(t.venue_id);
  if (!req.venue || req.venue.status === 'suspended') fail(404, 'invalid_table');
  // Without a trial or subscription the menu is not shown; the guest is asked to use the printed menu.
  if (features(req.venue).inactive) { const e = new HttpError(403, 'venue_inactive'); e.code = 'venue_inactive'; throw e; }
  return t;
}

// Look of the guest menu (Admin → Εμφάνιση). Colours are #rrggbb; empty means "use the default".
const THEME_FONTS = ['modern', 'classic', 'elegant', 'rounded', 'traditional'];
const THEME_CORNERS = ['square', 'soft', 'round'];
const HEX = /^#[0-9a-f]{6}$/i;
function cleanTheme(t = {}) {
  const color = (v) => (HEX.test(String(v || '')) ? String(v).toLowerCase() : '');
  return {
    background: color(t.background), text: color(t.text), category: color(t.category),
    font: THEME_FONTS.includes(t.font) ? t.font : 'modern',
    corners: THEME_CORNERS.includes(t.corners) ? t.corners : 'soft',
  };
}

// What the guest sees at this spot right now: visible categories and dish prices.
async function menuFor(venue, table) {
  const s = venue.settings;
  const clock = venueClock(s.timezone || DEFAULT_TZ);
  const happy = happyHourActive(s, clock);
  const ctx = { clock, table, happy };
  const categories = (await db.all('SELECT * FROM categories WHERE venue_id = ? ORDER BY sort, id', [venue.id]))
    .map(mapCategory).filter((c) => categoryVisible(c, ctx));
  const visible = new Set(categories.map((c) => c.id));
  const items = (await db.all('SELECT * FROM items WHERE venue_id = ? ORDER BY sort, id', [venue.id])).map(mapItem)
    .filter((i) => visible.has(i.category_id))
    .map(({ sort, venue_id, happy_price_cents, stock, ...i }) => {
      const p = dishPrice({ ...i, happy_price_cents }, ctx);
      return { ...i, base_price_cents: i.price_cents, price_cents: p.price, happy: p.happy, included: p.included,
        lowStock: stock != null && stock > 0 && stock <= 3 ? stock : null };
    });
  return { categories, items, ctx, happy };
}

function publicRestaurant(venue) {
  const s = venue.settings;
  const r = s.restaurant || {};
  return {
    name: r.name, description: r.description || {}, hours: r.hours || {},
    address: r.address, phone: r.phone, email: r.email, mapsUrl: r.mapsUrl,
    wifiName: r.wifiName, wifiPassword: r.wifiPassword, instagram: r.instagram,
    reviewUrl: r.reviewUrl, logoUrl: r.logoUrl || '', coverUrl: r.coverUrl || '',
    brandColor: s.brandColor || '#1f3a5f',
    theme: cleanTheme(s.theme),
    legalName: r.legalName || '', vatNumber: r.vatNumber || '', taxOffice: r.taxOffice || '', receiptFooter: r.receiptFooter || '',
  };
}

async function loadOrders(venueId, where, params = [], { order = 'o.id', limit } = {}) {
  const orders = await db.all(`
    SELECT o.*, t.label AS table_label, t.kind AS table_kind, t.zone AS table_zone FROM orders o JOIN tables t ON t.id = o.table_id
    WHERE o.venue_id = ? AND ${where} ORDER BY ${order}${limit ? ` LIMIT ${Number(limit)}` : ''}`, [venueId, ...params]);
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const items = await db.all(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
  const byOrder = new Map(ids.map((id) => [id, []]));
  for (const it of items) byOrder.get(it.order_id).push({ ...it, name: JSON.parse(it.name), options: JSON.parse(it.options || '[]') });
  return orders.map((o) => ({
    id: o.id, tableId: o.table_id, tableLabel: o.table_label, tableKind: o.table_kind, status: o.status, note: o.note,
    lang: o.lang, total: o.total_cents, paid: !!o.paid, closed: !!o.closed,
    createdAt: o.created_at, updatedAt: o.updated_at,
    tableZone: o.table_zone || '', etaAt: o.eta_at || '', channel: o.channel || 'table',
    customer: o.channel === 'takeaway' ? { name: o.customer_name, phone: o.customer_phone, pickupAt: o.pickup_at } : null,
    items: byOrder.get(o.id).map((i) => ({ id: i.id, itemId: i.item_id, name: i.name, qty: i.qty, price: i.price_cents, note: i.note, options: i.options,
      station: i.station || 'kitchen', ready: !!i.ready, paidQty: Number(i.paid_qty) || 0 })),
  }));
}

const loadOrder = async (venueId, id) => (await loadOrders(venueId, 'o.id = ?', [id]))[0];

async function loadCalls(venueId, where = "c.status = 'open'", params = []) {
  return (await db.all(`SELECT c.*, t.label AS table_label, t.kind AS table_kind, t.zone AS table_zone FROM calls c JOIN tables t ON t.id = c.table_id
    WHERE c.venue_id = ? AND ${where} ORDER BY c.id`, [venueId, ...params]))
    .map((c) => ({ id: c.id, tableId: c.table_id, tableLabel: c.table_label, tableKind: c.table_kind, tableZone: c.table_zone || '', type: c.type,
      paymentMethod: c.payment_method, status: c.status, createdAt: c.created_at }));
}

// Paid so far from guests' phones or charged to the room, for the spot's open bill (tips not included).
async function paidFor(tableId) {
  const { paid } = await db.get("SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM payments WHERE table_id = ? AND closed = 0 AND status = 'paid'", [tableId]);
  return Number(paid);
}

async function tableState(table) {
  const orders = await loadOrders(table.venue_id, 'o.table_id = ? AND o.closed = 0', [table.id]);
  const billable = orders.filter((o) => o.status !== 'rejected');
  const total = billable.reduce((s, o) => s + o.total, 0);
  const paid = Math.min(await paidFor(table.id), total);
  const calls = await loadCalls(table.venue_id, "c.status = 'open' AND c.table_id = ?", [table.id]);
  return { orders, calls, bill: { total, paid, due: total - paid } };
}

async function notifyTable(tableId) {
  const t = mapTable(await db.get('SELECT * FROM tables WHERE id = ?', [tableId]));
  if (t) emit(`table:${t.venue_id}:${t.id}`, 'state', await tableState(t));
}

const staffChannel = (venue) => `staff:${venue.id}`;

// Address used in QR codes and links: the venue's own setting, the service address, or the address of this request.
function baseUrl(req) {
  const configured = req.venue?.settings.publicBaseUrl || APP_URL;
  return (configured || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function planLimit(message) {
  const e = new HttpError(403, message);
  e.code = 'plan_limit';
  throw e;
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
  const table = await tableByToken(req);
  const { venue } = req;
  const s = venue.settings;
  const f = features(venue);
  const { categories, items, happy } = await menuFor(venue, table);
  const ann = s.announcement;
  res.json({
    restaurant: publicRestaurant(venue),
    languages: s.languages,
    defaultLanguage: s.defaultLanguage,
    onlinePayments: publicPayments(venue, table).provider,
    payments: publicPayments(venue, table),
    requireApproval: s.requireApproval,
    currency: s.currency,
    features: { ordering: f.ordering, calls: f.calls },
    table: { label: table.label, kind: table.kind, zone: table.zone, allInclusive: table.all_inclusive },
    happyHour: happy ? { label: s.happyHour?.label || {}, to: s.happyHour?.to || '' } : null,
    announcement: ann?.active && (ann.text?.el || ann.text?.en || ann.itemId) ? { text: ann.text || {}, itemId: ann.itemId || null } : null,
    categories: categories.map(({ schedule, zones, station, venue_id, ...c }) => c),
    items,
  });
}));

app.get('/api/public/table/:token/state', wrap(async (req, res) => {
  res.json(await tableState(await tableByToken(req)));
}));

app.get('/api/public/table/:token/stream', wrap(async (req, res) => {
  const table = await tableByToken(req);
  const state = await tableState(table);
  subscribe(`table:${table.venue_id}:${table.id}`, req, res);
  res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
}));

app.post('/api/public/table/:token/orders', wrap(async (req, res) => {
  const table = await tableByToken(req);
  const { venue } = req;
  if (!features(venue).ordering) fail(403, 'ordering_disabled');
  if (!rateLimit(`order:${table.id}`, 6, 60_000)) fail(429, 'too_many_requests');
  const lines = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!lines.length || lines.length > 40) fail(400, 'empty_order');

  const { categories, ctx } = await menuFor(venue, table);
  const visible = new Map(categories.map((c) => [c.id, c]));
  const prepared = [];
  const wanted = new Map(); // item id -> portions, for stock
  for (const l of lines) {
    const item = mapItem(await db.get('SELECT * FROM items WHERE id = ? AND venue_id = ?', [Number(l.id) || 0, venue.id]));
    if (!item) fail(400, 'unknown_item');
    // Sold out, or its category is not offered at this spot / at this hour.
    if (!item.available || !visible.has(item.category_id)) fail(409, 'item_unavailable');
    const qty = Math.trunc(Number(l.qty));
    if (!(qty >= 1 && qty <= 50)) fail(400, 'bad_quantity');
    const p = dishPrice(item, ctx);
    const { unit, chosen } = priceWithOptions(item, l.options, p.price, p.included);
    wanted.set(item.id, (wanted.get(item.id) || 0) + qty);
    if (item.stock != null && wanted.get(item.id) > item.stock) fail(409, 'item_unavailable');
    prepared.push({ item, qty, unit, chosen, note: cleanText(l.note, 200), station: visible.get(item.category_id).station || 'kitchen' });
  }
  const total = prepared.reduce((s, p) => s + p.unit * p.qty, 0);
  const status = venue.settings.requireApproval ? 'pending' : 'accepted';
  const lang = LANGS.includes(req.body?.lang) ? req.body.lang : 'el';

  const orderId = await db.tx(async (t) => {
    const ts = now();
    const guestId = /^[\w-]{8,40}$/.test(req.body?.guestId || '') ? req.body.guestId : '';
    const id = await t.insert(`INSERT INTO orders (venue_id, table_id, status, note, lang, total_cents, created_at, updated_at, guest_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [venue.id, table.id, status, cleanText(req.body?.note, 300), lang, total, ts, ts, guestId]);
    for (const p of prepared) {
      await t.insert('INSERT INTO order_items (order_id, item_id, name, qty, price_cents, note, options, station) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, p.item.id, JSON.stringify(p.item.name), p.qty, p.unit, p.note, JSON.stringify(p.chosen), p.station]);
    }
    // Stock: portions are taken when ordered; at zero the dish becomes sold out.
    for (const [itemId, qty] of wanted) {
      const r = await t.run('UPDATE items SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL AND stock >= ?', [qty, itemId, qty]);
      const row = await t.get('SELECT stock FROM items WHERE id = ?', [itemId]);
      if (row.stock != null && !r.changes) throw new HttpError(409, 'item_unavailable');
      if (row.stock === 0) await t.run('UPDATE items SET available = 0 WHERE id = ?', [itemId]);
    }
    return id;
  });
  if ([...wanted.keys()].length) broadcastMenuUpdate(venue);

  if (status === 'accepted') await startClock(venue, orderId);
  const order = await loadOrder(venue.id, orderId);
  emit(staffChannel(venue), 'order:new', order);
  await notifyTable(table.id);
  res.status(201).json(order);
}));

app.post('/api/public/table/:token/calls', wrap(async (req, res) => {
  const table = await tableByToken(req);
  const { venue } = req;
  if (!features(venue).calls) fail(403, 'calls_disabled');
  const type = req.body?.type === 'bill' ? 'bill' : 'waiter';
  const method = ['cash', 'card'].includes(req.body?.paymentMethod) ? req.body.paymentMethod : '';
  if (!rateLimit(`call:${table.id}`, 10, 60_000)) fail(429, 'too_many_requests');

  const existing = await db.get("SELECT id FROM calls WHERE table_id = ? AND type = ? AND status = 'open'", [table.id, type]);
  let id;
  if (existing) {
    id = existing.id;
    if (method) await db.run('UPDATE calls SET payment_method = ? WHERE id = ?', [method, id]);
  } else {
    id = await db.insert('INSERT INTO calls (venue_id, table_id, type, payment_method, created_at) VALUES (?, ?, ?, ?, ?)',
      [venue.id, table.id, type, method, now()]);
  }
  const call = (await loadCalls(venue.id, 'c.id = ?', [id]))[0];
  emit(staffChannel(venue), existing ? 'call:update' : 'call:new', call);
  await notifyTable(table.id);
  res.status(201).json(call);
}));

// ---------------------------------------------------------------------------
// Guest payments from the phone: whole bill, own dishes or an equal share, with tip; or charge to the room.
// ---------------------------------------------------------------------------
function paymentSettings(venue) {
  const p = venue.settings.payments || {};
  let provider = p.provider || (venue.settings.onlinePayments === 'demo' ? 'demo' : 'off');
  if (provider === 'demo' && !canUseDemoPayments(venue)) provider = 'off';
  if (provider === 'viva' && !(p.clientId && p.clientSecret)) provider = 'off';
  return { ...p, provider, tips: Array.isArray(p.tips) ? p.tips : [0, 5, 10, 15], roomCharge: !!p.roomCharge };
}

const publicPayments = (venue, table) => {
  const p = paymentSettings(venue);
  if (!features(venue).ordering) return { provider: 'off', tips: [], roomCharge: false };
  return { provider: p.provider, tips: p.tips, roomCharge: p.roomCharge && table.kind === 'room' };
};

// Marks a payment paid: dishes it covered, orders fully paid, staff and guests notified.
async function settlePayment(payment, venue) {
  const done = await db.tx(async (t) => {
    const r = await t.run("UPDATE payments SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'", [now(), payment.id]);
    if (!r.changes) return false;
    for (const [orderItemId, qty] of JSON.parse(payment.lines || '[]')) {
      await t.run('UPDATE order_items SET paid_qty = MIN(qty, paid_qty + ?) WHERE id = ?'.replace('MIN(', t.dialect === 'postgres' ? 'LEAST(' : 'MIN('), [qty, orderItemId]);
    }
    return true;
  });
  if (!done) return;
  const table = mapTable(await db.get('SELECT * FROM tables WHERE id = ?', [payment.table_id]));
  const { bill } = await tableState(table);
  if (bill.due <= 0) await db.run("UPDATE orders SET paid = 1 WHERE table_id = ? AND closed = 0 AND status != 'rejected'", [table.id]);
  emit(staffChannel(venue), 'table:paid', { tableId: table.id, tableLabel: table.label, amount: payment.amount_cents,
    tip: payment.tip_cents, method: payment.method, due: bill.due });
  await notifyTable(table.id);
}

app.post('/api/public/table/:token/pay', wrap(async (req, res) => {
  const table = await tableByToken(req);
  const { venue } = req;
  const cfg = publicPayments(venue, table);
  const method = req.body?.method === 'room' ? 'room' : 'online';
  if (method === 'room' ? !cfg.roomCharge : cfg.provider === 'off') fail(400, 'payments_disabled');
  if (!rateLimit(`pay:${table.id}`, 10, 60_000)) fail(429, 'too_many_requests');
  const state = await tableState(table);
  if (state.bill.due <= 0) fail(400, 'nothing_to_pay');

  // How much: everything, chosen dishes, or one equal share of the bill.
  const mode = ['items', 'share'].includes(req.body?.mode) ? req.body.mode : 'all';
  let amount = state.bill.due;
  let lines = [];
  if (mode === 'items') {
    const open = new Map(state.orders.filter((o) => o.status !== 'rejected').flatMap((o) => o.items).map((i) => [i.id, i]));
    lines = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 100).map(([id, qty]) => {
      const it = open.get(Number(id));
      const n = Math.trunc(Number(qty));
      if (!it || !(n >= 1) || n > it.qty - it.paidQty) fail(400, 'bad_items');
      return [it.id, n, it.price];
    });
    if (!lines.length) fail(400, 'bad_items');
    amount = Math.min(lines.reduce((sum, [, n, price]) => sum + n * price, 0), state.bill.due);
    lines = lines.map(([id, n]) => [id, n]);
  } else if (mode === 'share') {
    const people = Math.min(Math.max(Math.trunc(Number(req.body.people)) || 2, 2), 30);
    amount = Math.min(Math.ceil(state.bill.total / people), state.bill.due);
  }
  if (amount <= 0) fail(400, 'nothing_to_pay');
  const tipPct = Number(req.body?.tipPercent) || 0;
  const tip = method === 'room' ? 0 : Math.min(Math.max(Math.round(amount * tipPct / 100), 0), Math.round(amount / 2));
  const guestId = /^[\w-]{8,40}$/.test(req.body?.guestId || '') ? req.body.guestId : '';
  const provider = method === 'room' ? 'room' : cfg.provider;
  const id = await db.insert(`INSERT INTO payments (venue_id, table_id, provider, amount_cents, tip_cents, lines, method, status, guest_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, [venue.id, table.id, provider, amount, tip, JSON.stringify(lines), method, guestId, now()]);
  const payment = await db.get('SELECT * FROM payments WHERE id = ?', [id]);

  if (provider === 'viva') {
    const p = paymentSettings(venue);
    const order = await vivaCreateOrder(p, {
      amount, tip, lang: req.body?.lang, reference: `KM-${venue.id}-${id}`,
      description: `${venue.name} · ${table.label}`.slice(0, 100),
    });
    await db.run('UPDATE payments SET ref = ? WHERE id = ?', [order.orderCode, id]);
    return res.json({ ok: true, url: order.url });
  }
  // Room charge (settled on check-out) and the demo provider are confirmed straight away.
  await settlePayment(payment, venue);
  res.json({ ok: true, amount, tip, method });
}));

// Viva sends the guest back here (set this as Success and Failure URL of the venue's Viva payment source).
app.get('/pay/viva/return', wrap(async (req, res) => {
  const orderCode = String(req.query.s || '');
  const payment = orderCode && await db.get("SELECT * FROM payments WHERE ref = ? AND provider = 'viva'", [orderCode]);
  if (!payment) return res.redirect('/');
  const venue = await getVenue(payment.venue_id);
  const table = await db.get('SELECT token FROM tables WHERE id = ?', [payment.table_id]);
  let ok = false;
  if (venue && req.query.t) {
    const check = await vivaVerify(paymentSettings(venue), String(req.query.t)).catch(() => ({ ok: false }));
    ok = check.ok && check.orderCode === orderCode && check.amount >= payment.amount_cents + payment.tip_cents;
    if (ok) {
      await db.run('UPDATE payments SET transaction_id = ? WHERE id = ?', [String(req.query.t).slice(0, 80), payment.id]);
      await settlePayment(payment, venue);
    } else {
      await db.run("UPDATE payments SET status = 'failed' WHERE id = ? AND status = 'pending'", [payment.id]);
    }
  }
  res.redirect(`/t/${table?.token || ''}?pay=${ok ? 'ok' : 'fail'}`);
}));



// ---------------------------------------------------------------------------
// Staff API
// ---------------------------------------------------------------------------
// Staff log in with the venue's short code (from their login link /staff?v=code) and their PIN.
// With a single venue in the database (own installation) the code can be left out.
async function venueForLogin(code) {
  if (code) return (await venueBySlug(code)) || fail(404, 'Δεν βρέθηκε κατάστημα με αυτόν τον κωδικό');
  const rows = await db.all('SELECT id FROM venues ORDER BY id LIMIT 2');
  if (rows.length !== 1) { const e = new HttpError(400, 'Χρειάζεται ο κωδικός καταστήματος'); e.code = 'venue_required'; throw e; }
  return getVenue(rows[0].id);
}

app.post('/api/staff/login', wrap(async (req, res) => {
  const ip = req.ip || 'x';
  if (!rateLimit(`login:${ip}`, 10, 60_000)) fail(429, 'Πολλές προσπάθειες. Δοκιμάστε σε ένα λεπτό.');
  const venue = await venueForLogin(cleanText(req.body?.venue, 40).toLowerCase());
  const pin = String(req.body?.pin ?? '');
  const pins = venue.settings.pins || {};
  if (venue.status === 'suspended') fail(403, 'Ο λογαριασμός του καταστήματος έχει ανασταλεί');
  const member = (venue.settings.staff || []).find((m) => m.pin === pin);
  const role = member?.role || ROLES.find((r) => pins[r] && pins[r] === pin);
  if (!role) {
    // Limits PIN guessing against one venue from many addresses.
    if (!rateLimit(`pinfail:${venue.id}`, 30, 10 * 60_000)) fail(429, 'Πολλές λάθος προσπάθειες. Δοκιμάστε σε λίγα λεπτά.');
    fail(401, 'Λάθος PIN');
  }
  setSession(req, res, venue, role, member ? `s${member.id}` : 0);
  res.json({ role, venue: venue.slug, name: member?.name || '' });
}));

app.post('/api/staff/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'staff=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

function venueSummary(venue) {
  const plan = effectivePlan(venue);
  return {
    slug: venue.slug, name: venue.name, plan: planOf(venue), status: venue.status, trialEndsAt: venue.trial_ends_at,
    interval: venue.interval, effectivePlan: plan, features: features(venue), isDemo: venue.isDemo,
  };
}

app.get('/api/staff/me', wrap(async (req, res) => {
  const session = await staffSession(req);
  if (!session) return res.status(401).json({ error: 'Απαιτείται σύνδεση' });
  res.json({ role: session.role, owner: !!session.accountId, restaurant: session.venue.settings.restaurant?.name,
    venue: venueSummary(session.venue), member: session.member ? { name: session.member.name, zones: session.member.zones || [] } : null,
    stations: stationsOf(session.venue) });
}));

app.get('/api/staff/stream', requireStaff(), (req, res) => subscribe(staffChannel(req.venue), req, res));

app.get('/api/staff/overview', requireStaff(), wrap(async (req, res) => {
  const v = req.venue.id;
  const tables = (await db.all('SELECT * FROM tables WHERE venue_id = ? ORDER BY id', [v])).map(mapTable);
  const orders = await loadOrders(v, 'o.closed = 0');
  const paidBy = new Map((await db.all(`SELECT table_id, SUM(amount_cents) AS paid FROM payments
    WHERE venue_id = ? AND closed = 0 AND status = 'paid' GROUP BY table_id`, [v])).map((r) => [r.table_id, Number(r.paid)]));
  const calls = await loadCalls(v);
  const tableSummaries = tables.map((t) => {
    const mine = orders.filter((o) => o.tableId === t.id && o.status !== 'rejected');
    const total = mine.reduce((a, o) => a + o.total, 0);
    const paid = Math.min(paidBy.get(t.id) || 0, total);
    return { id: t.id, label: t.label, kind: t.kind, zone: t.zone, active: t.active, orders: mine.length, total, paid,
      calls: calls.filter((c) => c.tableId === t.id).map((c) => c.type) };
  });
  res.json({ role: req.role, requireApproval: req.venue.settings.requireApproval, tables: tableSummaries, orders, calls });
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
  const order = await loadOrder(req.venue.id, Number(req.params.id) || 0);
  if (!order) fail(404, 'Η παραγγελία δεν βρέθηκε');
  const next = String(req.body?.status);
  if (!TRANSITIONS[order.status]?.includes(next)) fail(409, 'Μη επιτρεπτή αλλαγή κατάστασης');
  if (req.role === 'kitchen' && (order.status === 'pending' || !KITCHEN_ALLOWED.has(next))) {
    fail(403, 'Δεν επιτρέπεται από την κουζίνα');
  }
  await db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [next, now(), order.id]);
  if (next === 'accepted' && order.status === 'pending') await startClock(req.venue, order.id);
  if (next === 'ready') await db.run('UPDATE order_items SET ready = 1 WHERE order_id = ?', [order.id]);
  if (next === 'preparing' || next === 'accepted') await db.run('UPDATE order_items SET ready = 0 WHERE order_id = ? AND ? = 1', [order.id, order.status === 'ready' ? 1 : 0]);
  res.json(await orderChanged(req.venue, order.id));
}));

async function orderChanged(venue, orderId) {
  const updated = await loadOrder(venue.id, orderId);
  emit(staffChannel(venue), 'order:update', updated);
  await notifyTable(updated.tableId);
  return updated;
}

// Estimated ready time: the slowest dish of the order (or the venue default), from when it reaches the kitchen.
async function startClock(venue, orderId) {
  const { m } = await db.get(`SELECT MAX(COALESCE(i.prep_minutes, 0)) AS m FROM order_items oi LEFT JOIN items i ON i.id = oi.item_id
    WHERE oi.order_id = ?`, [orderId]);
  const minutes = Number(m) || Number(venue.settings.defaultPrepMinutes) || 15;
  const ts = now();
  await db.run('UPDATE orders SET accepted_at = ?, eta_at = ? WHERE id = ?', [ts, new Date(Date.now() + minutes * 60_000).toISOString(), orderId]);
}

// A station (kitchen, bar…) marks its part of an order ready; the order is ready when every station is.
app.post('/api/staff/orders/:id/station-ready', requireStaff('kitchen'), wrap(async (req, res) => {
  const order = await loadOrder(req.venue.id, Number(req.params.id) || 0);
  if (!order) fail(404, 'Η παραγγελία δεν βρέθηκε');
  if (!['accepted', 'preparing'].includes(order.status)) fail(409, 'Μη επιτρεπτή αλλαγή κατάστασης');
  const station = String(req.body?.station || 'kitchen');
  await db.run('UPDATE order_items SET ready = 1 WHERE order_id = ? AND station = ?', [order.id, station]);
  const { left } = await db.get('SELECT COUNT(*) AS left FROM order_items WHERE order_id = ? AND ready = 0', [order.id]);
  const status = Number(left) === 0 ? 'ready' : 'preparing';
  await db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [status, now(), order.id]);
  res.json(await orderChanged(req.venue, order.id));
}));

// The kitchen can push the estimate back when it is busy.
app.post('/api/staff/orders/:id/eta', requireStaff('kitchen'), wrap(async (req, res) => {
  const order = await loadOrder(req.venue.id, Number(req.params.id) || 0);
  if (!order) fail(404, 'Η παραγγελία δεν βρέθηκε');
  const add = Math.min(Math.max(Math.trunc(Number(req.body?.add)) || 0, -60), 120);
  const base = Math.max(Date.now(), new Date(order.etaAt || Date.now()).getTime());
  await db.run('UPDATE orders SET eta_at = ? WHERE id = ?', [new Date(base + add * 60_000).toISOString(), order.id]);
  res.json(await orderChanged(req.venue, order.id));
}));

app.post('/api/staff/calls/:id/done', requireStaff('waiter'), wrap(async (req, res) => {
  const call = (await loadCalls(req.venue.id, 'c.id = ?', [Number(req.params.id) || 0]))[0];
  if (!call) fail(404, 'Δεν βρέθηκε');
  await db.run("UPDATE calls SET status = 'done' WHERE id = ?", [call.id]);
  emit(staffChannel(req.venue), 'call:done', { id: call.id });
  await notifyTable(call.tableId);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Receipts (bills). Stored permanently; NOT fiscal documents – the legal receipt comes from the cash register.
// ---------------------------------------------------------------------------
const PAYMENTS = ['cash', 'card', 'online', 'room'];

const mapReceipt = (r) => r && {
  id: r.id, number: r.number, token: r.token, tableId: r.table_id, tableLabel: r.table_label, tableKind: r.table_kind,
  orderIds: JSON.parse(r.order_ids || '[]'), lines: JSON.parse(r.lines || '[]'), total: r.total_cents,
  payment: r.payment, fiscalRef: r.fiscal_ref || '', lang: r.lang, createdAt: r.created_at, tip: Number(r.tip_cents) || 0,
};

// Merges identical dishes (same dish, options and price) from all of a spot's orders into bill lines.
function billLines(orders) {
  const lines = new Map();
  for (const o of orders) {
    for (const i of o.items) {
      const key = JSON.stringify([i.itemId, i.price, i.options, i.name.el]);
      const line = lines.get(key) || { name: i.name, options: i.options, qty: 0, unit_cents: i.price, total_cents: 0 };
      line.qty += i.qty;
      line.total_cents += i.qty * i.price;
      lines.set(key, line);
    }
  }
  return [...lines.values()];
}

async function issueReceipt(t, table, orders, { payment, fiscalRef, tip = 0, guestIds = [] }) {
  const year = new Date().getFullYear();
  const lang = orders.at(-1)?.lang || 'el';
  const lines = billLines(orders);
  const total = lines.reduce((sum, l) => sum + l.total_cents, 0);
  const { n } = await t.get('SELECT COUNT(*) AS n FROM receipts WHERE venue_id = ? AND number LIKE ?', [table.venue_id, `${year}-%`]);
  const number = `${year}-${String(Number(n) + 1).padStart(5, '0')}`;
  const id = await t.insert(`INSERT INTO receipts (venue_id, number, token, table_id, table_label, table_kind, order_ids, lines, total_cents, payment, fiscal_ref, lang, created_at, tip_cents, guest_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [table.venue_id, number, newToken(), table.id, table.label, table.kind,
    JSON.stringify(orders.map((o) => o.id)), JSON.stringify(lines), total, payment, fiscalRef, lang, now(), tip, JSON.stringify(guestIds)]);
  return mapReceipt(await t.get('SELECT * FROM receipts WHERE id = ?', [id]));
}

app.post('/api/staff/tables/:id/close', requireStaff('waiter'), wrap(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const v = req.venue.id;
  const table = mapTable(await db.get('SELECT * FROM tables WHERE id = ? AND venue_id = ?', [id, v]));
  if (!table) fail(404, 'Το τραπέζι δεν βρέθηκε');
  const orders = (await loadOrders(v, 'o.table_id = ? AND o.closed = 0', [id])).filter((o) => o.status !== 'rejected');
  const pays = await db.all("SELECT method, amount_cents, tip_cents FROM payments WHERE table_id = ? AND closed = 0 AND status = 'paid'", [id]);
  const total = orders.reduce((sum, o) => sum + o.total, 0);
  const paidOnPhone = pays.reduce((sum, p) => sum + p.amount_cents, 0);
  const fromPhone = orders.length && paidOnPhone >= total ? (pays.some((p) => p.method === 'room') ? 'room' : 'online') : null;
  const payment = PAYMENTS.includes(req.body?.paymentMethod) ? req.body.paymentMethod : fromPhone || 'cash';
  const tip = pays.reduce((sum, p) => sum + (p.tip_cents || 0), 0);
  const guestIds = [...new Set((await db.all("SELECT DISTINCT guest_id FROM orders WHERE table_id = ? AND closed = 0 AND guest_id != ''", [id])).map((r) => r.guest_id))];
  const fiscalRef = cleanText(req.body?.fiscalRef, 80);
  const receipt = await db.tx(async (t) => {
    const r = orders.length ? await issueReceipt(t, table, orders, { payment, fiscalRef, tip, guestIds }) : null;
    await t.run('UPDATE payments SET closed = 1 WHERE table_id = ? AND closed = 0', [id]);
    await t.run('UPDATE orders SET closed = 1, paid = 1, updated_at = ? WHERE table_id = ? AND closed = 0', [now(), id]);
    await t.run("UPDATE calls SET status = 'done' WHERE table_id = ? AND status = 'open'", [id]);
    return r;
  });
  emit(staffChannel(req.venue), 'table:closed', { tableId: id });
  // The guest gets a link to a digital copy of the bill.
  if (receipt) emit(`table:${v}:${id}`, 'receipt', { number: receipt.number, url: `/r/${receipt.token}` });
  await notifyTable(id);
  res.json({ ok: true, receipt });
}));

app.get('/api/staff/orders/:id', requireStaff(), wrap(async (req, res) => {
  const order = await loadOrder(req.venue.id, Number(req.params.id) || 0);
  if (!order) fail(404, 'Η παραγγελία δεν βρέθηκε');
  res.json({ order, restaurant: publicRestaurant(req.venue) });
}));

const receiptById = async (req) => mapReceipt(await db.get('SELECT * FROM receipts WHERE id = ? AND venue_id = ?',
  [Number(req.params.id) || 0, req.venue.id]));

app.get('/api/staff/receipts/:id', requireStaff('waiter'), wrap(async (req, res) => {
  const receipt = await receiptById(req);
  if (!receipt) fail(404, 'Η απόδειξη δεν βρέθηκε');
  res.json({ receipt, restaurant: publicRestaurant(req.venue) });
}));

app.put('/api/staff/receipts/:id', requireStaff('waiter'), wrap(async (req, res) => {
  const r = await db.run('UPDATE receipts SET fiscal_ref = ? WHERE id = ? AND venue_id = ?',
    [cleanText(req.body?.fiscalRef, 80), Number(req.params.id) || 0, req.venue.id]);
  if (!r.changes) fail(404, 'Η απόδειξη δεν βρέθηκε');
  res.json(await receiptById(req));
}));

// Guest's digital copy (link sent to their phone when the spot is closed).
app.get('/api/public/receipt/:token', wrap(async (req, res) => {
  const row = await db.get('SELECT * FROM receipts WHERE token = ?', [String(req.params.token)]);
  const venue = row && await getVenue(row.venue_id);
  if (!venue || venue.status === 'suspended') fail(404, 'not_found');
  const { token, orderIds, tableId, ...pub } = mapReceipt(row);
  res.json({ receipt: pub, restaurant: publicRestaurant(venue) });
}));

// Any staff member may mark an item as sold out / available again.
app.get('/api/staff/items', requireStaff(), wrap(async (req, res) => {
  res.json((await db.all('SELECT * FROM items WHERE venue_id = ? ORDER BY category_id, sort, id', [req.venue.id])).map(mapItem));
}));

app.post('/api/staff/items/:id/available', requireStaff(), wrap(async (req, res) => {
  const id = Number(req.params.id) || 0;
  await db.run('UPDATE items SET available = ? WHERE id = ? AND venue_id = ?', [req.body?.available ? 1 : 0, id, req.venue.id]);
  const item = mapItem(await db.get('SELECT * FROM items WHERE id = ? AND venue_id = ?', [id, req.venue.id]));
  if (!item) fail(404, 'Δεν βρέθηκε');
  emit(staffChannel(req.venue), 'menu:update', {});
  broadcastMenuUpdate(req.venue);
  res.json(item);
}));

function broadcastMenuUpdate(venue) {
  const prefix = `table:${venue.id}:`;
  for (const ch of channels.keys()) if (ch.startsWith(prefix)) emit(ch, 'menu', {});
}

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------
const admin = express.Router();
admin.use(requireStaff('admin'));

const adminSettings = async (req) => {
  const { secret, payments, ...s } = req.venue.settings;
  const { clientSecret, ...pay } = paymentSettings(req.venue);
  s.payments = { ...(payments || {}), ...pay, clientSecret: '', hasSecret: !!clientSecret, returnUrl: `${baseUrl(req)}/pay/viva/return` };
  delete s.payments.clientSecret;
  return { ...s, zones: await zonesOf(req.venue.id), defaultPrepMinutes: s.defaultPrepMinutes || 15, staff: s.staff || [], stations: stationsOf(req.venue), allLanguages: LANGS, database: db.dialect, venue: venueSummary(req.venue),
    staffUrl: `${baseUrl(req)}/staff?v=${req.venue.slug}`, demoPaymentsAllowed: canUseDemoPayments(req.venue) };
};

// The demo "online payment" marks bills as paid without taking money, so real venues cannot switch it on in production.
const canUseDemoPayments = (venue) => venue.isDemo || !PRODUCTION;
// Visitors of the public demo cannot upload files or lock others out by changing the PINs.
const demoGuard = (req) => { if (PRODUCTION && req.venue.isDemo) fail(403, 'Δεν επιτρέπεται στο demo. Δημιουργήστε δωρεάν λογαριασμό.'); };

admin.get('/settings', wrap(async (req, res) => res.json(await adminSettings(req))));

admin.put('/settings', wrap(async (req, res) => {
  const b = req.body || {};
  const v = req.venue.id;
  const cur = req.venue.settings;
  const set = (key, value) => setSetting(v, key, value);
  if (b.restaurant) {
    const r = b.restaurant;
    await set('restaurant', {
      ...cur.restaurant,
      name: cleanText(r.name, 80) || cur.restaurant.name,
      description: cleanI18n(r.description, 400),
      hours: cleanI18n(r.hours, 200),
      address: cleanText(r.address, 200), phone: cleanText(r.phone, 40), email: cleanText(r.email, 120),
      mapsUrl: cleanText(r.mapsUrl, 500), wifiName: cleanText(r.wifiName, 60), wifiPassword: cleanText(r.wifiPassword, 60),
      instagram: cleanText(r.instagram, 200), reviewUrl: cleanText(r.reviewUrl, 500), logoUrl: cleanText(r.logoUrl, 500), coverUrl: cleanText(r.coverUrl, 500),
      legalName: cleanText(r.legalName, 120), vatNumber: cleanText(r.vatNumber, 20), taxOffice: cleanText(r.taxOffice, 60),
      receiptFooter: cleanText(r.receiptFooter, 300),
    });
  }
  if (Array.isArray(b.languages)) {
    const langs = LANGS.filter((l) => b.languages.includes(l));
    if (!langs.length) fail(400, 'Επιλέξτε τουλάχιστον μία γλώσσα');
    await set('languages', langs);
    const def = langs.includes(b.defaultLanguage) ? b.defaultLanguage : langs[0];
    await set('defaultLanguage', def);
  }
  if (typeof b.requireApproval === 'boolean') await set('requireApproval', b.requireApproval);
  if (b.onlinePayments === 'off' || (b.onlinePayments === 'demo' && canUseDemoPayments(req.venue))) await set('onlinePayments', b.onlinePayments);
  if (typeof b.publicBaseUrl === 'string') await set('publicBaseUrl', cleanText(b.publicBaseUrl, 200));
  if (b.theme && typeof b.theme === 'object') await set('theme', cleanTheme(b.theme));
  if (b.happyHour && typeof b.happyHour === 'object') {
    const w = cleanWindow(b.happyHour) || { days: [], from: '', to: '' };
    await set('happyHour', { enabled: !!b.happyHour.enabled && !!(w.from && w.to), ...w, label: cleanI18n(b.happyHour.label, 40) });
  }
  if (b.announcement && typeof b.announcement === 'object') {
    await set('announcement', { active: !!b.announcement.active, text: cleanI18n(b.announcement.text, 200), itemId: Number(b.announcement.itemId) || null });
  }
  if (Array.isArray(b.stations)) {
    const seen = new Set();
    const stations = b.stations.slice(0, 8).map((x) => ({ id: cleanText(x?.id, 20).toLowerCase().replace(/[^a-z0-9_-]/g, ''), name: cleanText(x?.name, 30) }))
      .filter((x) => x.id && x.name && !seen.has(x.id) && seen.add(x.id));
    await set('stations', stations.length ? stations : DEFAULT_STATIONS);
  }
  if (typeof b.brandColor === 'string') {
    if (!/^#[0-9a-fA-F]{6}$/.test(b.brandColor)) fail(400, 'Μη έγκυρο χρώμα');
    await set('brandColor', b.brandColor.toLowerCase());
  }
  if (b.payments && typeof b.payments === 'object') {
    const p = b.payments;
    const prev = cur.payments || {};
    const provider = ['off', 'viva'].includes(p.provider) || (p.provider === 'demo' && canUseDemoPayments(req.venue)) ? p.provider : 'off';
    await set('payments', {
      provider, environment: p.environment === 'live' ? 'live' : 'demo',
      clientId: cleanText(p.clientId ?? prev.clientId, 200), sourceCode: cleanText(p.sourceCode ?? prev.sourceCode, 20),
      // The secret is write-only: an empty field keeps the stored one.
      clientSecret: p.clientSecret ? cleanText(p.clientSecret, 200) : prev.clientSecret || '',
      tips: [...new Set((Array.isArray(p.tips) ? p.tips : [0, 5, 10, 15]).map(Number).filter((x) => x >= 0 && x <= 30))].slice(0, 5).sort((a, c) => a - c),
      roomCharge: !!p.roomCharge,
    });
  }
  if (Array.isArray(b.staff)) {
    demoGuard(req);
    const zones = await zonesOf(v);
    const members = b.staff.slice(0, 50).map((m) => ({
      id: /^[a-z0-9]{4,12}$/.test(m?.id || '') ? m.id : randomBytes(4).toString('hex'),
      name: cleanText(m?.name, 40), role: ROLES.includes(m?.role) ? m.role : 'waiter', pin: String(m?.pin ?? ''),
      zones: cleanZones(m?.zones).filter((z) => zones.includes(z)),
    })).filter((m) => m.name);
    const rolePins = { ...cur.pins, ...Object.fromEntries(Object.entries(b.pins || {}).filter(([, p]) => p)) };
    const all = [...members.map((m) => m.pin), ...Object.values(rolePins)];
    if (members.some((m) => !/^\d{4,8}$/.test(m.pin))) fail(400, 'Τα PIN πρέπει να έχουν 4-8 ψηφία');
    if (new Set(all).size !== all.length) fail(400, 'Κάθε άτομο χρειάζεται διαφορετικό PIN');
    await set('staff', members);
  }
  if (typeof b.defaultPrepMinutes !== 'undefined') await set('defaultPrepMinutes', Math.min(Math.max(Math.trunc(Number(b.defaultPrepMinutes)) || 15, 1), 180));
  if (b.pins && ROLES.some((r) => b.pins[r] && b.pins[r] !== cur.pins?.[r])) {
    demoGuard(req);
    const pins = { ...cur.pins };
    for (const r of ROLES) {
      if (b.pins[r] == null || b.pins[r] === '') continue;
      const p = String(b.pins[r]);
      if (!/^\d{4,8}$/.test(p)) fail(400, 'Τα PIN πρέπει να έχουν 4-8 ψηφία');
      pins[r] = p;
    }
    if (new Set(Object.values(pins)).size !== ROLES.length) fail(400, 'Κάθε ρόλος χρειάζεται διαφορετικό PIN');
    await set('pins', pins);
  }
  req.venue = await getVenue(v);
  broadcastMenuUpdate(req.venue);
  res.json(await adminSettings(req));
}));

admin.get('/menu', wrap(async (req, res) => {
  const v = req.venue.id;
  res.json({
    categories: (await db.all('SELECT * FROM categories WHERE venue_id = ? ORDER BY sort, id', [v])).map(mapCategory),
    items: (await db.all('SELECT * FROM items WHERE venue_id = ? ORDER BY sort, id', [v])).map(mapItem),
    allergens: ALLERGENS, tags: TAGS, stations: stationsOf(req.venue), zones: await zonesOf(v),
  });
}));

function categoryInput(b, venue) {
  const name = cleanI18n(b.name, 80);
  if (!name.el && !name.en) fail(400, 'Δώστε όνομα κατηγορίας (τουλάχιστον στα Ελληνικά)');
  const stations = stationsOf(venue).map((x) => x.id);
  const schedule = cleanWindow(b.schedule);
  const zones = cleanZones(b.zones);
  return {
    name: JSON.stringify(name), icon: cleanText(b.icon, 8), active: b.active === false ? 0 : 1,
    station: stations.includes(b.station) ? b.station : 'kitchen',
    schedule: schedule ? JSON.stringify(schedule) : '', zones: zones.length ? JSON.stringify(zones) : '',
  };
}

// Prep stations (kitchen, bar, …): each has its own screen and printer.
const DEFAULT_STATIONS = [{ id: 'kitchen', name: 'Κουζίνα' }, { id: 'bar', name: 'Μπαρ' }];
const stationsOf = (venue) => (Array.isArray(venue.settings.stations) && venue.settings.stations.length ? venue.settings.stations : DEFAULT_STATIONS);

admin.post('/categories', wrap(async (req, res) => {
  const c = categoryInput(req.body || {}, req.venue);
  const v = req.venue.id;
  const { s: sort } = await db.get('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM categories WHERE venue_id = ?', [v]);
  const id = await db.insert('INSERT INTO categories (venue_id, name, icon, active, sort, station, schedule, zones) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [v, c.name, c.icon, c.active, sort, c.station, c.schedule, c.zones]);
  broadcastMenuUpdate(req.venue);
  res.status(201).json(mapCategory(await db.get('SELECT * FROM categories WHERE id = ?', [id])));
}));

admin.put('/categories/:id', wrap(async (req, res) => {
  const c = categoryInput(req.body || {}, req.venue);
  const r = await db.run('UPDATE categories SET name = ?, icon = ?, active = ?, station = ?, schedule = ?, zones = ? WHERE id = ? AND venue_id = ?',
    [c.name, c.icon, c.active, c.station, c.schedule, c.zones, Number(req.params.id) || 0, req.venue.id]);
  if (!r.changes) fail(404, 'Δεν βρέθηκε');
  broadcastMenuUpdate(req.venue);
  res.json(mapCategory(await db.get('SELECT * FROM categories WHERE id = ?', [Number(req.params.id)])));
}));

admin.delete('/categories/:id', wrap(async (req, res) => {
  await db.run('DELETE FROM categories WHERE id = ? AND venue_id = ?', [Number(req.params.id) || 0, req.venue.id]);
  broadcastMenuUpdate(req.venue);
  res.json({ ok: true });
}));

admin.post('/reorder', wrap(async (req, res) => {
  const { kind, ids } = req.body || {};
  const table = kind === 'categories' ? 'categories' : kind === 'items' ? 'items' : fail(400, 'bad kind');
  if (!Array.isArray(ids)) fail(400, 'bad ids');
  await db.tx(async (t) => {
    for (const [i, id] of ids.entries()) await t.run(`UPDATE ${table} SET sort = ? WHERE id = ? AND venue_id = ?`, [i, Number(id) || 0, req.venue.id]);
  });
  broadcastMenuUpdate(req.venue);
  res.json({ ok: true });
}));

const optionalCents = (v) => {
  if (v === '' || v == null) return null;
  const c = Math.round(Number(v) * 100);
  return c >= 0 && c <= 1_000_000 ? c : null;
};

async function itemInput(req) {
  const b = req.body || {};
  const name = cleanI18n(b.name, 100);
  if (!name.el && !name.en) fail(400, 'Δώστε όνομα πιάτου (τουλάχιστον στα Ελληνικά)');
  const price = Math.round(Number(b.price) * 100);
  if (!(price >= 0 && price <= 1_000_000)) fail(400, 'Μη έγκυρη τιμή');
  const cat = await db.get('SELECT id FROM categories WHERE id = ? AND venue_id = ?', [Number(b.categoryId) || 0, req.venue.id]);
  if (!cat) fail(400, 'Επιλέξτε κατηγορία');
  return {
    category_id: cat.id, name: JSON.stringify(name), description: JSON.stringify(cleanI18n(b.description, 400)),
    price_cents: price,
    allergens: JSON.stringify(ALLERGENS.filter((a) => (b.allergens || []).includes(a))),
    tags: JSON.stringify(TAGS.filter((a) => (b.tags || []).includes(a))),
    emoji: cleanText(b.emoji, 8), image_url: cleanText(b.imageUrl, 500), available: b.available === false ? 0 : 1,
    options: JSON.stringify(cleanOptions(b.options)),
    happy_price_cents: optionalCents(b.happyPrice),
    stock: b.stock === '' || b.stock == null ? null : Math.min(Math.max(Math.trunc(Number(b.stock)) || 0, 0), 100_000),
    prep_minutes: Math.min(Math.max(Math.trunc(Number(b.prepMinutes)) || 0, 0), 240),
    premium: b.premium ? 1 : 0,
  };
}

admin.post('/items', wrap(async (req, res) => {
  const i = await itemInput(req);
  const v = req.venue.id;
  const { s: sort } = await db.get('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM items WHERE venue_id = ?', [v]);
  const id = await db.insert(`INSERT INTO items (venue_id, category_id, name, description, price_cents, allergens, tags, emoji, image_url, available, sort, options,
    happy_price_cents, stock, prep_minutes, premium)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [v, i.category_id, i.name, i.description, i.price_cents, i.allergens, i.tags,
    i.emoji, i.image_url, i.available && i.stock !== 0 ? 1 : 0, sort, i.options, i.happy_price_cents, i.stock, i.prep_minutes, i.premium]);
  broadcastMenuUpdate(req.venue);
  res.status(201).json(mapItem(await db.get('SELECT * FROM items WHERE id = ?', [id])));
}));

admin.put('/items/:id', wrap(async (req, res) => {
  const i = await itemInput(req);
  const r = await db.run(`UPDATE items SET category_id = ?, name = ?, description = ?, price_cents = ?, allergens = ?, tags = ?,
    emoji = ?, image_url = ?, available = ?, options = ?, happy_price_cents = ?, stock = ?, prep_minutes = ?, premium = ?
    WHERE id = ? AND venue_id = ?`, [i.category_id, i.name, i.description, i.price_cents,
    i.allergens, i.tags, i.emoji, i.image_url, i.available && i.stock !== 0 ? 1 : 0, i.options, i.happy_price_cents, i.stock, i.prep_minutes, i.premium,
    Number(req.params.id) || 0, req.venue.id]);
  if (!r.changes) fail(404, 'Δεν βρέθηκε');
  broadcastMenuUpdate(req.venue);
  res.json(mapItem(await db.get('SELECT * FROM items WHERE id = ?', [Number(req.params.id)])));
}));

admin.delete('/items/:id', wrap(async (req, res) => {
  await db.run('DELETE FROM items WHERE id = ? AND venue_id = ?', [Number(req.params.id) || 0, req.venue.id]);
  broadcastMenuUpdate(req.venue);
  res.json({ ok: true });
}));

// Images are stored in the database, so the service can run on hosting without a persistent disk.
admin.post('/upload', wrap(async (req, res) => {
  demoGuard(req);
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.dataUrl || ''));
  if (!m) fail(400, 'Υποστηρίζονται εικόνες PNG, JPG, WEBP, GIF');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) fail(400, 'Η εικόνα ξεπερνά τα 4MB');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const name = `${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;
  await db.insert('INSERT INTO uploads (venue_id, name, mime, data, created_at) VALUES (?, ?, ?, ?, ?)',
    [req.venue.id, name, `image/${ext === 'jpg' ? 'jpeg' : ext}`, buf, now()]);
  res.json({ url: `/uploads/${name}` });
}));

admin.get('/tables', wrap(async (req, res) => {
  const base = baseUrl(req);
  res.json((await db.all('SELECT * FROM tables WHERE venue_id = ? ORDER BY id', [req.venue.id])).map(mapTable)
    .map(({ venue_id, ...t }) => ({ ...t, url: `${base}/t/${t.token}` })));
}));

const zonesOf = async (venueId) => (await db.all("SELECT DISTINCT zone FROM tables WHERE venue_id = ? AND zone != '' ORDER BY zone", [venueId]))
  .map((r) => r.zone);

admin.post('/tables', wrap(async (req, res) => {
  const b = req.body || {};
  const v = req.venue.id;
  const count = Math.min(Math.max(Math.trunc(Number(b.count) || 1), 1), 100);
  const kind = SPOT_KINDS.includes(b.kind) ? b.kind : 'table';
  const plan = PLANS[planOf(req.venue)];
  const ins = 'INSERT INTO tables (venue_id, label, token, kind) VALUES (?, ?, ?, ?)';
  await db.tx(async (t) => {
    const { total } = await t.get('SELECT COUNT(*) AS total FROM tables WHERE venue_id = ?', [v]);
    if (plan.maxSpots != null && Number(total) + count > plan.maxSpots) {
      planLimit(`Το ${plan.name} περιλαμβάνει έως ${plan.maxSpots} θέσεις με QR. Για περισσότερες περάστε στο ${PLANS.plus.name} από το «Συνδρομή».`);
    }
    if (count === 1 && cleanText(b.label, 20)) return t.insert(ins, [v, cleanText(b.label, 20), newToken(), kind]);
    const { n } = await t.get('SELECT COUNT(*) AS n FROM tables WHERE venue_id = ? AND kind = ?', [v, kind]);
    for (let i = 1; i <= count; i++) await t.insert(ins, [v, String(Number(n) + i), newToken(), kind]);
  });
  res.status(201).json({ ok: true });
}));

admin.put('/tables/:id', wrap(async (req, res) => {
  const label = cleanText(req.body?.label, 20);
  if (!label) fail(400, 'Δώστε όνομα τραπεζιού');
  const kind = SPOT_KINDS.includes(req.body?.kind) ? req.body.kind : 'table';
  const cur = await db.get('SELECT kind FROM tables WHERE id = ? AND venue_id = ?', [Number(req.params.id) || 0, req.venue.id]);
  if (!cur) fail(404, 'Δεν βρέθηκε');
  const zone = cleanZones([req.body?.zone])[0] || '';
  await db.run('UPDATE tables SET label = ?, active = ?, kind = ?, zone = ?, all_inclusive = ? WHERE id = ? AND venue_id = ?',
    [label, req.body?.active === false ? 0 : 1, kind, zone, req.body?.allInclusive ? 1 : 0, Number(req.params.id), req.venue.id]);
  res.json({ ok: true });
}));

// Set the zone / all-inclusive flag of many spots at once (e.g. all sunbeds → "Παραλία").
admin.post('/tables/bulk', wrap(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 500);
  if (!ids.length) fail(400, 'Επιλέξτε θέσεις');
  const sets = [];
  const params = [];
  if (typeof req.body.zone === 'string') { sets.push('zone = ?'); params.push(cleanZones([req.body.zone])[0] || ''); }
  if (typeof req.body.allInclusive === 'boolean') { sets.push('all_inclusive = ?'); params.push(req.body.allInclusive ? 1 : 0); }
  if (!sets.length) fail(400, 'Τίποτα για αλλαγή');
  await db.run(`UPDATE tables SET ${sets.join(', ')} WHERE venue_id = ? AND id IN (${ids.map(() => '?').join(',')})`, [...params, req.venue.id, ...ids]);
  res.json({ ok: true });
}));

admin.post('/tables/:id/regenerate', wrap(async (req, res) => {
  await db.run('UPDATE tables SET token = ? WHERE id = ? AND venue_id = ?', [newToken(), Number(req.params.id) || 0, req.venue.id]);
  res.json({ ok: true });
}));

admin.delete('/tables/:id', wrap(async (req, res) => {
  await db.run('DELETE FROM tables WHERE id = ? AND venue_id = ?', [Number(req.params.id) || 0, req.venue.id]);
  res.json({ ok: true });
}));

// QR codes. ?ecl=H gives the extra redundancy needed when a logo is printed in the middle.
async function qrTable(req) {
  const t = await db.get('SELECT * FROM tables WHERE id = ? AND venue_id = ?', [Number(req.params.id) || 0, req.venue.id]);
  if (!t) fail(404, 'Δεν βρέθηκε');
  const errorCorrectionLevel = req.query.ecl === 'H' ? 'H' : 'M';
  return { t, url: `${baseUrl(req)}/t/${t.token}`, errorCorrectionLevel };
}

admin.get('/tables/:id/qr.svg', wrap(async (req, res) => {
  const { url, errorCorrectionLevel } = await qrTable(req);
  res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel }));
}));

admin.get('/tables/:id/qr.png', wrap(async (req, res) => {
  const { t, url, errorCorrectionLevel } = await qrTable(req);
  const png = await QRCode.toBuffer(url, { type: 'png', width: 1200, margin: 2, errorCorrectionLevel });
  const kind = { table: 'trapezi', room: 'domatio', sunbed: 'xaplostra' }[t.kind] || 'thesi';
  res.setHeader('Content-Disposition', `attachment; filename="qr-${kind}-${String(t.label).replace(/[^\w-]+/g, '_')}.png"`);
  res.type('image/png').send(png);
}));

admin.get('/stats', wrap(async (req, res) => {
  const days = Math.min(Math.max(Math.trunc(Number(req.query.days) || 1), 1), 365);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const since = start.toISOString();
  const v = req.venue.id;
  const agg = await db.get(`SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents), 0) AS revenue
    FROM orders WHERE venue_id = ? AND created_at >= ? AND status != 'rejected'`, [v, since]);
  agg.orders = Number(agg.orders);
  agg.revenue = Number(agg.revenue);
  const top = (await db.all(`SELECT oi.item_id, MIN(oi.name) AS name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.price_cents) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.venue_id = ? AND o.created_at >= ? AND o.status != 'rejected'
    GROUP BY oi.item_id ORDER BY qty DESC LIMIT 8`, [v, since]))
    .map((r) => ({ ...r, qty: Number(r.qty), revenue: Number(r.revenue), name: JSON.parse(r.name) }));
  const langs = (await db.all(`SELECT lang, COUNT(*) AS n FROM orders WHERE venue_id = ? AND created_at >= ? AND status != 'rejected'
    GROUP BY lang ORDER BY n DESC`, [v, since])).map((r) => ({ ...r, n: Number(r.n) }));
  const byDay = (await db.all(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS orders, SUM(total_cents) AS revenue
    FROM orders WHERE venue_id = ? AND created_at >= ? AND status != 'rejected' GROUP BY substr(created_at, 1, 10) ORDER BY day`, [v, since]))
    .map((r) => ({ ...r, orders: Number(r.orders), revenue: Number(r.revenue) }));
  const { n: rejected } = await db.get("SELECT COUNT(*) AS n FROM orders WHERE venue_id = ? AND created_at >= ? AND status = 'rejected'", [v, since]);
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

async function historyQuery(req) {
  const q = req.query;
  const { from, to } = dateRange(q);
  const where = ['o.created_at >= ?', 'o.created_at < ?'];
  const params = [from, to];
  if (STATUS_EL[q.status]) { where.push('o.status = ?'); params.push(q.status); }
  return loadOrders(req.venue.id, where.join(' AND '), params, { order: 'o.id DESC', limit: 2000 });
}

admin.get('/orders', wrap(async (req, res) => {
  const orders = await historyQuery(req);
  const counted = orders.filter((o) => o.status !== 'rejected');
  res.json({
    orders,
    summary: { count: counted.length, revenue: counted.reduce((s, o) => s + o.total, 0), rejected: orders.length - counted.length },
  });
}));

admin.get('/orders.csv', wrap(async (req, res) => {
  const orders = await historyQuery(req);
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const money = (c) => (c / 100).toFixed(2).replace('.', ',');
  const rows = [['Αριθμός', 'Ημερομηνία', 'Ώρα', 'Θέση', 'Κατάσταση', 'Γλώσσα', 'Πιάτα', 'Σημείωση', 'Σύνολο (€)', 'Εξοφλήθηκε']];
  for (const o of [...orders].reverse()) {
    const d = new Date(o.createdAt);
    rows.push([o.id, d.toLocaleDateString('el-GR'), d.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }),
      `${KIND_EL[o.tableKind] || ''} ${o.tableLabel}`, STATUS_EL[o.status] || o.status, o.lang.toUpperCase(),
      o.items.map((i) => `${i.qty}x ${i.name.el || i.name.en || ''}${i.options.length ? ` (${i.options.map((x) => x.choice.el || x.choice.en).join(', ')})` : ''}`).join(', '), o.note, money(o.total), o.paid ? 'Ναι' : 'Όχι']);
  }
  // Semicolons + BOM so Excel in Greek locale opens it with correct columns and characters.
  const csv = `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
  const { from, to } = dateRange(req.query);
  res.setHeader('Content-Disposition', `attachment; filename="paraggelies_${from.slice(0, 10)}_${to.slice(0, 10)}.csv"`);
  res.type('text/csv; charset=utf-8').send(csv);
}));

admin.get('/receipts', wrap(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const receipts = (await db.all('SELECT * FROM receipts WHERE venue_id = ? AND created_at >= ? AND created_at < ? ORDER BY id DESC LIMIT 2000',
    [req.venue.id, from, to]))
    .map(mapReceipt);
  const byPayment = Object.fromEntries(PAYMENTS.map((p) => [p, receipts.filter((r) => r.payment === p).reduce((s, r) => s + r.total, 0)]));
  res.json({ receipts, summary: { count: receipts.length, total: receipts.reduce((s, r) => s + r.total, 0), byPayment } });
}));

admin.get('/receipts.csv', wrap(async (req, res) => {
  const { from, to } = dateRange(req.query);
  const receipts = (await db.all('SELECT * FROM receipts WHERE venue_id = ? AND created_at >= ? AND created_at < ? ORDER BY id',
    [req.venue.id, from, to])).map(mapReceipt);
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const PAY_EL = { cash: 'Μετρητά', card: 'Κάρτα', online: 'Online', room: 'Χρέωση δωματίου' };
  const rows = [['Αριθμός', 'Ημερομηνία', 'Ώρα', 'Θέση', 'Τρόπος πληρωμής', 'Αρ. απόδειξης ταμειακής / ΜΑΡΚ', 'Σύνολο (€)']];
  for (const r of receipts) {
    const d = new Date(r.createdAt);
    rows.push([r.number, d.toLocaleDateString('el-GR'), d.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }),
      `${KIND_EL[r.tableKind] || ''} ${r.tableLabel}`, PAY_EL[r.payment] || r.payment, r.fiscalRef, (r.total / 100).toFixed(2).replace('.', ',')]);
  }
  res.setHeader('Content-Disposition', `attachment; filename="apodeixeis_${from.slice(0, 10)}_${to.slice(0, 10)}.csv"`);
  res.type('text/csv; charset=utf-8').send(`\uFEFF${rows.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`);
}));

app.use('/api/admin', admin);

// ---------------------------------------------------------------------------
// Owner accounts: online sign-up, login, password reset
// ---------------------------------------------------------------------------
const cleanEmail = (v) => cleanText(v, 120).toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const appBase = (req) => APP_URL || `${req.protocol}://${req.get('host')}`;
const isUnique = (e) => /unique|duplicate/i.test(e?.message || '');

app.post('/api/account/signup', wrap(async (req, res) => {
  if (!rateLimit(`signup:${req.ip}`, 10, 3600_000)) fail(429, 'Πολλές εγγραφές από αυτή τη σύνδεση. Δοκιμάστε αργότερα.');
  const b = req.body || {};
  const business = cleanText(b.business, 80);
  if (!business) fail(400, 'Δώστε το όνομα του καταστήματος');
  const email = cleanEmail(b.email);
  if (!EMAIL_RE.test(email)) fail(400, 'Μη έγκυρο e-mail');
  const password = String(b.password || '');
  if (password.length < 8) fail(400, 'Ο κωδικός χρειάζεται τουλάχιστον 8 χαρακτήρες');
  if (!b.acceptTerms) fail(400, 'Χρειάζεται να αποδεχτείτε τους όρους χρήσης');
  const interval = b.interval === 'year' ? 'year' : 'month';
  const count = (v, max) => Math.min(Math.max(Math.trunc(Number(v) || 0), 0), max);
  const spots = { table: count(b.tables ?? 10, 100), room: count(b.rooms, 300), sunbed: count(b.sunbeds, 300) };
  // The plan follows the size of the venue: more than 50 spots need Kalimenu Plus.
  const needed = planForSpots(spots.table + spots.room + spots.sunbed);
  const plan = needed === 'plus' || b.plan === 'plus' ? 'plus' : 'pro';
  const f = PLANS[plan];
  if (await db.get('SELECT id FROM accounts WHERE email = ?', [email])) fail(409, 'Υπάρχει ήδη λογαριασμός με αυτό το e-mail. Συνδεθείτε.');

  const hash = await hashPassword(password);
  let venueId;
  try {
    venueId = await db.tx(async (t) => {
      const id = await createVenue(t, {
        name: business, plan, interval, status: 'trialing',
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400_000).toISOString(),
        sample: b.sample !== false, spots,
      });
      await t.insert(`INSERT INTO accounts (venue_id, email, password_hash, terms_version, terms_accepted_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`, [id, email, hash, TERMS_VERSION, now(), now()]);
      return id;
    });
  } catch (e) {
    if (isUnique(e)) fail(409, 'Υπάρχει ήδη λογαριασμός με αυτό το e-mail. Συνδεθείτε.');
    throw e;
  }
  const venue = await getVenue(venueId);
  const account = await db.get('SELECT id FROM accounts WHERE email = ?', [email]);
  setSession(req, res, venue, 'admin', account.id);

  const base = appBase(req);
  sendMail({
    to: email,
    subject: `Καλώς ήρθατε στο Kalimenu – ${business}`,
    text: `Ο λογαριασμός σας είναι έτοιμος.\n\nΔιαχείριση: ${base}/login\n`
      + `Σύνδεση προσωπικού (σερβιτόροι, κουζίνα): ${base}/staff?v=${venue.slug}\n`
      + `\nΗ δωρεάν δοκιμή του πλάνου «${f.name}» διαρκεί ${TRIAL_DAYS} ημέρες, χωρίς κάρτα.\n`
      + '\nΤα PIN του προσωπικού θα τα βρείτε στη Διαχείριση → Ρυθμίσεις.\n',
  });
  if (process.env.NOTIFY_EMAIL) {
    sendMail({ to: process.env.NOTIFY_EMAIL, subject: `Νέα εγγραφή: ${business}`,
      text: `${business}\n${email}\nΠλάνο: ${f.name} (${interval === 'year' ? 'ετήσιο' : 'μηνιαίο'})\nΘέσεις: ${JSON.stringify(spots)}` });
  }
  res.status(201).json({ ok: true, venue: venueSummary(venue), next: '/staff/admin?welcome=1' });
}));

app.post('/api/account/login', wrap(async (req, res) => {
  if (!rateLimit(`owner-login:${req.ip}`, 10, 60_000)) fail(429, 'Πολλές προσπάθειες. Δοκιμάστε σε ένα λεπτό.');
  const account = await db.get('SELECT * FROM accounts WHERE email = ?', [cleanEmail(req.body?.email)]);
  // Same work and answer whether or not the e-mail exists.
  const ok = await checkPassword(req.body?.password, account?.password_hash || 'scrypt$x$x');
  const venue = ok && await getVenue(account.venue_id);
  if (!venue) fail(401, 'Λάθος e-mail ή κωδικός');
  if (venue.status === 'suspended') fail(403, 'Ο λογαριασμός έχει ανασταλεί. Επικοινωνήστε μαζί μας.');
  setSession(req, res, venue, 'admin', account.id);
  res.json({ ok: true, next: '/staff/admin' });
}));

app.post('/api/account/forgot', wrap(async (req, res) => {
  if (!rateLimit(`forgot:${req.ip}`, 5, 3600_000)) fail(429, 'Πολλές προσπάθειες. Δοκιμάστε αργότερα.');
  const account = await db.get('SELECT id, email FROM accounts WHERE email = ?', [cleanEmail(req.body?.email)]);
  if (account) await sendResetLink(req, account);
  res.json({ ok: true });
}));

async function sendResetLink(req, account, hours = 1) {
  const token = randomBytes(24).toString('base64url');
  await db.run('UPDATE accounts SET reset_hash = ?, reset_expires = ? WHERE id = ?',
    [sha256(token), new Date(Date.now() + hours * 3600_000).toISOString(), account.id]);
  const link = `${appBase(req)}/reset?token=${token}`;
  sendMail({ to: account.email, subject: 'Kalimenu – νέος κωδικός',
    text: `Για να ορίσετε νέο κωδικό ανοίξτε τον σύνδεσμο (ισχύει ${hours === 1 ? '1 ώρα' : `${hours} ώρες`}):\n${link}\n\nΑν δεν το ζητήσατε εσείς, αγνοήστε αυτό το μήνυμα.` });
  return link;
}

app.post('/api/account/reset', wrap(async (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (password.length < 8) fail(400, 'Ο κωδικός χρειάζεται τουλάχιστον 8 χαρακτήρες');
  const account = token && await db.get('SELECT * FROM accounts WHERE reset_hash = ?', [sha256(token)]);
  if (!account || !(account.reset_expires > now())) fail(400, 'Ο σύνδεσμος έληξε. Ζητήστε νέο.');
  await db.run("UPDATE accounts SET password_hash = ?, reset_hash = '', reset_expires = '' WHERE id = ?", [await hashPassword(password), account.id]);
  const venue = await getVenue(account.venue_id);
  setSession(req, res, venue, 'admin', account.id);
  res.json({ ok: true, next: '/staff/admin' });
}));

// ---------------------------------------------------------------------------
// Subscription (owner only)
// ---------------------------------------------------------------------------
app.get('/api/account', ...requireOwner, wrap(async (req, res) => {
  const v = req.venue.id;
  const account = await db.get('SELECT email FROM accounts WHERE id = ?', [req.accountId]);
  const { items } = await db.get('SELECT COUNT(*) AS items FROM items WHERE venue_id = ?', [v]);
  const { spots } = await db.get('SELECT COUNT(*) AS spots FROM tables WHERE venue_id = ?', [v]);
  res.json({
    email: account?.email, venue: venueSummary(req.venue), plans: PLANS, trialDays: TRIAL_DAYS,
    usage: { items: Number(items), spots: Number(spots) },
    billing: { stripe: stripeEnabled(), demo: !stripeEnabled() && !PRODUCTION, customer: !!req.venue.stripeCustomerId,
      subscription: !!req.venue.stripeSubscriptionId },
  });
}));

// Stripe products have fixed ids (kalimenu_basic, kalimenu_pro, kalimenu_hotel) and are created on first use.
const products = new Set();
async function ensureProduct(plan) {
  const id = `kalimenu_${plan}`;
  if (products.has(id)) return id;
  try { await stripe(`products/${id}`, null, 'GET'); } catch {
    await stripe('products', { id, name: PLANS[plan].name }).catch((e) => { if (!/already exists/i.test(e.message)) throw e; });
  }
  products.add(id);
  return id;
}

app.post('/api/account/checkout', ...requireOwner, wrap(async (req, res) => {
  const plan = PAID_PLANS.includes(req.body?.plan) ? req.body.plan : fail(400, 'Επιλέξτε πλάνο');
  const interval = req.body?.interval === 'year' ? 'year' : 'month';
  const venue = req.venue;
  const maxSpots = PLANS[plan].maxSpots;
  if (maxSpots != null) {
    const { n } = await db.get('SELECT COUNT(*) AS n FROM tables WHERE venue_id = ?', [venue.id]);
    if (Number(n) > maxSpots) fail(400, `Έχετε ${n} θέσεις με QR. Το ${PLANS[plan].name} περιλαμβάνει έως ${maxSpots}· επιλέξτε ${PLANS.plus.name}.`);
  }
  if (!stripeEnabled()) {
    if (PRODUCTION) fail(503, 'Οι online πληρωμές δεν έχουν ενεργοποιηθεί ακόμα. Επικοινωνήστε μαζί μας.');
    // Local testing without Stripe: the plan is activated straight away.
    await updateVenue(venue.id, { plan, interval, status: 'active' });
    return res.json({ demo: true });
  }
  const priceData = { currency: 'eur', unit_amount: priceCents(plan, interval), recurring: { interval },
    product: await ensureProduct(plan), tax_behavior: 'exclusive' };
  const metadata = { venue_id: String(venue.id), plan, interval };

  // Already subscribed: switch the plan on the same subscription (Stripe prorates the difference).
  if (venue.stripeSubscriptionId && ['active', 'past_due'].includes(venue.status)) {
    const sub = await stripe(`subscriptions/${venue.stripeSubscriptionId}`, null, 'GET');
    await stripe(`subscriptions/${sub.id}`, {
      items: [{ id: sub.items.data[0].id, price_data: priceData }], proration_behavior: 'create_prorations', metadata,
    });
    await updateVenue(venue.id, { plan, interval });
    return res.json({ updated: true });
  }

  const account = await db.get('SELECT email FROM accounts WHERE id = ?', [req.accountId]);
  const base = appBase(req);
  // During the free trial the card is saved now and the first charge happens when the trial ends.
  const trialLeft = venue.status === 'trialing' ? new Date(venue.trial_ends_at).getTime() - Date.now() : 0;
  const session = await stripe('checkout/sessions', {
    mode: 'subscription',
    ...(venue.stripeCustomerId
      ? { customer: venue.stripeCustomerId, customer_update: { address: 'auto', name: 'auto' } }
      : { customer_email: account?.email }),
    client_reference_id: String(venue.id),
    line_items: [{ quantity: 1, price_data: priceData }],
    subscription_data: { metadata, ...(trialLeft > 48 * 3600_000 ? { trial_end: Math.floor((Date.now() + trialLeft) / 1000) } : {}) },
    metadata,
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    allow_promotion_codes: true,
    ...(process.env.STRIPE_AUTOMATIC_TAX === '1' ? { automatic_tax: { enabled: true } } : {}),
    locale: 'el',
    success_url: `${base}/staff/admin?tab=billing&checkout=success`,
    cancel_url: `${base}/staff/admin?tab=billing`,
  });
  res.json({ url: session.url });
}));

// Stripe customer portal: card, invoices, cancellation.
app.post('/api/account/portal', ...requireOwner, wrap(async (req, res) => {
  if (!stripeEnabled() || !req.venue.stripeCustomerId) fail(400, 'Δεν υπάρχει ακόμα συνδρομή με κάρτα');
  const session = await stripe('billing_portal/sessions', { customer: req.venue.stripeCustomerId,
    return_url: `${appBase(req)}/staff/admin?tab=billing` });
  res.json({ url: session.url });
}));

// Seasonal pause: no charges and no menu for guests while paused; everything is kept for the next season.
app.post('/api/account/pause', ...requireOwner, wrap(async (req, res) => {
  const venue = req.venue;
  const paused = !!req.body?.paused;
  if (paused && !['active', 'past_due'].includes(venue.status)) fail(400, 'Δεν υπάρχει ενεργή συνδρομή για πάγωμα');
  if (!paused && venue.status !== 'paused') fail(400, 'Η συνδρομή δεν είναι σε πάγωμα');
  if (venue.stripeSubscriptionId && stripeEnabled()) {
    await stripe(`subscriptions/${venue.stripeSubscriptionId}`, { pause_collection: paused ? { behavior: 'void' } : '' });
  }
  await updateVenue(venue.id, { status: paused ? 'paused' : 'active' });
  res.json({ ok: true, venue: venueSummary(await getVenue(venue.id)) });
}));

// Data export (GDPR portability): everything stored for the venue, as JSON.
app.get('/api/account/export', ...requireOwner, wrap(async (req, res) => {
  const v = req.venue.id;
  const { secret, ...settings } = req.venue.settings;
  const all = (sql) => db.all(sql, [v]);
  const orders = await all('SELECT * FROM orders WHERE venue_id = ? ORDER BY id');
  const ids = orders.map((o) => o.id);
  const orderItems = ids.length ? await db.all(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids) : [];
  const data = {
    exportedAt: now(), venue: venueSummary(req.venue), settings,
    account: await db.get('SELECT email, terms_version, terms_accepted_at, created_at FROM accounts WHERE id = ?', [req.accountId]),
    categories: (await all('SELECT * FROM categories WHERE venue_id = ? ORDER BY sort, id')).map(mapCategory),
    items: (await all('SELECT * FROM items WHERE venue_id = ? ORDER BY sort, id')).map(mapItem),
    spots: (await all('SELECT id, label, kind, active, token FROM tables WHERE venue_id = ? ORDER BY id')),
    orders, orderItems,
    calls: await all('SELECT * FROM calls WHERE venue_id = ? ORDER BY id'),
    receipts: (await all('SELECT * FROM receipts WHERE venue_id = ? ORDER BY id')).map(mapReceipt),
  };
  res.setHeader('Content-Disposition', `attachment; filename="kalimenu-${req.venue.slug}-${now().slice(0, 10)}.json"`);
  res.type('application/json').send(JSON.stringify(data, null, 2));
}));

// Account deletion by the owner (GDPR erasure): cancels the subscription and removes every row of the venue.
app.delete('/api/account', ...requireOwner, wrap(async (req, res) => {
  const venue = req.venue;
  const account = await db.get('SELECT password_hash FROM accounts WHERE id = ?', [req.accountId]);
  if (!(await checkPassword(req.body?.password, account?.password_hash))) fail(401, 'Λάθος κωδικός');
  if (venue.isDemo) fail(403, 'Το demo δεν διαγράφεται');
  if (venue.stripeSubscriptionId && stripeEnabled() && venue.status !== 'canceled') {
    await stripe(`subscriptions/${venue.stripeSubscriptionId}`, null, 'DELETE');
  }
  await deleteVenue(venue.id);
  if (process.env.NOTIFY_EMAIL) sendMail({ to: process.env.NOTIFY_EMAIL, subject: `Διαγραφή λογαριασμού: ${venue.name}`, text: `${venue.name} (${venue.slug})` });
  res.setHeader('Set-Cookie', 'staff=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
}));

// Stripe → us. Registered before the JSON body parser because the signature is computed over the raw body.
async function stripeWebhook(req, res) {
  const event = verifyWebhook(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '', req.get('stripe-signature'));
  if (!event) return res.status(400).json({ error: 'bad_signature' });
  const obj = event.data?.object || {};
  if (event.type === 'checkout.session.completed' && obj.mode === 'subscription') {
    const id = Number(obj.metadata?.venue_id || obj.client_reference_id);
    const plan = obj.metadata?.plan;
    if (await getVenue(id)) {
      await updateVenue(id, {
        stripeCustomerId: obj.customer || '', stripeSubscriptionId: obj.subscription || '', status: 'active',
        ...(PAID_PLANS.includes(plan) ? { plan } : {}),
        ...(['month', 'year'].includes(obj.metadata?.interval) ? { interval: obj.metadata.interval } : {}),
      });
    }
  } else if (event.type.startsWith('customer.subscription.')) {
    const row = await db.get('SELECT id FROM venues WHERE stripe_subscription_id = ?', [obj.id]);
    const id = row?.id || Number(obj.metadata?.venue_id);
    const venue = id && await getVenue(id);
    // Ignore events of an older subscription once the venue has a newer one.
    if (venue && (row || !venue.stripeSubscriptionId || venue.stripeSubscriptionId === obj.id)) {
      const status = event.type === 'customer.subscription.deleted' ? 'canceled' : venueStatus(obj);
      const interval = obj.items?.data?.[0]?.price?.recurring?.interval;
      await updateVenue(venue.id, {
        ...(status ? { status } : {}),
        ...(PAID_PLANS.includes(obj.metadata?.plan) ? { plan: obj.metadata.plan } : {}),
        ...(['month', 'year'].includes(interval) ? { interval } : {}),
        ...(row ? {} : { stripeSubscriptionId: obj.id, stripeCustomerId: obj.customer || venue.stripeCustomerId }),
      });
    }
  }
  res.json({ received: true });
}

// ---------------------------------------------------------------------------
// Super admin: the owner of the service manages every venue and subscription from /super.
// Cookie "adminId.expiry.signature", signed with a key derived from the administrator's password hash
// (changing the password logs out every session).
// ---------------------------------------------------------------------------
const SUPER_HOURS = 12;
const superSign = (admin, value) => createHmac('sha256', sha256(`kalimenu-super:${admin.password_hash}`)).update(value).digest('base64url');

async function superSession(req) {
  const [id, exp, sig] = String(readCookie(req, 'super') || '').split('.');
  if (!sig || !(Number(exp) > Date.now())) return null;
  const admin = await db.get('SELECT * FROM admins WHERE id = ?', [Number(id) || 0]);
  if (!admin) return null;
  const expected = Buffer.from(superSign(admin, `${id}.${exp}`));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? admin : null;
}

const requireSuper = (req, res, next) => {
  superSession(req).then((admin) => {
    if (!admin) return res.status(401).json({ error: 'Απαιτείται σύνδεση διαχειριστή' });
    req.admin = admin;
    next();
  }, next);
};

app.post('/api/super/login', wrap(async (req, res) => {
  if (!rateLimit(`super-login:${req.ip}`, 5, 60_000)) fail(429, 'Πολλές προσπάθειες. Δοκιμάστε σε ένα λεπτό.');
  const admin = await db.get('SELECT * FROM admins WHERE email = ?', [cleanEmail(req.body?.email)]);
  const ok = await checkPassword(req.body?.password, admin?.password_hash || 'scrypt$x$x');
  if (!ok || !admin) fail(401, 'Λάθος e-mail ή κωδικός');
  const value = `${admin.id}.${Date.now() + SUPER_HOURS * 3600_000}`;
  res.setHeader('Set-Cookie', `super=${value}.${superSign(admin, value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SUPER_HOURS * 3600}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
}));

app.post('/api/super/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'super=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ ok: true });
});

const superApi = express.Router();
superApi.use(requireSuper);

superApi.get('/me', (req, res) => res.json({ email: req.admin.email }));

// Monthly recurring revenue of a venue in cents (yearly plans spread over 12 months).
const venueMrr = (v) => (['active', 'past_due'].includes(v.status) && !v.isDemo
  ? Math.round(priceCents(planOf(v), v.interval) / (v.interval === 'year' ? 12 : 1)) : 0);

superApi.get('/overview', wrap(async (req, res) => {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const count = async (sql, params = []) => new Map((await db.all(sql, params)).map((r) => [r.venue_id, r]));
  const owners = await count('SELECT venue_id, MIN(email) AS email FROM accounts GROUP BY venue_id');
  const items = await count('SELECT venue_id, COUNT(*) AS n FROM items GROUP BY venue_id');
  const spots = await count('SELECT venue_id, COUNT(*) AS n FROM tables GROUP BY venue_id');
  const orders = await count(`SELECT venue_id, COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS revenue, MAX(created_at) AS last
    FROM orders WHERE created_at >= ? AND status != 'rejected' GROUP BY venue_id`, [since]);
  const venues = [];
  for (const { id } of await db.all('SELECT id FROM venues ORDER BY id DESC')) {
    const v = await getVenue(id);
    venues.push({
      id: v.id, slug: v.slug, name: v.name, email: owners.get(id)?.email || '', plan: planOf(v), status: v.status,
      effectivePlan: effectivePlan(v), interval: v.interval, trialEndsAt: v.trial_ends_at, createdAt: v.createdAt,
      isDemo: v.isDemo, stripe: !!v.stripeSubscriptionId, mrr: venueMrr(v),
      items: Number(items.get(id)?.n || 0), spots: Number(spots.get(id)?.n || 0),
      orders30: Number(orders.get(id)?.n || 0), revenue30: Number(orders.get(id)?.revenue || 0), lastOrderAt: orders.get(id)?.last || '',
    });
  }
  const real = venues.filter((v) => !v.isDemo);
  const trialActive = (v) => v.status === 'trialing' && new Date(v.trialEndsAt) > new Date();
  res.json({
    totals: {
      venues: real.length,
      trialing: real.filter(trialActive).length,
      paying: real.filter((v) => v.mrr > 0).length,
      inactive: real.filter((v) => !v.effectivePlan && !['paused', 'suspended'].includes(v.status)).length,
      paused: real.filter((v) => v.status === 'paused').length,
      suspended: real.filter((v) => v.status === 'suspended').length,
      mrr: real.reduce((s, v) => s + v.mrr, 0),
      signups30: real.filter((v) => v.createdAt >= since).length,
      trialsEnding7: real.filter((v) => trialActive(v) && new Date(v.trialEndsAt) - Date.now() < 7 * 86400_000).length,
    },
    venues,
    plans: PLANS,
    stripe: stripeEnabled(),
  });
}));

const VENUE_STATUSES = ['trialing', 'active', 'past_due', 'paused', 'canceled', 'suspended'];
const superVenue = async (req) => (await getVenue(Number(req.params.id) || 0)) || fail(404, 'Το κατάστημα δεν βρέθηκε');

// Change plan / status by hand, or extend the free trial (e.g. for a customer who asked for more time).
superApi.put('/venues/:id', wrap(async (req, res) => {
  const venue = await superVenue(req);
  const b = req.body || {};
  const fields = {};
  if (b.plan !== undefined) fields.plan = PLANS[b.plan] ? b.plan : fail(400, 'Άγνωστο πλάνο');
  if (b.status !== undefined) fields.status = VENUE_STATUSES.includes(b.status) ? b.status : fail(400, 'Άγνωστη κατάσταση');
  if (b.interval !== undefined) fields.interval = b.interval === 'year' ? 'year' : 'month';
  if (b.extendTrialDays) {
    const days = Math.min(Math.max(Math.trunc(Number(b.extendTrialDays)) || 0, 1), 365);
    const from = Math.max(Date.now(), new Date(venue.trial_ends_at).getTime() || 0);
    fields.trial_ends_at = new Date(from + days * 86400_000).toISOString();
    fields.status = 'trialing';
  }
  await updateVenue(venue.id, fields);
  res.json({ ok: true, venue: venueSummary(await getVenue(venue.id)) });
}));

// Opens the venue's administration as its owner (to help them set up or check a problem).
superApi.post('/venues/:id/impersonate', wrap(async (req, res) => {
  const venue = await superVenue(req);
  const owner = await db.get('SELECT id FROM accounts WHERE venue_id = ? ORDER BY id LIMIT 1', [venue.id]);
  setSession(req, res, venue, 'admin', owner?.id || 0);
  res.json({ ok: true, next: '/staff/admin' });
}));

// A password link the administrator can also pass on by phone or message (valid 24 hours).
superApi.post('/venues/:id/reset-link', wrap(async (req, res) => {
  const venue = await superVenue(req);
  const account = await db.get('SELECT id, email FROM accounts WHERE venue_id = ? ORDER BY id LIMIT 1', [venue.id]);
  if (!account) fail(400, 'Το κατάστημα δεν έχει λογαριασμό ιδιοκτήτη');
  res.json({ link: await sendResetLink(req, account, 24), email: account.email });
}));

superApi.delete('/venues/:id', wrap(async (req, res) => {
  const venue = await superVenue(req);
  if (req.body?.confirm !== venue.slug) fail(400, `Γράψτε «${venue.slug}» για επιβεβαίωση`);
  if (venue.stripeSubscriptionId && stripeEnabled() && !['canceled'].includes(venue.status)) {
    await stripe(`subscriptions/${venue.stripeSubscriptionId}`, null, 'DELETE').catch((e) => console.error('cancel failed', e.message));
  }
  await deleteVenue(venue.id);
  res.json({ ok: true });
}));

app.use('/api/super', superApi);

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
app.get('/staff/print/order/:id', page('staff/print.html'));
app.get('/staff/print/receipt/:id', page('staff/print.html'));
app.get('/r/:token', page('receipt.html'));
app.get('/signup', page('signup.html'));
app.get('/login', page('login.html'));
app.get('/reset', page('login.html'));
app.get('/terms', page('terms.html'));
app.get('/privacy', page('privacy.html'));
app.get('/dpa', page('dpa.html'));
// Company details for the footer and the legal pages.
app.get('/api/site', (req, res) => res.json({ company: COMPANY, termsVersion: TERMS_VERSION, trialDays: TRIAL_DAYS }));
app.get('/super', page('super.html'));
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/api/plans', (req, res) => res.json({ plans: PLANS, trialDays: TRIAL_DAYS }));

// Demo links for the presentation page: the demo venue, or the only venue of an own installation.
app.get('/api/demo', wrap(async (req, res) => {
  const row = (await db.get('SELECT id FROM venues WHERE is_demo = 1 ORDER BY id LIMIT 1'))
    || (await db.get('SELECT id FROM venues ORDER BY id LIMIT 1'));
  const venue = row && await getVenue(row.id);
  if (!venue) return res.json({ tables: [], pins: null });
  const t = await db.all('SELECT label, token, kind FROM tables WHERE venue_id = ? AND active = 1 ORDER BY id LIMIT 3', [venue.id]);
  const { pins } = venue.settings;
  // Only reveal PINs while the demo defaults are still in use.
  const isDemo = ['admin', 'waiter', 'kitchen'].every((r) => pins[r] === DEMO_PINS[r]);
  res.json({ venue: venue.slug, tables: t.map((x) => ({ label: x.label, kind: x.kind, url: `/t/${x.token}` })), pins: isDemo ? pins : null });
}));

app.get('/uploads/:name', wrap(async (req, res, next) => {
  const file = await db.get('SELECT mime, data FROM uploads WHERE name = ?', [String(req.params.name)]);
  if (!file) return next(); // older installations kept uploads on disk
  res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  res.type(file.mime).send(Buffer.from(file.data));
}));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'server_error' : err.message, ...(err.code && status < 500 ? { code: err.code } : {}) });
});

export { app };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // The public demo is recreated every day so visitors' changes do not pile up.
  if (PRODUCTION && process.env.DEMO_VENUE !== 'off') {
    setInterval(() => resetDemoVenue().catch((e) => console.error('demo reset failed', e)), 24 * 3600_000).unref();
  }
  app.listen(PORT, '0.0.0.0', () => {
    const lan = Object.values(networkInterfaces()).flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    console.log(`\n  Kalimenu τρέχει\n`);
    console.log(`  Στον υπολογιστή:  http://localhost:${PORT}`);
    if (lan) console.log(`  Από κινητό (ίδιο Wi-Fi): http://${lan}:${PORT}`);
    console.log(`  Βάση δεδομένων: ${db.dialect === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : 'SQLite (data/taverna.db)'}`);
    console.log(`  Πληρωμές συνδρομών: ${stripeEnabled() ? 'Stripe' : PRODUCTION ? 'ΔΕΝ έχουν ρυθμιστεί (STRIPE_SECRET_KEY)' : 'δοκιμαστικές, χωρίς Stripe'}`);
    console.log(`\n  Demo: PIN Admin 1234 · Σερβιτόρος 1111 · Κουζίνα 2222 · Νέος λογαριασμός: http://localhost:${PORT}/signup\n`);
  });
}
