import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { seed } from './seed.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || join(root, 'data');
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_FILE || join(DATA_DIR, 'taverna.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,              -- JSON {el, en, ...}
  icon TEXT DEFAULT '',
  sort INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,              -- JSON
  description TEXT DEFAULT '{}',   -- JSON
  price_cents INTEGER NOT NULL,
  allergens TEXT DEFAULT '[]',     -- JSON array of allergen codes
  tags TEXT DEFAULT '[]',          -- JSON array: vegetarian, vegan, gluten_free, spicy, popular
  emoji TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  available INTEGER DEFAULT 1,
  sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  status TEXT NOT NULL,            -- pending|accepted|preparing|ready|served|rejected
  note TEXT DEFAULT '',
  lang TEXT DEFAULT 'el',
  total_cents INTEGER NOT NULL,
  paid INTEGER DEFAULT 0,
  closed INTEGER DEFAULT 0,        -- 1 when the table's bill has been settled/closed
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER,
  name TEXT NOT NULL,              -- JSON snapshot of item name
  qty INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  type TEXT NOT NULL,              -- waiter|bill
  payment_method TEXT DEFAULT '',  -- cash|card (for bill)
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id, closed);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
`);

// Lightweight migrations for databases created by older versions.
const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasColumn('tables', 'kind')) db.exec("ALTER TABLE tables ADD COLUMN kind TEXT NOT NULL DEFAULT 'table'");

export const SPOT_KINDS = ['table', 'room', 'sunbed'];

export const now = () => new Date().toISOString();
export const newToken = () => randomBytes(9).toString('base64url');

const isEmpty = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n === 0;
if (isEmpty) seed(db, { newToken });

// JSON-aware row mappers
const parse = (v, fallback) => {
  try { return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
};
export const mapCategory = (r) => r && { ...r, name: parse(r.name, {}), active: !!r.active };
export const mapItem = (r) => r && {
  ...r,
  name: parse(r.name, {}),
  description: parse(r.description, {}),
  allergens: parse(r.allergens, []),
  tags: parse(r.tags, []),
  available: !!r.available,
};
export const mapTable = (r) => r && { ...r, active: !!r.active };

export function getSettings() {
  const out = {};
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
    out[key] = parse(value, value);
  }
  return out;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
