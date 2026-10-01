// Hosted PostgreSQL (Neon) closes idle connections, or all of them when the database sleeps.
// The service must keep running and the next query must work. Runs only against PostgreSQL (npm run test:pg).
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('a connection closed by the database does not stop the service', { skip: !process.env.DATABASE_URL && 'PostgreSQL only' }, async () => {
  const { openDatabase } = await import('../server/db/adapter.js');
  const db = await openDatabase();
  const crashed = [];
  const onCrash = (e) => crashed.push(e);
  process.on('uncaughtException', onCrash);
  try {
    // Open a few pooled connections, then the server closes every one of them (as Neon does).
    await Promise.all([1, 2, 3].map(() => db.get('SELECT pg_sleep(0.05), 1 AS one')));
    const killer = await openDatabase();
    await killer.all('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()');
    await killer.close();
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(crashed, []);
    assert.equal((await db.get('SELECT 1 AS one')).one, 1);
    assert.equal(await db.tx(async (t) => (await t.get('SELECT 2 AS two')).two), 2);
  } finally {
    process.off('uncaughtException', onCrash);
    await db.close();
  }
});
