import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, gte, inArray, isNull, max, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { VARIABLES, addMonths, simulate } from '@whatif/engine';
import {
  assumptionInputSchema,
  createDecisionSchema,
  decisionCategory,
  draftFromQuestion,
  draftFromTemplate,
  listDecisionsQuery,
  milestoneSchema,
  parseQuestionSchema,
  parseSettings,
  recordDecisionSchema,
  scenarioDraftSchema,
  updateDecisionSchema,
  updateMilestoneSchema,
  updateScenarioMetaSchema,
  updateScenarioModelSchema,
  type DecisionDraft,
  type OverviewDTO,
  type Paginated,
  type DecisionSummaryDTO,
} from '@whatif/shared';
import { assumptions, decisions, experiments, journalEntries, milestones, reports, scenarioVariables, scenarios } from '../db/schema';
import { audit } from '../lib/audit';
import { badRequest, conflict, notFound, parse } from '../lib/errors';
import { requireUser } from '../http/auth';
import {
  assumptionDTO,
  createDecision,
  getDecisionDTO,
  insertScenario,
  listDecisionSummaries,
  milestoneDTO,
  summarize,
  touchDecision,
} from '../services/decisions';
import { requireDecision, visibleDecisions } from '../services/access';
import { ensureRun, loadRun, loadScenario, loadScenariosForDecision, toEngineModel, writeModel } from '../services/scenarios';
import { aiDraft } from '../services/ai/service';
import { baselineFromProfile, getProfile } from './account';
import { journalDTO } from './journal';

