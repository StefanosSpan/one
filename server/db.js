import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { openDatabase } from './db/adapter.js';
import { seed } from './seed.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || join(root, 'data');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export const SPOT_KINDS = ['table', 'room', 'sunbed'];
export const now = () => new Date().toISOString();
export const newToken = () => randomBytes(9).toString('base64url');

/** The open database (SQLite or PostgreSQL). Available once `ready` has resolved. */
export let db;

const parse = (v, fallback) => {
  try { return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
};

// ---------------------------------------------------------------------------
// Venues. Each venue has its own settings, menu, spots, staff PINs and subscription.
// Venue rows and settings are read on almost every request, so they are cached in memory for a
// short time (so changes made by another server instance, e.g. a billing webhook, show up quickly).
// ---------------------------------------------------------------------------
const CACHE_MS = 30_000;
const cache = new Map(); // venueId -> { at, venue }

const mapVenue = (r, settings) => r && {
  id: r.id, slug: r.slug, name: r.name, plan: r.plan, status: r.status, trial_ends_at: r.trial_ends_at || '',
  interval: r.billing_interval || 'month', stripeCustomerId: r.stripe_customer_id || '',
  stripeSubscriptionId: r.stripe_subscription_id || '', isDemo: !!r.is_demo, createdAt: r.created_at, settings,
};

/** Venue with its settings, or undefined. */
export async function getVenue(id) {
  id = Number(id);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.venue;
  const row = await db.get('SELECT * FROM venues WHERE id = ?', [id]);
  if (!row) { cache.delete(id); return undefined; }
  const settings = {};
  for (const { key, value } of await db.all('SELECT key, value FROM settings WHERE venue_id = ?', [id])) settings[key] = parse(value, value);
  const venue = mapVenue(row, settings);
  cache.set(id, { at: Date.now(), venue });
  return venue;
}

export async function venueBySlug(slug) {
  const row = await db.get('SELECT id FROM venues WHERE slug = ?', [String(slug || '').toLowerCase()]);
  return row && getVenue(row.id);
}

export const forgetVenue = (id) => cache.delete(Number(id));

export async function setSetting(venueId, key, value) {
  await db.run(`INSERT INTO settings (venue_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT (venue_id, key) DO UPDATE SET value = excluded.value`, [venueId, key, JSON.stringify(value)]);
  if (key === 'restaurant' && value?.name) await db.run('UPDATE venues SET name = ? WHERE id = ?', [value.name, venueId]);
  forgetVenue(venueId);
}

const VENUE_FIELDS = { plan: 'plan', status: 'status', trial_ends_at: 'trial_ends_at', interval: 'billing_interval',
  stripeCustomerId: 'stripe_customer_id', stripeSubscriptionId: 'stripe_subscription_id' };

export async function updateVenue(id, fields) {
  const sets = Object.keys(fields).filter((k) => VENUE_FIELDS[k]);
  if (!sets.length) return;
  await db.run(`UPDATE venues SET ${sets.map((k) => `${VENUE_FIELDS[k]} = ?`).join(', ')} WHERE id = ?`,
    [...sets.map((k) => fields[k]), id]);
  forgetVenue(id);
}

// Latin, URL-friendly short name, e.g. "Ταβέρνα Το Κύμα" -> "taverna-to-kyma".
const GREEK = { α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x',
  ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o' };
export function slugify(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[α-ω]/g, (c) => GREEK[c] || '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'katastima';
}

// Venue codes are also their address (<code>.kalimenu.gr); these names stay with the service.
export const RESERVED_SLUGS = new Set(['www', 'app', 'api', 'admin', 'super', 'mail', 'smtp', 'email', 'ftp', 'static', 'cdn', 'assets',
  'img', 'files', 'help', 'support', 'status', 'blog', 'docs', 'dev', 'test', 'staging', 'login', 'signup', 'staff', 'kalimenu', 'm', 't', 'r']);

/**
 * Creates a venue with its settings, starter menu and spots inside a transaction `t`.
 * Returns the new venue id.
 */
export async function createVenue(t, { name, plan = 'pro', status = 'active', trialEndsAt = '', interval = 'month', isDemo = false,
  slug, ...seedOptions }) {
  let base = slug || slugify(name);
  let candidate = base;
  for (let i = 2; RESERVED_SLUGS.has(candidate) || await t.get('SELECT id FROM venues WHERE slug = ?', [candidate]); i++) candidate = `${base}-${i}`;
  const venueId = await t.insert(`INSERT INTO venues (slug, name, plan, status, trial_ends_at, billing_interval, is_demo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [candidate, name, plan, status, trialEndsAt, interval, isDemo ? 1 : 0, now()]);
  await seed(t, { newToken, venueId, name, ...seedOptions });
  return venueId;
}

// The public demo venue (slug "demo") with the example menu and well-known PINs.
export const DEMO_PINS = { admin: '1234', waiter: '1111', kitchen: '2222' };
export async function createDemoVenue() {
  return db.tx((t) => createVenue(t, {
    name: 'Το εστιατόριό σας', slug: 'demo', plan: 'plus', status: 'active', isDemo: true,
    pins: DEMO_PINS, onlinePayments: 'demo', sample: true, demoInfo: true,
  }));
}

// Deletes a venue with all of its data.
export async function deleteVenue(id) {
  await db.tx(async (t) => {
    // order_items go with their orders; everything else is removed per venue.
    for (const table of ['account_venues', 'loyalty_redemptions', 'item_views', 'feedback', 'payments', 'uploads', 'receipts', 'calls', 'orders', 'items', 'categories', 'tables', 'settings', 'accounts']) {
      await t.run(`DELETE FROM ${table} WHERE venue_id = ?`, [id]);
    }
    await t.run('DELETE FROM venues WHERE id = ?', [id]);
  });
  forgetVenue(id);
}

// Deletes the demo venue and creates it again, so changes made by visitors do not stay forever.
export async function resetDemoVenue() {
  const old = await db.get('SELECT id FROM venues WHERE is_demo = 1');
  if (old) await deleteVenue(old.id);
  return createDemoVenue();
}

export const ready = (async () => {
  db = await openDatabase({ file: process.env.DB_FILE || join(DATA_DIR, 'taverna.db') });
  const { n } = await db.get('SELECT COUNT(*) AS n FROM venues');
  if (Number(n) === 0 && process.env.DEMO_VENUE !== 'off') await createDemoVenue();
  await ensureSuperAdmin(process.env.SUPERADMIN_EMAIL, process.env.SUPERADMIN_PASSWORD);
  return db;
})();

// ---------------------------------------------------------------------------
// Platform administrators (the owner of the service) manage every venue from /super.
// ---------------------------------------------------------------------------
const scryptAsync = promisify(scrypt);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  return `scrypt$${salt}$${(await scryptAsync(String(password), salt, 64)).toString('base64url')}`;
}

async function samePassword(password, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const given = await scryptAsync(String(password), salt, 64);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Creates the administrator, or sets a new password when `reset` is true. Used with SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD. */
export async function ensureSuperAdmin(email, password, { reset = false } = {}) {
  email = String(email || '').trim().toLowerCase();
  if (!email || !password) return false;
  if (String(password).length < 12) throw new Error('Ο κωδικός του super admin χρειάζεται τουλάχιστον 12 χαρακτήρες');
  const existing = await db.get('SELECT id, password_hash FROM admins WHERE email = ?', [email]);
  // The password set on the hosting is the valid one: a new value there replaces the old one on the next start.
  if (existing && !reset && await samePassword(password, existing.password_hash)) return false;
  const hash = await hashPassword(password);
  if (existing) await db.run('UPDATE admins SET password_hash = ? WHERE id = ?', [hash, existing.id]);
  else await db.insert('INSERT INTO admins (email, password_hash, created_at) VALUES (?, ?, ?)', [email, hash, now()]);
  return true;
}

// JSON-aware row mappers
export const mapCategory = (r) => r && {
  ...r, name: parse(r.name, {}), active: !!r.active, station: r.station || 'kitchen',
  schedule: parse(r.schedule, null) || null, zones: parse(r.zones, []) || [],
};
export const mapItem = (r) => r && {
  ...r,
  name: parse(r.name, {}),
  description: parse(r.description, {}),
  allergens: parse(r.allergens, []),
  tags: parse(r.tags, []),
  options: parse(r.options, []),
  available: !!r.available,
  premium: !!r.premium,
  prep_minutes: Number(r.prep_minutes) || 0,
};
export const mapTable = (r) => r && { ...r, active: !!r.active, zone: r.zone || '', all_inclusive: !!r.all_inclusive };
