import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  deleteAccountSchema,
  preferencesSchema,
  profileSchema,
  type AuditEventDTO,
  type Baseline,
  type Preferences,
  type ProfileDTO,
  type ProfileInput,
} from '@whatif/shared';
import {
  aiAnalyses,
  appSettings,
  assumptions,
  auditLog,
  decisions,
  journalEntries,
  milestones,
  profiles,
  reports,
  scenarios,
  simulationRuns,
  userSettings,
  users,
} from '../db/schema';
import { audit } from '../lib/audit';
import { verifyPassword } from '../lib/crypto';
import { badRequest, parse } from '../lib/errors';
import { clearSessionCookie, requireAdmin, requireUser } from '../http/auth';
import { hydrateScenarios } from '../services/scenarios';
import { createExample } from '../services/decisions';
import { registrationOpen } from './auth';

type ProfileRow = typeof profiles.$inferSelect;

function profileDTO(p: ProfileRow | undefined): ProfileDTO {
  if (!p) return { currency: 'EUR', goals: [], priorities: {}, onboardingCompleted: false, updatedAt: null };
  return {
    displayName: p.displayName,
    country: p.country,
    city: p.city,
    ageRange: p.ageRange as ProfileInput['ageRange'],
    employmentStatus: p.employmentStatus as ProfileInput['employmentStatus'],
    occupation: p.occupation,
    education: p.education,
    currency: p.currency,
    annualIncome: p.annualIncome,
    effectiveTaxRate: p.effectiveTaxRate,
    monthlyHousingCost: p.monthlyHousingCost,
    monthlyLivingCost: p.monthlyLivingCost,
    savings: p.savings,
    investments: p.investments,
    debt: p.debt,
    monthlyDebtPayment: p.monthlyDebtPayment,
    goals: p.goals,
    priorities: p.priorities,
    riskTolerance: p.riskTolerance as ProfileInput['riskTolerance'],
    planningHorizonYears: p.planningHorizonYears,
    onboardingCompleted: p.onboardingCompleted,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function getProfile(app: FastifyInstance, userId: string): Promise<ProfileDTO> {
  const rows = await app.ctx.db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return profileDTO(rows[0]);
}

export function baselineFromProfile(p: ProfileDTO): Baseline {
  return {
    country: p.country ?? null,
    city: p.city ?? null,
    currency: p.currency ?? null,
    annualIncome: p.annualIncome ?? null,
    effectiveTaxRate: p.effectiveTaxRate ?? null,
    monthlyHousingCost: p.monthlyHousingCost ?? null,
    monthlyLivingCost: p.monthlyLivingCost ?? null,
    savings: p.savings ?? null,
    investments: p.investments ?? null,
    debt: p.debt ?? null,
    monthlyDebtPayment: p.monthlyDebtPayment ?? null,
    planningHorizonYears: p.planningHorizonYears ?? null,
  };
}

export async function getPreferences(app: FastifyInstance, userId: string): Promise<Preferences> {
  const rows = await app.ctx.db.select({ p: userSettings.preferences }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const parsed = preferencesSchema.safeParse(rows[0]?.p ?? {});
  return parsed.success ? parsed.data : {};
}

export async function accountRoutes(app: FastifyInstance) {
  const db = app.ctx.db;

  app.get('/api/profile', async (request) => getProfile(app, requireUser(request).id));

  app.put('/api/profile', async (request) => {
    const user = requireUser(request);
    const input = parse(profileSchema, request.body);
    const values = { ...input, updatedAt: new Date() } as Partial<typeof profiles.$inferInsert>;
    await db
      .insert(profiles)
      .values({ userId: user.id, ...values })
      .onConflictDoUpdate({ target: profiles.userId, set: values });
    await audit(db, request, 'profile.updated', { metadata: { fields: Object.keys(input) } });
    return getProfile(app, user.id);
  });

  app.get('/api/preferences', async (request) => getPreferences(app, requireUser(request).id));

  app.put('/api/preferences', async (request) => {
    const user = requireUser(request);
    const input = parse(preferencesSchema, request.body);
    const current = await getPreferences(app, user.id);
    const next = { ...current, ...input };
    await db
      .insert(userSettings)
      .values({ userId: user.id, preferences: next })
      .onConflictDoUpdate({ target: userSettings.userId, set: { preferences: next, updatedAt: new Date() } });
    return next;
  });

  /** Complete export of the user's data as JSON. Secrets are excluded. */
  app.get('/api/account/export', async (request, reply) => {
    const user = requireUser(request);
    const [profile, prefs, decs, journal, analyses, reps] = await Promise.all([
      getProfile(app, user.id),
      getPreferences(app, user.id),
      db.select().from(decisions).where(eq(decisions.userId, user.id)),
      db.select().from(journalEntries).where(eq(journalEntries.userId, user.id)),
      db.select().from(aiAnalyses).where(eq(aiAnalyses.userId, user.id)),
      db.select({ id: reports.id, decisionId: reports.decisionId, title: reports.title, createdAt: reports.createdAt, snapshot: reports.snapshot }).from(reports).where(eq(reports.userId, user.id)),
    ]);
    const decIds = decs.map((d) => d.id);
    const scenRows = decIds.length ? await db.select().from(scenarios).where(inArray(scenarios.decisionId, decIds)) : [];
    const scen = await hydrateScenarios(db, scenRows);
    const [ms, as, runs] = decIds.length
      ? await Promise.all([
          db.select().from(milestones).where(inArray(milestones.decisionId, decIds)),
          db.select().from(assumptions).where(inArray(assumptions.decisionId, decIds)),
          db
            .select({ id: simulationRuns.id, scenarioId: simulationRuns.scenarioId, scenarioVersion: simulationRuns.scenarioVersion, engineVersion: simulationRuns.engineVersion, inputHash: simulationRuns.inputHash, seed: simulationRuns.seed, runs: simulationRuns.runs, inputs: simulationRuns.inputs, createdAt: simulationRuns.createdAt })
            .from(simulationRuns)
            .where(eq(simulationRuns.userId, user.id)),
        ])
      : [[], [], []];
    await audit(db, request, 'account.exported');
    const body = {
      format: 'what-if-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt.toISOString() },
      profile,
      preferences: prefs,
      decisions: decs.map((d) => ({
        ...d,
        scenarios: scen.filter((s) => s.decisionId === d.id),
        milestones: ms.filter((m) => m.decisionId === d.id),
        assumptions: as.filter((a) => a.decisionId === d.id),
      })),
      simulationRuns: runs,
      journal,
      aiAnalyses: analyses,
      reports: reps,
    };
    void reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="what-if-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return body;
  });

  app.delete('/api/account', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireUser(request);
    const input = parse(deleteAccountSchema, request.body);
    const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!(await verifyPassword(input.password, rows[0]!.passwordHash))) throw badRequest('Your password is incorrect.');
    if (user.role === 'admin') {
      const [{ n }] = (await db.select({ n: count() }).from(users).where(eq(users.role, 'admin'))) as [{ n: number }];
      const [{ m }] = (await db.select({ m: count() }).from(users)) as [{ m: number }];
      if (Number(n) <= 1 && Number(m) > 1) throw badRequest('You are the only administrator. Make another user an administrator before deleting your account.');
    }
    // Everything owned by the user cascades from the users row.
    await db.delete(users).where(eq(users.id, user.id));
    request.log.info({ event: 'account.deleted' }, 'Account deleted');
    clearSessionCookie(app, reply);
    return { ok: true };
  });

  app.get<{ Querystring: { page?: string } }>('/api/account/audit', async (request) => {
    const user = requireUser(request);
    const page = Math.max(1, Math.min(1000, Number(request.query.page ?? 1) || 1));
    const pageSize = 30;
    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.userId, user.id))
      .orderBy(desc(auditLog.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const items: AuditEventDTO[] = rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
      metadata: r.metadata,
    }));
    return { items, page, pageSize };
  });

  app.post('/api/account/example', async (request, reply) => {
    const user = requireUser(request);
    const id = await createExample(db, user.id);
    reply.status(201);
    return { id };
  });

  app.delete('/api/account/examples', async (request) => {
    const user = requireUser(request);
    const res = await db.delete(decisions).where(and(eq(decisions.userId, user.id), eq(decisions.isExample, true))).returning({ id: decisions.id });
    await audit(db, request, 'account.examples_removed', { metadata: { count: res.length } });
    return { removed: res.length };
  });

  // ── Instance administration ─────────────────────────────────────────────
  app.get('/api/admin/settings', async (request) => {
    requireAdmin(request);
    const reg = await registrationOpen(app);
    const [{ n }] = (await db.select({ n: count() }).from(users)) as [{ n: number }];
    return { registrationOpen: reg.open, userCount: Number(n), aiInstanceProvider: app.ctx.config.ai.provider, version: app.ctx.config.version, database: app.ctx.database.kind };
  });

  app.put('/api/admin/settings', async (request) => {
    requireAdmin(request);
    const input = parse(z.object({ registrationOpen: z.boolean() }), request.body);
    await db
      .insert(appSettings)
      .values({ key: 'registration_open', value: input.registrationOpen })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: input.registrationOpen, updatedAt: new Date() } });
    await audit(db, request, 'admin.settings_updated', { metadata: input });
    return { registrationOpen: input.registrationOpen };
  });
}
