import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import { openDatabase } from './db/client';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[what-if] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  if (config.isProduction && config.databaseUrl.startsWith('pglite:')) {
    console.warn('[what-if] Running with the embedded development database. Use PostgreSQL (DATABASE_URL=postgres://…) in production.');
  }

  const database = await openDatabase(config.databaseUrl, { poolMax: config.databasePoolMax });
  if (config.migrateOnStart) {
    // Retry briefly so the app can start alongside a database container that is still booting.
    for (let attempt = 1; ; attempt++) {
      try {
        await database.migrate();
        break;
      } catch (err) {
        if (attempt >= 15) throw err;
        console.warn(`[what-if] Database not ready (attempt ${attempt}): ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  const app = await buildApp({ config, database });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await app.close();
      await database.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info({ version: config.version, database: database.kind, ai: config.ai.provider ?? 'none' }, 'What-If is running');
}

main().catch((err) => {
  console.error('[what-if] Fatal error during startup:', err);
  process.exit(1);
});
