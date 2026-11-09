import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().default('pglite:./.data/pglite'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  APP_SECRET: z.string().optional(),
  PUBLIC_URL: z.string().optional(),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  TRUST_PROXY: bool(false),
  ALLOW_REGISTRATION: bool(true),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: bool(false),
  MIGRATE_ON_START: bool(true),
  WEB_DIST: z.string().optional(),
  SCRYPT_COST: z.coerce.number().int().min(1024).max(1_048_576).default(32_768),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(100_000).default(600),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(10),
  // Instance-wide AI defaults (optional). Users can also bring their own provider.
  AI_PROVIDER: z.enum(['openai', 'anthropic', 'ollama', '']).optional(),
  AI_BASE_URL: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_DAILY_LIMIT: z.coerce.number().int().min(1).max(10_000).default(50),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(90_000),
  AI_ALLOW_USER_CONFIG: bool(true),
  EXTERNAL_DATA: z.enum(['on', 'off']).default('on'),
});

export type Env = z.infer<typeof envSchema>;

export interface Config {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  host: string;
  port: number;
  databaseUrl: string;
  databasePoolMax: number;
  appSecret: string;
  publicUrl: string | null;
  cookieSecure: boolean;
  trustProxy: boolean;
  allowRegistration: boolean;
  sessionTtlDays: number;
  logLevel: Env['LOG_LEVEL'];
  logPretty: boolean;
  migrateOnStart: boolean;
  webDist: string | null;
  scryptCost: number;
  rateLimitPerMinute: number;
  /** Allow user-triggered lookups of public data (ECB exchange rates, World Bank inflation). */
  externalData: boolean;
  authRateLimitPerMinute: number;
  ai: {
    provider: 'openai' | 'anthropic' | 'ollama' | null;
    baseUrl: string | null;
    model: string | null;
    apiKey: string | null;
    dailyLimit: number;
    timeoutMs: number;
    allowUserConfig: boolean;
  };
  version: string;
}

export class ConfigError extends Error {}

function resolveSecret(env: Env, dataDir: string): string {
  if (env.APP_SECRET) {
    if (env.APP_SECRET.length < 32) throw new ConfigError('APP_SECRET must be at least 32 characters long.');
    return env.APP_SECRET;
  }
  if (env.NODE_ENV === 'production') {
    throw new ConfigError('APP_SECRET is required in production. Generate one with: openssl rand -base64 48');
  }
  if (env.NODE_ENV === 'test') return 'test-secret-test-secret-test-secret-0000';
  // Development: persist a generated secret so encrypted values survive restarts.
  const file = resolve(dataDir, 'app-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dirname(file), { recursive: true });
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function loadConfig(source: Record<string, string | undefined> = process.env, overrides: Partial<Config> = {}): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid configuration — ${msg}`);
  }
  const env = parsed.data;
  const publicUrl = env.PUBLIC_URL?.replace(/\/$/, '') || null;
  const cookieSecure = env.COOKIE_SECURE === 'auto' ? Boolean(publicUrl?.startsWith('https://')) : env.COOKIE_SECURE === 'true';
  const provider = env.AI_PROVIDER ? env.AI_PROVIDER : null;
  const cfg: Config = {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    host: env.HOST,
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    databasePoolMax: env.DATABASE_POOL_MAX,
    appSecret: resolveSecret(env, resolve(process.cwd(), '.data')),
    publicUrl,
    cookieSecure,
    trustProxy: env.TRUST_PROXY,
    allowRegistration: env.ALLOW_REGISTRATION,
    sessionTtlDays: env.SESSION_TTL_DAYS,
    logLevel: env.LOG_LEVEL,
    logPretty: env.LOG_PRETTY,
    migrateOnStart: env.MIGRATE_ON_START,
    webDist: env.WEB_DIST ?? null,
    scryptCost: env.SCRYPT_COST,
    rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
    externalData: env.EXTERNAL_DATA === 'on',
    authRateLimitPerMinute: env.AUTH_RATE_LIMIT_PER_MINUTE,
    ai: {
      provider,
      baseUrl: env.AI_BASE_URL || null,
      model: env.AI_MODEL || null,
      apiKey: env.AI_API_KEY || null,
      dailyLimit: env.AI_DAILY_LIMIT,
      timeoutMs: env.AI_TIMEOUT_MS,
      allowUserConfig: env.AI_ALLOW_USER_CONFIG,
    },
    version: process.env.APP_VERSION ?? '2.0.0',
    ...overrides,
  };
  return cfg;
}
