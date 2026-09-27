-- Kalimenu – database schema (SQLite)
-- One database holds many venues (restaurants/hotels). Every row belongs to a venue (venue_id).
-- Multilingual texts are stored as JSON objects, e.g. {"el": "Μουσακάς", "en": "Moussaka"}.
-- Money is stored in cents (integer). Timestamps are ISO-8601 strings in UTC.

-- A customer business with its own menu, spots, staff PINs and subscription.
CREATE TABLE IF NOT EXISTS venues (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                   TEXT NOT NULL UNIQUE,      -- short code used in the staff login link
  name                   TEXT NOT NULL,
  plan                   TEXT NOT NULL DEFAULT 'free',   -- free | basic | pro | hotel
  status                 TEXT NOT NULL DEFAULT 'active', -- trialing | active | past_due | paused | canceled | suspended
  trial_ends_at          TEXT DEFAULT '',
  billing_interval       TEXT DEFAULT 'month',       -- month | year
  stripe_customer_id     TEXT DEFAULT '',
  stripe_subscription_id TEXT DEFAULT '',
  is_demo                INTEGER DEFAULT 0,
  created_at             TEXT NOT NULL
);

-- Owner logins (email + password). Staff use PINs per venue.
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id      INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  reset_hash    TEXT DEFAULT '',
  reset_expires TEXT DEFAULT '',
  terms_version TEXT DEFAULT '',        -- version of the terms accepted at sign-up
  terms_accepted_at TEXT DEFAULT '',
  created_at    TEXT NOT NULL
);

-- Administrators of the whole service (super admin), not tied to a venue.
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  key      TEXT NOT NULL,
  value    TEXT NOT NULL,                -- JSON
  PRIMARY KEY (venue_id, key)
);

CREATE TABLE IF NOT EXISTS categories (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,                -- JSON {lang: text}
  icon     TEXT DEFAULT '',
  sort     INTEGER DEFAULT 0,
  active   INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id    INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
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
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  label    TEXT NOT NULL,
  token    TEXT NOT NULL UNIQUE,         -- secret part of the QR link
  active   INTEGER DEFAULT 1,
  kind     TEXT NOT NULL DEFAULT 'table' -- table | room | sunbed
);

CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id    INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
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
  venue_id       INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
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
  venue_id     INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  number       TEXT NOT NULL,            -- e.g. 2026-00042, unique per venue
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
  created_at   TEXT NOT NULL,
  UNIQUE (venue_id, number)
);

-- Uploaded images (logos, covers, dish photos). Kept in the database so hosting needs no persistent disk.
CREATE TABLE IF NOT EXISTS uploads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id   INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name       TEXT NOT NULL UNIQUE,
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_venue ON categories(venue_id);
CREATE INDEX IF NOT EXISTS idx_items_venue      ON items(venue_id);
CREATE INDEX IF NOT EXISTS idx_tables_venue     ON tables(venue_id);
CREATE INDEX IF NOT EXISTS idx_receipts_created ON receipts(venue_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_table     ON orders(table_id, closed);
CREATE INDEX IF NOT EXISTS idx_orders_created   ON orders(venue_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_items      ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_calls_status     ON calls(venue_id, status);

-- ---------------------------------------------------------------------------
-- Columns added to the tables above by server/db/adapter.js (ADDED_COLUMNS) on every start,
-- so databases already online get them too:
--   categories.station       prep station that receives these dishes (kitchen, bar, …)
--   categories.schedule      JSON {days:[1-7], from:'HH:MM', to:'HH:MM'}: shown only then ('' = always)
--   categories.zones         JSON array of zones where the category is shown ('' = everywhere)
--   items.happy_price_cents  price during happy hour (NULL = no offer)
--   items.stock              portions left (NULL = not tracked); at 0 the dish is sold out
--   items.prep_minutes       preparation time for the estimate shown to the guest
--   items.premium            charged even at all-inclusive spots
--   tables.zone              e.g. Βεράντα, Πισίνα, Παραλία: waiter zones and per-zone menus
--   tables.all_inclusive     dishes are free here except premium ones
--   orders.guest_id          random id of the guest's phone (loyalty), no personal data
--   orders.accepted_at, eta_at  estimated ready time shown to the guest
--   orders.channel           table | takeaway; customer_name, customer_phone, pickup_at for takeaway
--   order_items.station, ready  each station marks its own dishes ready
--   order_items.paid_qty     portions already paid from the guest's phone (split bill)
--   receipts.guest_ids, tip_cents
-- ---------------------------------------------------------------------------

-- Payments made from the guest's phone (whole bill, own dishes or an equal share), with tip.
CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id       INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  table_id       INTEGER,
  provider       TEXT NOT NULL,            -- viva | demo
  ref            TEXT DEFAULT '',          -- provider's order code
  transaction_id TEXT DEFAULT '',
  amount_cents   INTEGER NOT NULL,         -- towards the bill
  tip_cents      INTEGER DEFAULT 0,
  lines          TEXT DEFAULT '[]',        -- JSON [[orderItemId, qty]] when paying for own dishes
  method         TEXT DEFAULT 'online',    -- online | room
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed
  closed         INTEGER DEFAULT 0,        -- 1 once the spot's bill has been settled
  guest_id       TEXT DEFAULT '',
  created_at     TEXT NOT NULL,
  fee_cents      INTEGER DEFAULT 0,        -- Kalimenu's fee kept by Viva (Viva Connect)
  paid_at        TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_payments_table ON payments(table_id, closed);
CREATE INDEX IF NOT EXISTS idx_payments_ref ON payments(ref);

-- Ratings left by guests after the bill.
CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id    INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  receipt_id  INTEGER,
  table_label TEXT DEFAULT '',
  rating      INTEGER NOT NULL,          -- 1-5
  comment     TEXT DEFAULT '',
  lang        TEXT DEFAULT 'el',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_venue ON feedback(venue_id, created_at);

-- How many times each dish was opened on the menu, per day.
CREATE TABLE IF NOT EXISTS item_views (
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  item_id  INTEGER NOT NULL,
  day      TEXT NOT NULL,
  views    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (venue_id, item_id, day)
);

-- Loyalty rewards given (visits are counted from receipts since the last reward).
CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id   INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  guest_id   TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loyalty_guest ON loyalty_redemptions(venue_id, guest_id);

-- Owners with more than one venue.
CREATE TABLE IF NOT EXISTS account_venues (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  venue_id   INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, venue_id)
);
