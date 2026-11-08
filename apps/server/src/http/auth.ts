import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt, lt } from 'drizzle-orm';
import { sessions, users } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';
import { randomToken, safeEqual, sha256 } from '../lib/crypto';
import type { AuthUser } from '../context';

export const SESSION_COOKIE = 'wi_session';
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw unauthorized();
  return request.user;
}

export function requireAdmin(request: FastifyRequest): AuthUser {
  const u = requireUser(request);
  if (u.role !== 'admin') throw forbidden('Only administrators can change instance settings.');
  return u;
}

export async function createSession(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const ttl = app.ctx.config.sessionTtlDays * 86_400_000;
  const [row] = await app.ctx.db
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256(token),
      csrfToken,
      ip: request.ip,
      userAgent: request.headers['user-agent']?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + ttl),
    })
    .returning({ id: sessions.id });
  setSessionCookie(app, reply, token);
  request.sessionInfo = { id: row!.id, csrfToken };
  return { id: row!.id, csrfToken };
}

export function setSessionCookie(app: FastifyInstance, reply: FastifyReply, token: string) {
  void reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: app.ctx.config.cookieSecure,
    path: '/',
    maxAge: app.ctx.config.sessionTtlDays * 86_400,
  });
}

export function clearSessionCookie(app: FastifyInstance, reply: FastifyReply) {
  void reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: app.ctx.config.cookieSecure });
}

/** Registers session resolution and CSRF protection for all /api routes. */
export function registerAuthHooks(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionInfo', null);

  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    const token = request.cookies[SESSION_COOKIE];
    if (!token || token.length > 200) return;
    const now = new Date();
    const rows = await app.ctx.db
      .select({
        sessionId: sessions.id,
        csrfToken: sessions.csrfToken,
        lastSeenAt: sessions.lastSeenAt,
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)))
      .limit(1);
    const row = rows[0];
    if (!row) return;
    request.user = { id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.createdAt };
    request.sessionInfo = { id: row.sessionId, csrfToken: row.csrfToken };
    if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const ttl = app.ctx.config.sessionTtlDays * 86_400_000;
      await app.ctx.db
        .update(sessions)
        .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + ttl) })
        .where(eq(sessions.id, row.sessionId));
    }
  });

  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/api/') || SAFE_METHODS.has(request.method)) return;
    // A custom header cannot be set by cross-site forms and forces a CORS preflight,
    // which this API never approves.
    if (request.headers['x-requested-with'] !== 'what-if') {
      throw forbidden('Missing request header. Refresh the page and try again.');
    }
    if (request.sessionInfo) {
      const sent = request.headers['x-csrf-token'];
      if (typeof sent !== 'string' || !safeEqual(sent, request.sessionInfo.csrfToken)) {
        throw forbidden('Your session token is out of date. Refresh the page and try again.');
      }
    }
  });
}

export async function purgeExpiredSessions(app: FastifyInstance) {
  await app.ctx.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
