/** Applies pending database migrations and exits. Usage: node dist/migrate.js */
import { loadConfig } from '../config';
import { openDatabase } from '../db/client';

const config = loadConfig();
const database = await openDatabase(config.databaseUrl, { poolMax: 1 });
try {
  await database.migrate();
  console.log(`[what-if] Migrations applied (${database.kind}).`);
} catch (err) {
  console.error('[what-if] Migration failed:', err);
  process.exitCode = 1;
} finally {
  await database.close();
}
