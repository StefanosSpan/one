// Small async database layer with two backends:
//   - SQLite  (default, zero setup): a single file in data/taverna.db
//   - PostgreSQL (set DATABASE_URL): for hosting online (Supabase, Neon, Render, your own server…)
// Queries are written once with `?` placeholders; the PostgreSQL backend converts them to $1, $2, …
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const schema = (dialect) => readFileSync(join(HERE, `schema.${dialect}.sql`), 'utf8');

export const TABLES = ['uploads', 'receipts', 'calls', 'order_items', 'orders', 'items', 'categories', 'tables', 'settings', 'accounts', 'venues', 'admins'];

// ---------------------------------------------------------------------------
// Migration from the single-venue schema (before venues existed): the old tables are
// renamed, the new schema is created and every row is copied into venue 1.
// ---------------------------------------------------------------------------
const LEGACY = {
  settings: ['key', 'value'],
  categories: ['id', 'name', 'icon', 'sort', 'active'],
  tables: ['id', 'label', 'token', 'active', 'kind'],
  items: ['id', 'category_id', 'name', 'description', 'price_cents', 'allergens', 'tags', 'emoji', 'image_url', 'available', 'sort', 'options'],
  orders: ['id', 'table_id', 'status', 'note', 'lang', 'total_cents', 'paid', 'closed', 'created_at', 'updated_at'],
  order_items: ['id', 'order_id', 'item_id', 'name', 'qty', 'price_cents', 'note', 'options'],
  calls: ['id', 'table_id', 'type', 'payment_method', 'status', 'created_at'],
  receipts: ['id', 'number', 'token', 'table_id', 'table_label', 'table_kind', 'order_ids', 'lines', 'total_cents', 'payment', 'fiscal_ref', 'lang', 'created_at'],
};
const LEGACY_INDEXES = ['idx_receipts_created', 'idx_orders_table', 'idx_orders_created', 'idx_order_items', 'idx_calls_status'];
// Columns added to the single-venue schema over time; old databases may miss them.
const LEGACY_COLUMNS = [['tables', 'kind', "TEXT NOT NULL DEFAULT 'table'"], ['items', 'options', "TEXT DEFAULT '[]'"],
  ['order_items', 'options', "TEXT DEFAULT '[]'"]];

async function migrateLegacy(api, { columns, tableExists }) {
  const cols = await columns('settings');
  if (!cols.length || cols.includes('venue_id')) return false;
  const present = [];
  for (const name of Object.keys(LEGACY)) if (await tableExists(name)) present.push(name);
  const missing = [];
  for (const [table, column, ddl] of LEGACY_COLUMNS) {
    if (present.includes(table) && !(await columns(table)).includes(column)) missing.push(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
  await api.tx(async (t) => {
    for (const sql of missing) await t.exec(sql);
    for (const idx of LEGACY_INDEXES) await t.exec(`DROP INDEX IF EXISTS ${idx}`);
    for (const name of present) await t.exec(`ALTER TABLE ${name} RENAME TO legacy_${name}`);
    await t.exec(schema(api.dialect));

    const rows = await t.all("SELECT value FROM legacy_settings WHERE key = 'restaurant'");
    let name = 'Κατάστημα';
    try { name = JSON.parse(rows[0]?.value || '{}').name || name; } catch { /* keep default */ }
    await t.run(`INSERT INTO venues (id, slug, name, plan, status, created_at) VALUES (1, 'main', ?, 'hotel', 'active', ?)`,
      [name, new Date().toISOString()]);
    for (const name of Object.keys(LEGACY)) {
      if (!present.includes(name)) continue;
      const list = LEGACY[name].join(', ');
      if (name === 'order_items') await t.exec(`INSERT INTO order_items (${list}) SELECT ${list} FROM legacy_order_items`);
      else await t.exec(`INSERT INTO ${name} (venue_id, ${list}) SELECT 1, ${list} FROM legacy_${name}`);
    }
    for (const name of [...present].reverse()) await t.exec(`DROP TABLE legacy_${name}`);
    if (api.dialect === 'postgres') {
      for (const name of ['venues', ...present.filter((n) => n !== 'settings')]) {
        await t.exec(`SELECT setval(pg_get_serial_sequence('${name}', 'id'), COALESCE((SELECT MAX(id) FROM ${name}), 0) + 1, false)`);
      }
    }
  });
  return true;
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------
async function openSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const api = {
    dialect: 'sqlite',
    async all(sql, params = []) { return stmt(sql).all(...params); },
    async get(sql, params = []) { return stmt(sql).get(...params); },
    async run(sql, params = []) { return { changes: Number(stmt(sql).run(...params).changes) }; },
    async insert(sql, params = []) { return Number(stmt(sql).run(...params).lastInsertRowid); },
    async exec(sql) { raw.exec(sql); },
    async close() { raw.close(); },
  };

  // Transactions are serialised so two requests never share one.
  let queue = Promise.resolve();
  api.tx = (fn) => {
    const run = queue.then(async () => {
      raw.exec('BEGIN IMMEDIATE');
      try { const r = await fn(api); raw.exec('COMMIT'); return r; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    });
    queue = run.catch(() => {});
    return run;
  };

  const columns = async (table) => (await api.all(`PRAGMA table_info(${table})`)).map((c) => c.name);
  const migrated = await migrateLegacy(api, { columns, tableExists: async (t) => (await columns(t)).length > 0 });
  if (!migrated) await api.exec(schema('sqlite'));
  return api;
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------
const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

async function openPostgres(url) {
  const { default: pg } = await import('pg');
  // COUNT/SUM return int8/numeric; parse them as JS numbers (amounts are in cents, well within range).
  pg.types.setTypeParser(20, (v) => Number(v));
  pg.types.setTypeParser(1700, (v) => Number(v));
  const ssl = /sslmode=require|supabase|neon\.tech|render\.com/.test(url) ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString: url, ssl, max: 10 });

  const wrap = (client) => ({
    dialect: 'postgres',
    async all(sql, params = []) { return (await client.query(toPg(sql), params)).rows; },
    async get(sql, params = []) { return (await client.query(toPg(sql), params)).rows[0]; },
    async run(sql, params = []) { return { changes: (await client.query(toPg(sql), params)).rowCount }; },
    async insert(sql, params = []) { return (await client.query(`${toPg(sql)} RETURNING id`, params)).rows[0].id; },
    async exec(sql) { await client.query(sql); },
  });

  const api = wrap(pool);
  api.tx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await fn(wrap(client));
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  };
  api.close = () => pool.end();

  const columns = async (table) => (await api.all(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?', [table]))
    .map((c) => c.column_name);
  const migrated = await migrateLegacy(api, { columns, tableExists: async (t) => (await columns(t)).length > 0 });
  if (!migrated) await api.exec(schema('postgres'));
  return api;
}

export async function openDatabase({ url = process.env.DATABASE_URL, file } = {}) {
  if (url && /^postgres(ql)?:\/\//.test(url)) return openPostgres(url);
  return openSqlite(file);
}

// Drops every table (used by `npm run reset-db` and the tests).
export async function dropAll(db) {
  for (const t of TABLES) await db.exec(`DROP TABLE IF EXISTS ${t}${db.dialect === 'postgres' ? ' CASCADE' : ''}`);
}
