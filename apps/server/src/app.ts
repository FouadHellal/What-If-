import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { Config } from './config';
import type { Database } from './db/client';
import type { AppContext } from './context';
import { SecretBox } from './lib/crypto';
import { errorHandler } from './lib/errors';
import { purgeExpiredSessions, registerAuthHooks } from './http/auth';
import { defaultAiFactory, type AiProviderFactory } from './services/ai/provider';
import { authRoutes } from './routes/auth';
import { accountRoutes } from './routes/account';
import { decisionRoutes } from './routes/decisions';
import { journalRoutes } from './routes/journal';
import { aiRoutes } from './routes/ai';
import { reportRoutes } from './routes/reports';

export interface BuildOptions {
  config: Config;
  database: Database;
  aiFactory?: AiProviderFactory;
  logger?: boolean;
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { config, database } = opts;
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'], remove: true },
            ...(config.logPretty ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } } : {}),
          },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  });

  const ctx: AppContext = {
    config,
    database,
    db: database.db,
    secrets: new SecretBox(config.appSecret),
    aiFactory: opts.aiFactory ?? defaultAiFactory,
  };
  app.decorate('ctx', ctx);
  app.setErrorHandler(errorHandler);

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        ...(config.cookieSecure ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.cookieSecure ? { maxAge: 15552000, includeSubDomains: false } : false,
    referrerPolicy: { policy: 'same-origin' },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    allowList: (req) => req.url === '/api/health',
  });

  registerAuthHooks(app);

  // Never cache API responses: they contain personal data.
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/') && !reply.hasHeader('cache-control')) void reply.header('cache-control', 'no-store');
    return payload;
  });

  app.get('/api/health', { logLevel: 'warn' }, async (_req, reply) => {
    const dbOk = await database.ping();
    if (!dbOk) reply.status(503);
    return { status: dbOk ? 'ok' : 'degraded', database: dbOk ? 'ok' : 'unreachable', version: config.version };
  });

  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(decisionRoutes);
  await app.register(journalRoutes);
  await app.register(aiRoutes);
  await app.register(reportRoutes);

  app.all('/api/*', async (_req, reply) => {
    reply.status(404);
    return { error: { code: 'not_found', message: 'Unknown API endpoint.' } };
  });

  // Serve the built web app (single-page app with client-side routing).
  const webDist = config.webDist ? resolve(config.webDist) : null;
  if (webDist && existsSync(resolve(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      index: false,
      maxAge: '365d',
      immutable: true,
      setHeaders: (res, path) => {
        if (path.endsWith('.html')) void res.header('cache-control', 'no-cache');
      },
    });
    const sendIndex = (_req: unknown, reply: { header: (k: string, v: string) => unknown; sendFile: (f: string, opts?: object) => unknown }) => {
      reply.header('cache-control', 'no-cache');
      return reply.sendFile('index.html', { maxAge: 0, immutable: false });
    };
    app.get('/', sendIndex as never);
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/') && !/\.[a-z0-9]{2,5}$/i.test(request.url.split('?')[0]!)) {
        return sendIndex(request, reply as never);
      }
      reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } });
    });
  }

  // Housekeeping: remove expired sessions hourly.
  const timer = setInterval(() => {
    purgeExpiredSessions(app).catch((err) => app.log.warn({ err }, 'Session cleanup failed'));
  }, 3_600_000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));

  return app;
}
