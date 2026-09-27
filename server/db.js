import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
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

// Settings are read on almost every request, so they are cached in memory and written through to the database.
let settingsCache = {};

const parse = (v, fallback) => {
  try { return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
};

async function loadSettings() {
  const out = {};
  for (const { key, value } of await db.all('SELECT key, value FROM settings')) out[key] = parse(value, value);
  settingsCache = out;
}

export const getSettings = () => settingsCache;

export async function setSetting(key, value) {
  await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)]);
  settingsCache = { ...settingsCache, [key]: value };
}

export const ready = (async () => {
  db = await openDatabase({ file: process.env.DB_FILE || join(DATA_DIR, 'taverna.db') });
  const { n } = await db.get('SELECT COUNT(*) AS n FROM settings');
  if (Number(n) === 0) await db.tx((t) => seed(t, { newToken }));
  await loadSettings();
  return db;
})();

// JSON-aware row mappers
export const mapCategory = (r) => r && { ...r, name: parse(r.name, {}), active: !!r.active };
export const mapItem = (r) => r && {
  ...r,
  name: parse(r.name, {}),
  description: parse(r.description, {}),
  allergens: parse(r.allergens, []),
  tags: parse(r.tags, []),
  options: parse(r.options, []),
  available: !!r.available,
};
export const mapTable = (r) => r && { ...r, active: !!r.active };
