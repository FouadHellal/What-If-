import type { Config } from './config';
import type { Database, Db } from './db/client';
import type { SecretBox } from './lib/crypto';
import type { AiProviderFactory } from './services/ai/provider';

export interface AppContext {
  config: Config;
  database: Database;
  db: Db;
  secrets: SecretBox;
  aiFactory: AiProviderFactory;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  createdAt: Date;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    user: AuthUser | null;
    sessionInfo: { id: string; csrfToken: string } | null;
  }
}
