import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { openDatabase, type Database } from '../src/db/client';
import type { AiCompletion, AiCompletionRequest, AiProviderFactory } from '../src/services/ai/provider';

export interface FakeAi {
  factory: AiProviderFactory;
  calls: AiCompletionRequest[];
  respond: (req: AiCompletionRequest) => Promise<AiCompletion> | AiCompletion;
}

export function fakeAi(): FakeAi {
  const fake: FakeAi = {
    calls: [],
    respond: () => ({ text: '{"summary":"ok","points":[]}', model: 'fake-1', inputTokens: 10, outputTokens: 5 }),
    factory: (cfg) => ({
      name: cfg.provider,
      model: cfg.model,
      complete: async (req) => {
        fake.calls.push(req);
        return fake.respond(req);
      },
    }),
  };
  return fake;
}

export interface TestApp {
  app: FastifyInstance;
  database: Database;
  config: Config;
  ai: FakeAi;
  close: () => Promise<void>;
}

let shared: Database | null = null;

/** One embedded PostgreSQL per test file; each test file gets fresh schema via migrations. */
export async function createTestApp(overrides: Partial<Config> = {}, env: Record<string, string> = {}): Promise<TestApp> {
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', SCRYPT_COST: '1024', AUTH_RATE_LIMIT_PER_MINUTE: '1000', RATE_LIMIT_PER_MINUTE: '100000', ...env }, overrides);
  const database = await openDatabase('pglite:memory');
  await database.migrate();
  shared = database;
  const ai = fakeAi();
  const app = await buildApp({ config, database, aiFactory: ai.factory, logger: false });
  await app.ready();
  return {
    app,
    database,
    config,
    ai,
    close: async () => {
      await app.close();
      await database.close();
      shared = null;
    },
  };
}

export class Client {
  cookie = '';
  csrf = '';
  constructor(private readonly app: FastifyInstance) {}

  async request(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.cookie) headers.cookie = this.cookie;
    if (method !== 'GET') {
      headers['x-requested-with'] ??= 'what-if';
      if (this.csrf) headers['x-csrf-token'] ??= this.csrf;
    }
    const res = await this.app.inject({ method, url, headers, ...(body !== undefined ? { payload: body as object } : {}) });
    const set = res.headers['set-cookie'];
    const list = Array.isArray(set) ? set : set ? [set] : [];
    for (const c of list) {
      const m = /^wi_session=([^;]*)/.exec(c);
      if (m) this.cookie = m[1] ? `wi_session=${m[1]}` : '';
    }
    return res;
  }

  get = (url: string) => this.request('GET', url);
  post = (url: string, body?: unknown) => this.request('POST', url, body ?? {});
  put = (url: string, body?: unknown) => this.request('PUT', url, body ?? {});
  patch = (url: string, body?: unknown) => this.request('PATCH', url, body ?? {});
  del = (url: string, body?: unknown) => this.request('DELETE', url, body);

  async register(email: string, password = 'correct horse battery', name = 'Test User') {
    const res = await this.post('/api/auth/register', { email, password, name });
    if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
    this.csrf = res.json().csrfToken;
    return res.json();
  }

  async login(email: string, password = 'correct horse battery') {
    const res = await this.post('/api/auth/login', { email, password });
    if (res.statusCode === 200) this.csrf = res.json().csrfToken;
    return res;
  }
}

export function json<T = any>(res: LightMyRequestResponse): T {
  return res.json() as T;
}

export { shared };
