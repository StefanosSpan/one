// Deletes the local database so the demo data is recreated on next start.
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
for (const f of ['taverna.db', 'taverna.db-wal', 'taverna.db-shm']) rmSync(join(dataDir, f), { force: true });
console.log('Η βάση διαγράφηκε. Στο επόμενο «npm start» θα δημιουργηθεί ξανά με τα demo δεδομένα.');