const idParam = z.object({ id: z.uuid() });

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function decisionRoutes(app: FastifyInstance) {
  const db = app.ctx.db;

  // ── Overview ──────────────────────────────────────────────────────────
  app.get('/api/overview', async (request): Promise<OverviewDTO> => {
    const user = requireUser(request);
    const active = await db
      .select()
      .from(decisions)
      .where(and(visibleDecisions(db, user.id), ne(decisions.status, 'archived')))
      .orderBy(desc(decisions.updatedAt))
      .limit(6);
    const month = currentMonth();
    const [counts, scenCount, journalCount, upcoming, recentScen, recentJournal, decided] = await Promise.all([
      db.select({ n: count() }).from(decisions).where(and(visibleDecisions(db, user.id), ne(decisions.status, 'archived'))),
      db.select({ n: count() }).from(scenarios).where(and(eq(scenarios.userId, user.id), eq(scenarios.status, 'active'))),
      db.select({ n: count() }).from(journalEntries).where(eq(journalEntries.userId, user.id)),
      db
        .select({ m: milestones, decisionTitle: decisions.title, scenarioName: scenarios.name })
        .from(milestones)
        .innerJoin(decisions, eq(decisions.id, milestones.decisionId))
        .leftJoin(scenarios, eq(scenarios.id, milestones.scenarioId))
        .where(and(visibleDecisions(db, user.id), gte(milestones.date, month), eq(milestones.status, 'planned'), ne(decisions.status, 'archived')))
        .orderBy(asc(milestones.date))
        .limit(8),
      db
        .select({ id: scenarios.id, name: scenarios.name, decisionId: scenarios.decisionId, decisionTitle: decisions.title, updatedAt: scenarios.updatedAt, colorIndex: scenarios.colorIndex })
        .from(scenarios)
        .innerJoin(decisions, eq(decisions.id, scenarios.decisionId))
        .where(and(visibleDecisions(db, user.id), eq(scenarios.status, 'active'), ne(decisions.status, 'archived')))
        .orderBy(desc(scenarios.updatedAt))
        .limit(5),
      db
        .select({ j: journalEntries, decisionTitle: decisions.title })
        .from(journalEntries)
        .leftJoin(decisions, eq(decisions.id, journalEntries.decisionId))
        .where(eq(journalEntries.userId, user.id))
        .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
        .limit(4),
      db.select({ n: count() }).from(decisions).where(and(visibleDecisions(db, user.id), eq(decisions.status, 'decided'))),
    ]);
    const hasExample = (await db.select({ id: decisions.id }).from(decisions).where(and(eq(decisions.userId, user.id), eq(decisions.isExample, true))).limit(1)).length > 0;

    // What needs attention — each item leads to an action.
    const attention: OverviewDTO['attention'] = [];
    const openDecisions = await db
      .select({ id: decisions.id, title: decisions.title, status: decisions.status, updatedAt: decisions.updatedAt, decidedAt: decisions.decidedAt })
      .from(decisions)
      .where(and(visibleDecisions(db, user.id), ne(decisions.status, 'archived')))
      .orderBy(desc(decisions.updatedAt))
      .limit(50);
    const openIds = openDecisions.map((d) => d.id);
    if (openIds.length) {
      const important = VARIABLES.filter((d) => d.important && !d.hasSystemDefault).map((d) => d.key);
      const missing = await db
        .select({ decisionId: scenarios.decisionId, n: count() })
        .from(scenarioVariables)
        .innerJoin(scenarios, eq(scenarios.id, scenarioVariables.scenarioId))
        .where(and(inArray(scenarios.decisionId, openIds), eq(scenarios.status, 'active'), isNull(scenarioVariables.value), inArray(scenarioVariables.key, important)))
        .groupBy(scenarios.decisionId);
      const lastCheckins = await db
        .select({ decisionId: journalEntries.decisionId, last: max(journalEntries.entryDate) })
        .from(journalEntries)
        .where(and(eq(journalEntries.userId, user.id), eq(journalEntries.type, 'checkin'), inArray(journalEntries.decisionId, openIds)))
        .groupBy(journalEntries.decisionId);
      const now = Date.now();
      for (const d of openDecisions) {
        const m = missing.find((x) => x.decisionId === d.id);
        if (m && Number(m.n) > 0 && d.status !== 'decided') {
          attention.push({ decisionId: d.id, title: d.title, reason: 'missing_inputs', detail: `${m.n} key assumption${Number(m.n) === 1 ? '' : 's'} still missing — results treat them as zero.` });
          continue;
        }
        if (d.status === 'decided' && d.decidedAt) {
          const last = lastCheckins.find((c) => c.decisionId === d.id)?.last;
          const since = last ? new Date(`${last}T00:00:00Z`).getTime() : d.decidedAt.getTime();
          if (now - since > 90 * 86_400_000) {
            attention.push({ decisionId: d.id, title: d.title, reason: 'checkin_due', detail: last ? 'Last check-in was over three months ago.' : 'No check-in since you decided — compare reality with the plan.' });
          }
          continue;
        }
        if (d.status === 'deciding') {
          attention.push({ decisionId: d.id, title: d.title, reason: 'deciding', detail: 'Marked as deciding — review the summary and record your choice.' });
          continue;
        }
        if (now - d.updatedAt.getTime() > 30 * 86_400_000) {
          attention.push({ decisionId: d.id, title: d.title, reason: 'stale', detail: 'Untouched for over a month. Archive it, or revisit the assumptions.' });
        }
      }
    }
    const [recentExp, recentRep] = await Promise.all([
      db
        .select({ e: experiments, decisionTitle: decisions.title })
        .from(experiments)
        .innerJoin(decisions, eq(decisions.id, experiments.decisionId))
        .where(eq(experiments.userId, user.id))
        .orderBy(desc(experiments.createdAt))
        .limit(5),
      db
        .select({ id: reports.id, title: reports.title, decisionId: reports.decisionId, createdAt: reports.createdAt })
        .from(reports)
        .where(eq(reports.userId, user.id))
        .orderBy(desc(reports.createdAt))
        .limit(4),
    ]);
    const profile = await getProfile(app, user.id);
    const profileFields = [profile.country, profile.city, profile.occupation, profile.annualIncome, profile.effectiveTaxRate, profile.monthlyHousingCost, profile.monthlyLivingCost, profile.savings, profile.riskTolerance, profile.planningHorizonYears];
    const profileCompleteness = Math.round((profileFields.filter((f) => f !== null && f !== undefined && f !== '').length / profileFields.length) * 100);
    return {
      attention: attention.slice(0, 6),
      recentExperiments: recentExp.map((r) => {
        const sum = r.e.summary as { original: { finalNetWorth: number }; variant: { finalNetWorth: number }; currency: string };
        return { id: r.e.id, name: r.e.name, decisionId: r.e.decisionId, decisionTitle: r.decisionTitle, createdAt: r.e.createdAt.toISOString(), delta: sum.variant.finalNetWorth - sum.original.finalNetWorth, currency: sum.currency };
      }),
      recentReports: recentRep.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      profileCompleteness,
      activeDecisions: await summarize(db, active, user.id),
      upcomingMilestones: upcoming.map((u) => ({ ...milestoneDTO(u.m), decisionTitle: u.decisionTitle, scenarioName: u.scenarioName, derived: false })),
      recentScenarios: recentScen.map((s) => ({ ...s, updatedAt: s.updatedAt.toISOString() })),
      recentJournal: recentJournal.map((r) => journalDTO(r.j, r.decisionTitle)),
      counts: {
        decisions: Number(counts[0]?.n ?? 0),
        scenarios: Number(scenCount[0]?.n ?? 0),
        journal: Number(journalCount[0]?.n ?? 0),
        decided: Number(decided[0]?.n ?? 0),
      },
      hasExample,
    };
  });

  // ── Decisions ─────────────────────────────────────────────────────────
  app.get('/api/decisions', async (request): Promise<Paginated<DecisionSummaryDTO>> => {
    const user = requireUser(request);
    const q = parse(listDecisionsQuery, request.query);
    const { items, total } = await listDecisionSummaries(db, user.id, q);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  app.post('/api/decisions/draft', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request): Promise<DecisionDraft> => {
    const user = requireUser(request);
    const input = parse(parseQuestionSchema, request.body);
    const profile = await getProfile(app, user.id);
    const baseline = baselineFromProfile(profile);
    const baseCurrency = profile.currency ?? 'EUR';
    const horizonYears = profile.planningHorizonYears ?? 10;
    if (input.useAi) {
      return aiDraft(app.ctx, user, request, input.question, { baseline, startDate: nextMonth(), baseCurrency, horizonYears, profile });
    }
    return draftFromQuestion(input.question, { baseline, startDate: nextMonth(), baseCurrency, horizonYears });
  });

  app.get<{ Params: { category: string } }>('/api/decisions/templates/:category', async (request): Promise<DecisionDraft> => {
    const user = requireUser(request);
    const category = parse(decisionCategory, request.params.category);
    const profile = await getProfile(app, user.id);
    return draftFromTemplate(category, {
      baseline: baselineFromProfile(profile),
      startDate: nextMonth(),
      baseCurrency: profile.currency ?? 'EUR',
      horizonYears: profile.planningHorizonYears ?? 10,
    });
  });

  app.post('/api/decisions', async (request, reply) => {
    const user = requireUser(request);
    const input = parse(createDecisionSchema, request.body);
    const id = await createDecision(db, user.id, input);
    await audit(db, request, 'decision.created', { entityType: 'decision', entityId: id, metadata: { origin: input.origin, scenarios: input.scenarios.length } });
    reply.status(201);
    return getDecisionDTO(db, user.id, id);
  });

  app.get('/api/decisions/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    return getDecisionDTO(db, user.id, id);
  });

  app.patch('/api/decisions/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const input = parse(updateDecisionSchema, request.body);
    const current = await requireDecision(db, user.id, id, 'edit');
    const { settings: settingsPatch, ...rest } = input;
    const patch: Partial<typeof decisions.$inferInsert> = { ...rest, updatedAt: new Date() };
    if (settingsPatch) {
      const prev = parseSettings(current.settings);
      patch.settings = { ...prev, ...settingsPatch, memory: settingsPatch.memory ? { ...prev.memory, ...settingsPatch.memory } : prev.memory };
    }
    await db.update(decisions).set(patch).where(eq(decisions.id, id));
    return getDecisionDTO(db, user.id, id);
  });

  app.delete('/api/decisions/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const d = await requireDecision(db, user.id, id, 'owner');
    await db.delete(decisions).where(eq(decisions.id, id));
    await audit(db, request, 'decision.deleted', { entityType: 'decision', entityId: id, metadata: { example: d.isExample } });
    return { ok: true };
  });

  /** Records the final decision and pins the chosen scenario's current run for later comparison with reality. */
  app.post('/api/decisions/:id/decide', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const input = parse(recordDecisionSchema, request.body);
    const d = await requireDecision(db, user.id, id, 'edit');
    if (input.chosenScenarioId === null) {
      await db.update(decisions).set({ chosenScenarioId: null, decidedRunId: null, decidedAt: null, status: 'deciding', updatedAt: new Date() }).where(eq(decisions.id, id));
      return getDecisionDTO(db, user.id, id);
    }
    const scenario = await loadScenario(db, user.id, input.chosenScenarioId);
    if (scenario.decisionId !== d.id) throw badRequest('That scenario belongs to a different decision.');
    const run = await ensureRun(db, user.id, scenario);
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(decisions)
        .set({ chosenScenarioId: scenario.id, decidedRunId: run.id, rationale: input.rationale ?? null, expectations: input.expectations ?? null, decidedAt: now, status: 'decided', updatedAt: now })
        .where(eq(decisions.id, id));
      await tx.insert(journalEntries).values({
        userId: user.id,
        decisionId: id,
        scenarioId: scenario.id,
        type: 'decision',
        title: `Decided: ${scenario.name}`,
        body: [input.rationale, input.expectations ? `Expectations: ${input.expectations}` : null].filter(Boolean).join('\n\n'),
        entryDate: now.toISOString().slice(0, 10),
      });
    });
    await audit(db, request, 'decision.decided', { entityType: 'decision', entityId: id, metadata: { scenarioId: scenario.id, runId: run.id } });
    return getDecisionDTO(db, user.id, id);
  });

  // ── Scenarios ─────────────────────────────────────────────────────────
  app.post('/api/decisions/:id/scenarios', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const d = await requireDecision(db, user.id, id, 'edit');
    const body = parse(z.object({ fromScenarioId: z.uuid().optional(), draft: scenarioDraftSchema.optional(), name: z.string().trim().min(1).max(120).optional() }), request.body ?? {});
    const existing = await db.select({ n: count(), p: max(scenarios.position) }).from(scenarios).where(eq(scenarios.decisionId, id));
    const n = Number(existing[0]?.n ?? 0);
    if (n >= 8) throw badRequest('A decision can have at most 8 scenarios. Archive or delete one first.');
    const position = Number(existing[0]?.p ?? -1) + 1;
    let draft;
    if (body.fromScenarioId) {
      const src = await loadScenario(db, user.id, body.fromScenarioId);
      if (src.decisionId !== id) throw badRequest('That scenario belongs to a different decision.');
      draft = { ...src, name: body.name ?? `${src.name} (copy)`, isBaseline: false, flows: src.flows.map((f) => ({ ...f })), assumptions: [] };
    } else if (body.draft) {
      draft = { ...body.draft, isBaseline: n === 0 };
    } else {
      const t = draftFromTemplate('other', { startDate: nextMonth(), baseCurrency: d.baseCurrency, horizonYears: d.horizonYears, baseline: baselineFromProfile(await getProfile(app, user.id)) });
      draft = { ...t.scenarios[1]!, name: body.name ?? 'New scenario', isBaseline: n === 0 };
    }
    const scenarioId = await db.transaction(async (tx) => {
      // Scenarios belong to the decision's owner, whoever adds them.
      const sid = await insertScenario(tx, d.userId, id, draft, position, position % 8);
      if (body.fromScenarioId) {
        const srcAssumptions = await tx.select().from(assumptions).where(eq(assumptions.scenarioId, body.fromScenarioId));
        if (srcAssumptions.length) {
          await tx.insert(assumptions).values(srcAssumptions.map((a) => ({ decisionId: id, scenarioId: sid, text: a.text, category: a.category, source: a.source, likelihood: a.likelihood, impact: a.impact })));
        }
      }
      return sid;
    });
    await touchDecision(db, id);
    reply.status(201);
    return loadScenario(db, user.id, scenarioId);
  });

  app.patch('/api/scenarios/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const input = parse(updateScenarioMetaSchema, request.body);
    const s = await loadScenario(db, user.id, id);
    if (input.isBaseline === false && s.isBaseline) {
      throw badRequest('Every decision needs a baseline. Make another scenario the baseline instead.');
    }
    await db.transaction(async (tx) => {
      if (input.isBaseline === true) {
        await tx.update(scenarios).set({ isBaseline: false }).where(eq(scenarios.decisionId, s.decisionId));
      }
      if (input.status === 'archived' && s.isBaseline) {
        throw badRequest('The baseline cannot be archived. Choose another baseline first.');
      }
      await tx.update(scenarios).set({ ...input, updatedAt: new Date() }).where(eq(scenarios.id, id));
    });
    await touchDecision(db, s.decisionId);
    return loadScenario(db, user.id, id);
  });

  /**
   * Replaces the scenario's model. Requires the version the client last saw;
   * a mismatch (someone else saved in between) returns 409 with the current state.
   */
  app.put('/api/scenarios/:id/model', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const input = parse(updateScenarioModelSchema, request.body);
    // Validate that the engine accepts it before saving anything.
    simulate(toEngineModel(input), { quick: true });
    const s = await loadScenario(db, user.id, id);
    const updated = await db.transaction(async (tx) => {
      const res = await tx
        .update(scenarios)
        .set({
          version: sql`${scenarios.version} + 1`,
          startDate: input.startDate,
          horizonYears: input.horizonYears,
          currency: input.currency,
          exchangeRateToBase: input.exchangeRateToBase,
          exchangeRateSource: input.exchangeRateSource ?? null,
          scores: input.scores ?? s.scores,
          tax: input.tax ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(scenarios.id, id), eq(scenarios.version, input.expectedVersion)))
        .returning({ version: scenarios.version });
      if (!res[0]) return null;
      await writeModel(tx, id, input);
      return res[0];
    });
    if (!updated) {
      const current = await loadScenario(db, user.id, id);
      throw conflict('This scenario was changed elsewhere since you opened it. Your view has been refreshed with the latest version.', { current });
    }
    await touchDecision(db, s.decisionId);
    const fresh = await loadScenario(db, user.id, id);
    const run = await ensureRun(db, user.id, fresh);
    return { ...fresh, latestRun: { id: run.id, scenarioVersion: run.scenarioVersion, engineVersion: run.engineVersion, inputHash: run.inputHash, seed: run.seed, runs: run.runs, createdAt: run.createdAt, durationMs: run.durationMs } };
  });

  app.delete('/api/scenarios/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const s = await loadScenario(db, user.id, id);
    const siblings = await db.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.decisionId, s.decisionId), ne(scenarios.id, id))).orderBy(asc(scenarios.position));
    if (siblings.length === 0) throw badRequest('A decision needs at least one scenario. Delete the decision instead.');
    await db.transaction(async (tx) => {
      await tx.delete(scenarios).where(eq(scenarios.id, id));
      if (s.isBaseline) await tx.update(scenarios).set({ isBaseline: true }).where(eq(scenarios.id, siblings[0]!.id));
    });
    await touchDecision(db, s.decisionId);
    await audit(db, request, 'scenario.deleted', { entityType: 'scenario', entityId: id });
    return { ok: true };
  });

  app.get('/api/scenarios/:id/simulation', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const s = await loadScenario(db, user.id, id, 'view');
    return ensureRun(db, user.id, s);
  });

  app.get('/api/scenarios/:id/runs', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    await loadScenario(db, user.id, id, 'view');
    const { simulationRuns } = await import('../db/schema');
    const rows = await db
      .select({ id: simulationRuns.id, scenarioVersion: simulationRuns.scenarioVersion, engineVersion: simulationRuns.engineVersion, inputHash: simulationRuns.inputHash, seed: simulationRuns.seed, runs: simulationRuns.runs, createdAt: simulationRuns.createdAt, durationMs: simulationRuns.durationMs })
      .from(simulationRuns)
      .where(eq(simulationRuns.scenarioId, id))
      .orderBy(desc(simulationRuns.createdAt))
      .limit(50);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });

  app.get('/api/runs/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    return loadRun(db, user.id, id);
  });

  /** Re-executes a stored run from its saved inputs and confirms the result is identical. */
  app.post('/api/runs/:id/verify', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const run = await loadRun(db, user.id, id);
    const { ENGINE_VERSION, stableStringify } = await import('@whatif/engine');
    if (run.engineVersion !== ENGINE_VERSION) {
      return { reproducible: null, reason: `Stored with engine ${run.engineVersion}; this server runs ${ENGINE_VERSION}.` };
    }
    const again = simulate(run.inputs.model, run.inputs.options);
    // jsonb normalises key order, so compare canonical serialisations.
    const same = stableStringify(again) === stableStringify(run.result);
    return { reproducible: same, inputHash: again.inputHash };
  });

  // ── Assumptions (qualitative) ─────────────────────────────────────────
  app.post('/api/decisions/:id/assumptions', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    await requireDecision(db, user.id, id, 'edit');
    const input = parse(assumptionInputSchema.extend({ scenarioId: z.uuid().nullable().optional() }), request.body);
    if (input.scenarioId) await assertScenarioInDecision(input.scenarioId, id);
    const [row] = await db
      .insert(assumptions)
      .values({ decisionId: id, scenarioId: input.scenarioId ?? null, text: input.text, category: input.category, source: input.source, likelihood: input.likelihood ?? null, impact: input.impact ?? null })
      .returning();
    await touchDecision(db, id);
    reply.status(201);
    return assumptionDTO(row!);
  });

  app.patch('/api/assumptions/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const input = parse(assumptionInputSchema.partial(), request.body);
    const row = await ownedAssumption(user.id, id);
    const [updated] = await db.update(assumptions).set(input).where(eq(assumptions.id, row.id)).returning();
    return assumptionDTO(updated!);
  });

  app.delete('/api/assumptions/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const row = await ownedAssumption(user.id, id);
    await db.delete(assumptions).where(eq(assumptions.id, row.id));
    return { ok: true };
  });

  // ── Milestones ────────────────────────────────────────────────────────
  app.post('/api/decisions/:id/milestones', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    await requireDecision(db, user.id, id, 'edit');
    const input = parse(milestoneSchema, request.body);
    if (input.scenarioId) await assertScenarioInDecision(input.scenarioId, id);
    const [row] = await db
      .insert(milestones)
      .values({ decisionId: id, scenarioId: input.scenarioId ?? null, title: input.title, description: input.description ?? null, date: input.date, status: input.status, achievedOn: input.achievedOn ?? null })
      .returning();
    await touchDecision(db, id);
    reply.status(201);
    return milestoneDTO(row!);
  });

  app.patch('/api/milestones/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const input = parse(updateMilestoneSchema, request.body);
    const row = await ownedMilestone(user.id, id);
    if (input.scenarioId) await assertScenarioInDecision(input.scenarioId, row.decisionId);
    const [updated] = await db.update(milestones).set({ ...input, updatedAt: new Date() }).where(eq(milestones.id, id)).returning();
    return milestoneDTO(updated!);
  });

  app.delete('/api/milestones/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    await ownedMilestone(user.id, id);
    await db.delete(milestones).where(eq(milestones.id, id));
    return { ok: true };
  });

  /** The caller has already checked access to the decision. */
  async function assertScenarioInDecision(scenarioId: string, decisionId: string) {
    const rows = await db.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.id, scenarioId), eq(scenarios.decisionId, decisionId))).limit(1);
    if (!rows[0]) throw badRequest('That scenario does not belong to this decision.');
  }

  async function ownedAssumption(userId: string, id: string) {
    const rows = await db.select().from(assumptions).where(eq(assumptions.id, id)).limit(1);
    if (!rows[0]) throw notFound('Assumption');
    await requireDecision(db, userId, rows[0].decisionId, 'edit').catch((e: { statusCode?: number }) => {
      throw e.statusCode === 404 ? notFound('Assumption') : e;
    });
    return rows[0];
  }

  async function ownedMilestone(userId: string, id: string) {
    const rows = await db.select().from(milestones).where(eq(milestones.id, id)).limit(1);
    if (!rows[0]) throw notFound('Milestone');
    await requireDecision(db, userId, rows[0].decisionId, 'edit').catch((e: { statusCode?: number }) => {
      throw e.statusCode === 404 ? notFound('Milestone') : e;
    });
    return rows[0];
  }

}

function nextMonth(): string {
  const d = new Date();
  const n = d.getUTCFullYear() * 12 + d.getUTCMonth() + 1;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
}
