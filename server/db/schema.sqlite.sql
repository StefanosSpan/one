-- Taverna QR – database schema (SQLite)
-- Multilingual texts are stored as JSON objects, e.g. {"el": "Μουσακάς", "en": "Moussaka"}.
-- Money is stored in cents (integer). Timestamps are ISO-8601 strings in UTC.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                  -- JSON
);

CREATE TABLE IF NOT EXISTS categories (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL,                -- JSON {lang: text}
  icon   TEXT DEFAULT '',
  sort   INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,           -- JSON {lang: text}
  description TEXT DEFAULT '{}',       -- JSON {lang: text}
  price_cents INTEGER NOT NULL,
  allergens   TEXT DEFAULT '[]',       -- JSON array of EU allergen codes
  tags        TEXT DEFAULT '[]',       -- JSON array: vegetarian, vegan, gluten_free, spicy, popular, new
  emoji       TEXT DEFAULT '',
  image_url   TEXT DEFAULT '',
  available   INTEGER DEFAULT 1,
  sort        INTEGER DEFAULT 0,
  options     TEXT DEFAULT '[]'        -- JSON: [{name, required, multi, choices: [{name, price_cents}]}]
);

-- A "spot" that has its own QR code: restaurant table, hotel room or sunbed.
CREATE TABLE IF NOT EXISTS tables (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  label  TEXT NOT NULL,
  token  TEXT NOT NULL UNIQUE,         -- secret part of the QR link
  active INTEGER DEFAULT 1,
  kind   TEXT NOT NULL DEFAULT 'table' -- table | room | sunbed
);

CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id    INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,           -- pending | accepted | preparing | ready | served | rejected
  note        TEXT DEFAULT '',
  lang        TEXT DEFAULT 'el',
  total_cents INTEGER NOT NULL,
  paid        INTEGER DEFAULT 0,
  closed      INTEGER DEFAULT 0,       -- 1 once the spot's bill has been settled
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id     INTEGER,                 -- kept even if the dish is later deleted
  name        TEXT NOT NULL,           -- JSON snapshot of the dish name at order time
  qty         INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,        -- unit price at order time, including chosen options
  note        TEXT DEFAULT '',
  options     TEXT DEFAULT '[]'        -- JSON snapshot of the chosen options
);

CREATE TABLE IF NOT EXISTS calls (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id       INTEGER NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,        -- waiter | bill
  payment_method TEXT DEFAULT '',      -- cash | card
  status         TEXT NOT NULL DEFAULT 'open',
  created_at     TEXT NOT NULL
);

-- Bills issued when a spot is settled. Kept permanently so they can be reprinted and audited.
-- NOTE: these are not fiscal documents; the legal receipt comes from the certified cash register / provider (fiscal_ref).
CREATE TABLE IF NOT EXISTS receipts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  number       TEXT NOT NULL UNIQUE,     -- e.g. 2026-00042
  token        TEXT NOT NULL UNIQUE,     -- secret part of the guest's digital copy link
  table_id     INTEGER,
  table_label  TEXT NOT NULL,
  table_kind   TEXT NOT NULL DEFAULT 'table',
  order_ids    TEXT NOT NULL DEFAULT '[]',
  lines        TEXT NOT NULL DEFAULT '[]',   -- JSON [{name, options, qty, unit_cents, total_cents}]
  total_cents  INTEGER NOT NULL,
  payment      TEXT NOT NULL DEFAULT 'cash', -- cash | card | online
  fiscal_ref   TEXT DEFAULT '',          -- number / ΜΑΡΚ of the legal receipt from the cash register
  lang         TEXT DEFAULT 'el',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipts_created ON receipts(created_at);

CREATE INDEX IF NOT EXISTS idx_orders_table   ON orders(table_id, closed);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items    ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_calls_status   ON calls(status);
