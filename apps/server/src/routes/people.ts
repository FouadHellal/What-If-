/**
 * People on this instance: administrators create accounts for others, and the
 * owner of a decision can share it with other users as editor or viewer.
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  adminCreateUserSchema,
  adminResetPasswordSchema,
  adminUpdateUserSchema,
  shareDecisionSchema,
  updateShareSchema,
  type AdminUserDTO,
  type DecisionPeopleDTO,
  type PersonDTO,
} from '@whatif/shared';
import { decisionMembers, decisions, profiles, sessions, userSettings, users } from '../db/schema';
import { audit } from '../lib/audit';
import { hashPassword } from '../lib/crypto';
import { badRequest, conflict, notFound, parse } from '../lib/errors';
import { requireAdmin, requireUser } from '../http/auth';
import { requireDecision } from '../services/access';
import { decisionPeople, touchDecision } from '../services/decisions';
import { userDTO } from './auth';

const idParam = z.object({ id: z.uuid() });
const memberParam = z.object({ id: z.uuid(), userId: z.uuid() });

export async function peopleRoutes(app: FastifyInstance) {
  const db = app.ctx.db;

  // ── Directory: who you can share with ─────────────────────────────────
  app.get('/api/people', async (request): Promise<PersonDTO[]> => {
    const user = requireUser(request);
    return db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(ne(users.id, user.id)).orderBy(asc(users.name)).limit(500);
  });

  // ── Sharing a decision ────────────────────────────────────────────────
  app.get('/api/decisions/:id/people', async (request): Promise<DecisionPeopleDTO> => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const d = await requireDecision(db, user.id, id, 'view');
    return decisionPeople(db, d);
  });

  app.post('/api/decisions/:id/people', async (request, reply): Promise<DecisionPeopleDTO> => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const input = parse(shareDecisionSchema, request.body);
    const d = await requireDecision(db, user.id, id, 'owner');
    if (input.userId === d.userId) throw badRequest('You already own this decision.');
    const target = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
    if (!target[0]) throw notFound('User');
    await db
      .insert(decisionMembers)
      .values({ decisionId: id, userId: input.userId, role: input.role, addedBy: user.id })
      .onConflictDoUpdate({ target: [decisionMembers.decisionId, decisionMembers.userId], set: { role: input.role } });
    await touchDecision(db, id);
    await audit(db, request, 'decision.shared', { entityType: 'decision', entityId: id, metadata: { with: input.userId, role: input.role } });
    reply.status(201);
    return decisionPeople(db, d);
  });

  app.patch('/api/decisions/:id/people/:userId', async (request): Promise<DecisionPeopleDTO> => {
    const user = requireUser(request);
    const { id, userId } = parse(memberParam, request.params);
    const input = parse(updateShareSchema, request.body);
    const d = await requireDecision(db, user.id, id, 'owner');
    const res = await db
      .update(decisionMembers)
      .set({ role: input.role })
      .where(and(eq(decisionMembers.decisionId, id), eq(decisionMembers.userId, userId)))
      .returning({ userId: decisionMembers.userId });
    if (!res[0]) throw notFound('Member');
    await audit(db, request, 'decision.share_changed', { entityType: 'decision', entityId: id, metadata: { with: userId, role: input.role } });
    return decisionPeople(db, d);
  });

  /** The owner removes someone, or a member leaves a decision shared with them. */
  app.delete('/api/decisions/:id/people/:userId', async (request) => {
    const user = requireUser(request);
    const { id, userId } = parse(memberParam, request.params);
    await requireDecision(db, user.id, id, userId === user.id ? 'view' : 'owner');
    const res = await db
      .delete(decisionMembers)
      .where(and(eq(decisionMembers.decisionId, id), eq(decisionMembers.userId, userId)))
      .returning({ userId: decisionMembers.userId });
    if (!res[0]) throw notFound('Member');
    await audit(db, request, userId === user.id ? 'decision.left' : 'decision.unshared', { entityType: 'decision', entityId: id, metadata: { with: userId } });
    return { ok: true };
  });

  // ── Administration: accounts ──────────────────────────────────────────
  app.get('/api/admin/users', async (request): Promise<AdminUserDTO[]> => {
    requireAdmin(request);
    const rows = await db
      .select({ u: users, decisions: count(decisions.id) })
      .from(users)
      .leftJoin(decisions, eq(decisions.userId, users.id))
      .groupBy(users.id)
      .orderBy(asc(users.createdAt));
    const now = new Date();
    return rows.map((r) => ({
      ...userDTO(r.u),
      lastLoginAt: r.u.lastLoginAt?.toISOString() ?? null,
      decisions: Number(r.decisions),
      locked: Boolean(r.u.lockedUntil && r.u.lockedUntil > now),
    }));
  });

  app.post('/api/admin/users', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    requireAdmin(request);
    const input = parse(adminCreateUserSchema, request.body);
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existing[0]) throw conflict('An account with this email already exists.');
    const passwordHash = await hashPassword(input.password, app.ctx.config.scryptCost);
    const created = await db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({ email: input.email, name: input.name, passwordHash, role: input.role }).returning();
      await tx.insert(profiles).values({ userId: u!.id, displayName: input.name });
      await tx.insert(userSettings).values({ userId: u!.id });
      return u!;
    });
    await audit(db, request, 'admin.user_created', { entityType: 'user', entityId: created.id, metadata: { role: input.role } });
    reply.status(201);
    return userDTO(created);
  });

  app.patch('/api/admin/users/:id', async (request) => {
    const admin = requireAdmin(request);
    const { id } = parse(idParam, request.params);
    const input = parse(adminUpdateUserSchema, request.body);
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    const target = rows[0];
    if (!target) throw notFound('User');
    if (input.role === 'member' && target.role === 'admin') {
      if (id === admin.id) throw badRequest('You cannot remove your own administrator role. Ask another administrator.');
      await assertAnotherAdmin(id);
    }
    const [u] = await db.update(users).set({ ...input, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    await audit(db, request, 'admin.user_updated', { entityType: 'user', entityId: id, metadata: input });
    return userDTO(u!);
  });

  /** Sets a new password, unlocks the account and signs the user out everywhere. */
  app.post('/api/admin/users/:id/password', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    requireAdmin(request);
    const { id } = parse(idParam, request.params);
    const input = parse(adminResetPasswordSchema, request.body);
    const res = await db
      .update(users)
      .set({ passwordHash: await hashPassword(input.password, app.ctx.config.scryptCost), failedLogins: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!res[0]) throw notFound('User');
    await db.delete(sessions).where(eq(sessions.userId, id));
    await audit(db, request, 'admin.password_reset', { entityType: 'user', entityId: id });
    return { ok: true };
  });

  app.delete('/api/admin/users/:id', async (request) => {
    const admin = requireAdmin(request);
    const { id } = parse(idParam, request.params);
    if (id === admin.id) throw badRequest('Delete your own account from Settings → Data & privacy instead.');
    const rows = await db.select({ role: users.role }).from(users).where(eq(users.id, id)).limit(1);
    if (!rows[0]) throw notFound('User');
    if (rows[0].role === 'admin') await assertAnotherAdmin(id);
    // Their decisions, journal and runs cascade from the users row; shares with them are removed.
    await db.delete(users).where(eq(users.id, id));
    await audit(db, request, 'admin.user_deleted', { entityType: 'user', entityId: id });
    return { ok: true };
  });

  async function assertAnotherAdmin(exceptId: string) {
    const [{ n }] = (await db.select({ n: count() }).from(users).where(and(eq(users.role, 'admin'), ne(users.id, exceptId)))) as [{ n: number }];
    if (Number(n) < 1) throw badRequest('This is the only administrator. Make someone else an administrator first.');
  }
}
