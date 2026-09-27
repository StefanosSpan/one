// Deletes all data so the demo menu is recreated on the next start.
// Works for both SQLite (data/taverna.db) and PostgreSQL (DATABASE_URL).
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, dropAll } from './db/adapter.js';

if (process.env.DATABASE_URL) {
  const db = await openDatabase();
  await dropAll(db);
  await db.close();
  console.log('Οι πίνακες της PostgreSQL διαγράφηκαν. Στο επόμενο «npm start» θα δημιουργηθούν ξανά με τα demo δεδομένα.');
} else {
  const dataDir = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  for (const f of ['taverna.db', 'taverna.db-wal', 'taverna.db-shm']) rmSync(join(dataDir, f), { force: true });
  console.log('Η βάση SQLite διαγράφηκε. Στο επόμενο «npm start» θα δημιουργηθεί ξανά με τα demo δεδομένα.');
}
