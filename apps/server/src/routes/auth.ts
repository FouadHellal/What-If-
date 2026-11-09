import type { FastifyInstance } from 'fastify';
import { and, count, eq, ne } from 'drizzle-orm';
import { changePasswordSchema, loginSchema, registerSchema, type SessionDTO, type UserDTO } from '@whatif/shared';
import { appSettings, profiles, sessions, userSettings, users } from '../db/schema';
import { audit } from '../lib/audit';
import { hashPassword, needsRehash, sha256, verifyPassword } from '../lib/crypto';
import { AppError, badRequest, conflict, forbidden, notFound, parse, unauthorized } from '../lib/errors';
import { SESSION_COOKIE, clearSessionCookie, createSession, requireUser } from '../http/auth';
import { getProfile, getPreferences } from './account';

const MAX_FAILED = 10;
const LOCK_MINUTES = 15;

export function userDTO(u: { id: string; email: string; name: string; role: 'admin' | 'member'; createdAt: Date }): UserDTO {
  return { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt.toISOString() };
}

export async function registrationOpen(app: FastifyInstance): Promise<{ open: boolean; hasUsers: boolean }> {
  const [{ n }] = (await app.ctx.db.select({ n: count() }).from(users)) as [{ n: number }];
  const hasUsers = Number(n) > 0;
  if (!hasUsers) return { open: true, hasUsers };
  const rows = await app.ctx.db.select().from(appSettings).where(eq(appSettings.key, 'registration_open')).limit(1);
  const setting = rows[0]?.value;
  return { open: typeof setting === 'boolean' ? setting : app.ctx.config.allowRegistration, hasUsers };
}

export async function authRoutes(app: FastifyInstance) {
  const authLimit = { rateLimit: { max: app.ctx.config.authRateLimitPerMinute, timeWindow: '1 minute' } };

  app.get('/api/auth/status', async () => {
    const r = await registrationOpen(app);
    return { registrationOpen: r.open, hasUsers: r.hasUsers, version: app.ctx.config.version };
  });

  app.get('/api/auth/session', async (request): Promise<SessionDTO> => {
    const user = requireUser(request);
    const [profile, preferences] = await Promise.all([getProfile(app, user.id), getPreferences(app, user.id)]);
    return { user: userDTO(user), profile, preferences, csrfToken: request.sessionInfo!.csrfToken };
  });

  app.post('/api/auth/register', { config: authLimit }, async (request, reply) => {
    const input = parse(registerSchema, request.body);
    const reg = await registrationOpen(app);
    if (!reg.open) throw forbidden('Registration is closed on this instance. Ask the administrator for an account.');
    const existing = await app.ctx.db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existing[0]) throw conflict('An account with this email already exists.');
    const passwordHash = await hashPassword(input.password, app.ctx.config.scryptCost);
    const user = await app.ctx.db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ email: input.email, name: input.name, passwordHash, role: reg.hasUsers ? 'member' : 'admin', lastLoginAt: new Date() })
        .returning();
      await tx.insert(profiles).values({ userId: u!.id, displayName: input.name });
      await tx.insert(userSettings).values({ userId: u!.id });
      return u!;
    });
    const s = await createSession(app, request, reply, user.id);
    request.user = { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt };
    await audit(app.ctx.db, request, 'auth.register', { userId: user.id });
    reply.status(201);
    const [profile, preferences] = await Promise.all([getProfile(app, user.id), getPreferences(app, user.id)]);
    return { user: userDTO(user), profile, preferences, csrfToken: s.csrfToken } satisfies SessionDTO;
  });

  app.post('/api/auth/login', { config: authLimit }, async (request, reply) => {
    const input = parse(loginSchema, request.body);
    const rows = await app.ctx.db.select().from(users).where(eq(users.email, input.email)).limit(1);
    const user = rows[0];
    const invalid = new AppError(401, 'invalid_credentials', 'The email or password is incorrect.');
    if (!user) {
      // Spend comparable time so response timing does not reveal whether the account exists.
      await hashPassword(input.password, app.ctx.config.scryptCost);
      await audit(app.ctx.db, request, 'auth.login_failed', { metadata: { reason: 'unknown_email' } });
      throw invalid;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(429, 'account_locked', `Too many failed attempts. Try again after ${user.lockedUntil.toISOString().slice(11, 16)} UTC.`);
    }
    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLogins + 1;
      const lock = failed >= MAX_FAILED;
      await app.ctx.db
        .update(users)
        .set({ failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
        .where(eq(users.id, user.id));
      await audit(app.ctx.db, request, lock ? 'auth.locked' : 'auth.login_failed', { userId: user.id });
      throw invalid;
    }
    const patch: Partial<typeof users.$inferInsert> = { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() };
    if (needsRehash(user.passwordHash, app.ctx.config.scryptCost)) patch.passwordHash = await hashPassword(input.password, app.ctx.config.scryptCost);
    await app.ctx.db.update(users).set(patch).where(eq(users.id, user.id));
    const s = await createSession(app, request, reply, user.id);
    request.user = { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt };
    await audit(app.ctx.db, request, 'auth.login', { userId: user.id });
    const [profile, preferences] = await Promise.all([getProfile(app, user.id), getPreferences(app, user.id)]);
    return { user: userDTO(user), profile, preferences, csrfToken: s.csrfToken } satisfies SessionDTO;
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await app.ctx.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
    if (request.user) await audit(app.ctx.db, request, 'auth.logout');
    clearSessionCookie(app, reply);
    return { ok: true };
  });

  app.post('/api/auth/password', { config: authLimit }, async (request) => {
    const user = requireUser(request);
    const input = parse(changePasswordSchema, request.body);
    const rows = await app.ctx.db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!(await verifyPassword(input.currentPassword, rows[0]!.passwordHash))) throw badRequest('Your current password is incorrect.');
    if (input.currentPassword === input.newPassword) throw badRequest('Choose a password different from your current one.');
    await app.ctx.db.update(users).set({ passwordHash: await hashPassword(input.newPassword, app.ctx.config.scryptCost), updatedAt: new Date() }).where(eq(users.id, user.id));
    // Sign out everywhere else.
    await app.ctx.db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, request.sessionInfo!.id)));
    await audit(app.ctx.db, request, 'auth.password_changed');
    return { ok: true };
  });

  app.get('/api/auth/sessions', async (request) => {
    const user = requireUser(request);
    const rows = await app.ctx.db.select().from(sessions).where(eq(sessions.userId, user.id));
    return rows
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
      .map((s) => ({
        id: s.id,
        current: s.id === request.sessionInfo?.id,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      }));
  });

  app.delete<{ Params: { id: string } }>('/api/auth/sessions/:id', async (request) => {
    const user = requireUser(request);
    const res = await app.ctx.db.delete(sessions).where(and(eq(sessions.id, request.params.id), eq(sessions.userId, user.id))).returning({ id: sessions.id });
    if (!res[0]) throw notFound('Session');
    await audit(app.ctx.db, request, 'auth.session_revoked', { entityType: 'session', entityId: request.params.id });
    return { ok: true };
  });

  app.post('/api/auth/sessions/revoke-others', async (request) => {
    const user = requireUser(request);
    if (!request.sessionInfo) throw unauthorized();
    const res = await app.ctx.db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, request.sessionInfo.id))).returning({ id: sessions.id });
    await audit(app.ctx.db, request, 'auth.session_revoked', { metadata: { count: res.length } });
    return { revoked: res.length };
  });
}
