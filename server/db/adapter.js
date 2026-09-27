// Small async database layer with two backends:
//   - SQLite  (default, zero setup): a single file in data/taverna.db
//   - PostgreSQL (set DATABASE_URL): for hosting online (Supabase, Neon, Render, your own server…)
// Queries are written once with `?` placeholders; the PostgreSQL backend converts them to $1, $2, …
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const schema = (dialect) => readFileSync(join(HERE, `schema.${dialect}.sql`), 'utf8');

export const TABLES = ['calls', 'order_items', 'orders', 'items', 'categories', 'tables', 'settings'];

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

  await api.exec(schema('sqlite'));
  // Migration for databases created before spots had a type.
  const addColumn = async (table, column, ddl) => {
    const cols = await api.all(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => c.name === column)) await api.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  await addColumn('tables', 'kind', "TEXT NOT NULL DEFAULT 'table'");
  await addColumn('items', 'options', "TEXT DEFAULT '[]'");
  await addColumn('order_items', 'options', "TEXT DEFAULT '[]'");
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

  await api.exec(schema('postgres'));
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
