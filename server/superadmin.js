// Creates the super admin account (or sets a new password):
//   npm run superadmin -- you@example.com "a-long-password"
// Works with SQLite and PostgreSQL (DATABASE_URL), like the server.
import { ready, ensureSuperAdmin, db } from './db.js';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.log('Χρήση: npm run superadmin -- email κωδικός');
  process.exit(1);
}
await ready;
try {
  await ensureSuperAdmin(email, password, { reset: true });
  console.log(`Ο λογαριασμός super admin ${email} είναι έτοιμος. Σύνδεση: /super`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
await db.close();
