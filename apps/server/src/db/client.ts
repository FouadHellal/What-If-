import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

export interface Database {
  db: Db;
  kind: 'postgres' | 'pglite';
  migrate: () => Promise<void>;
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
}

/** Locates the SQL migrations both in development (src/) and in the bundled build (dist/). */
export function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MIGRATIONS_DIR,
    resolve(here, '../drizzle'),
    resolve(here, '../../drizzle'),
    resolve(process.cwd(), 'drizzle'),
    resolve(process.cwd(), 'apps/server/drizzle'),
  ].filter((p): p is string => Boolean(p));
  const found = candidates.find((p) => existsSync(resolve(p, 'meta/_journal.json')));
  if (!found) throw new Error(`Could not find database migrations (looked in ${candidates.join(', ')})`);
  return found;
}

/**
 * Opens the database. PostgreSQL is the production database.
 * `pglite:` URLs use an embedded WebAssembly build of PostgreSQL — intended for
 * local development and tests only; it runs the same migrations and SQL.
 */
export async function openDatabase(url: string, opts: { poolMax?: number } = {}): Promise<Database> {
  if (url.startsWith('pglite:')) {
    const target = url.slice('pglite:'.length);
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    let client: InstanceType<typeof PGlite>;
    if (target === 'memory' || target === '') {
      client = new PGlite();
    } else {
      const dir = resolve(target);
      mkdirSync(dir, { recursive: true });
      client = new PGlite(dir);
    }
    await client.waitReady;
    const db = drizzle(client, { schema });
    return {
      db: db as unknown as Db,
      kind: 'pglite',
      migrate: async () => {
        await migrate(db, { migrationsFolder: migrationsFolder() });
      },
      ping: async () => {
        try {
          await client.query('select 1');
          return true;
        } catch {
          return false;
        }
      },
      close: async () => {
        await client.close();
      },
    };
  }

  const pool = new pg.Pool({
    connectionString: url,
    max: opts.poolMax ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  const db = drizzlePg(pool, { schema });
  return {
    db,
    kind: 'postgres',
    migrate: async () => {
      await migratePg(db, { migrationsFolder: migrationsFolder() });
    },
    ping: async () => {
      try {
        await db.execute(sql`select 1`);
        return true;
      } catch {
        return false;
      }
    },
    close: async () => {
      await pool.end();
    },
  };
}

export { schema };
