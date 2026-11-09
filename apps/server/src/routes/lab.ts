import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ENGINE_VERSION, isVariableKey, simulate, withInput, type ScenarioModel, type SimulationResult } from '@whatif/engine';
import {
  evidenceInputSchema,
  experimentInputSchema,
  parseSettings,
  researchRequestSchema,
  simulationOptions,
  type EvidenceDTO,
  type ExperimentDTO,
  type ExperimentDetailDTO,
  type ExperimentMetrics,
} from '@whatif/shared';
import { evidence, experiments, scenarios } from '../db/schema';
import { AppError, badRequest, conflict, notFound, parse } from '../lib/errors';
import { requireUser } from '../http/auth';
import { getOwnedDecision, insertScenario, touchDecision } from '../services/decisions';
import { ensureRun, loadScenario, toEngineModel, writeModel } from '../services/scenarios';
import { exchangeRate, inflation } from '../services/research';

const idParam = z.object({ id: z.uuid() });

function metrics(r: SimulationResult): ExperimentMetrics {
  const u = r.uncertainty?.hasUncertainty ? r.uncertainty : null;
  return {
    finalNetWorth: r.expected.summary.finalNetWorth,
    p10: u ? u.finalNetWorth.p10 : null,
    p50: u ? u.finalNetWorth.p50 : null,
    p90: u ? u.finalNetWorth.p90 : null,
    shortfallProbability: r.uncertainty ? r.uncertainty.shortfallProbability : null,
    lowestCash: r.expected.summary.lowestCash,
    monthlyNetCashFlowYear1: r.expected.summary.avgMonthlyNetCashFlowYear1,
  };
}

type ExpRow = typeof experiments.$inferSelect;

function experimentDTO(row: ExpRow, scenarioName: string | null, currentVersion: number | null): ExperimentDTO {
  const sum = row.summary as { original: ExperimentMetrics; variant: ExperimentMetrics; currency: string };
  return {
    id: row.id,
    decisionId: row.decisionId,
    scenarioId: row.scenarioId,
    scenarioName,
    name: row.name,
    note: row.note,
    changes: row.changes,
    baseVersion: row.baseVersion,
    stale: currentVersion !== null && currentVersion !== row.baseVersion,
    original: sum.original,
    variant: sum.variant,
    currency: sum.currency,
    engineVersion: row.engineVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

function evidenceDTO(r: typeof evidence.$inferSelect): EvidenceDTO {
  return {
    id: r.id,
    decisionId: r.decisionId,
    scenarioId: r.scenarioId,
    label: r.label,
    value: r.value,
    unit: r.unit,
    sourceName: r.sourceName,
    sourceUrl: r.sourceUrl,
    retrievedOn: r.retrievedOn,
    coverage: r.coverage,
    uncertainty: r.uncertainty,
    note: r.note,
    origin: r.origin,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function labRoutes(app: FastifyInstance) {
  const db = app.ctx.db;

  // ── Experiments ───────────────────────────────────────────────────────
  app.get('/api/decisions/:id/experiments', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    await getOwnedDecision(db, user.id, id);
    const rows = await db
      .select({ e: experiments, name: scenarios.name, version: scenarios.version })
      .from(experiments)
      .innerJoin(scenarios, eq(scenarios.id, experiments.scenarioId))
      .where(and(eq(experiments.decisionId, id), eq(experiments.userId, user.id)))
      .orderBy(desc(experiments.createdAt))
      .limit(100);
    return rows.map((r) => experimentDTO(r.e, r.name, r.version));
  });

  app.post('/api/decisions/:id/experiments', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const input = parse(experimentInputSchema, request.body);
    const decision = await getOwnedDecision(db, user.id, id);
    const scenario = await loadScenario(db, user.id, input.scenarioId);
    if (scenario.decisionId !== id) throw badRequest('That scenario belongs to a different decision.');
    const base = toEngineModel(scenario);
    let variant: ScenarioModel = base;
    for (const [key, value] of Object.entries(input.changes)) {
      const valid = key.startsWith('flow:') ? scenario.flows.some((f) => `flow:${f.id}` === key) : isVariableKey(key);
      if (!valid) throw badRequest(`Unknown input “${key}”.`);
      variant = withInput(variant, key, value);
    }
    const options = simulationOptions(parseSettings(decision.settings), scenario, decision.baseCurrency);
    const original = await ensureRun(db, user.id, scenario);
    const result = simulate(variant, options);
    const [row] = await db
      .insert(experiments)
      .values({
        userId: user.id,
        decisionId: id,
        scenarioId: scenario.id,
        name: input.name,
        note: input.note ?? null,
        changes: input.changes,
        baseVersion: scenario.version,
        baseInputs: base,
        inputs: variant,
        options,
        summary: { original: metrics(original.result), variant: metrics(result), currency: scenario.currency },
        engineVersion: ENGINE_VERSION,
      })
      .returning();
    reply.status(201);
    return experimentDTO(row!, scenario.name, scenario.version);
  });

  app.get('/api/experiments/:id', async (request): Promise<ExperimentDetailDTO> => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const rows = await db
      .select({ e: experiments, name: scenarios.name, version: scenarios.version })
      .from(experiments)
      .innerJoin(scenarios, eq(scenarios.id, experiments.scenarioId))
      .where(and(eq(experiments.id, id), eq(experiments.userId, user.id)))
      .limit(1);
    const r = rows[0];
    if (!r) throw notFound('Experiment');
    return { ...experimentDTO(r.e, r.name, r.version), baseInputs: r.e.baseInputs as ScenarioModel, inputs: r.e.inputs as ScenarioModel };
  });

  app.delete('/api/experiments/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const res = await db.delete(experiments).where(and(eq(experiments.id, id), eq(experiments.userId, user.id))).returning({ id: experiments.id });
    if (!res[0]) throw notFound('Experiment');
    return { ok: true };
  });

  /** Applies an experiment: overwrite the scenario (only if unchanged since) or save it as a new scenario. */
  app.post('/api/experiments/:id/apply', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const { mode } = parse(z.object({ mode: z.enum(['update', 'new']) }), request.body);
    const rows = await db.select().from(experiments).where(and(eq(experiments.id, id), eq(experiments.userId, user.id))).limit(1);
    const exp = rows[0];
    if (!exp) throw notFound('Experiment');
    const scenario = await loadScenario(db, user.id, exp.scenarioId);
    const inputs = exp.inputs as ScenarioModel;
    if (mode === 'update') {
      if (scenario.version !== exp.baseVersion) {
        throw conflict('The scenario has changed since this experiment was run. Save it as a new scenario instead, or re-run the experiment.');
      }
      const updated = await db.transaction(async (tx) => {
        const res = await tx
          .update(scenarios)
          .set({ version: sql`${scenarios.version} + 1`, updatedAt: new Date() })
          .where(and(eq(scenarios.id, scenario.id), eq(scenarios.version, exp.baseVersion)))
          .returning({ id: scenarios.id });
        if (!res[0]) return false;
        await writeModel(tx, scenario.id, { variables: inputs.variables, flows: inputs.flows });
        return true;
      });
      if (!updated) throw conflict('The scenario changed while applying. Please try again.');
      await touchDecision(db, scenario.decisionId);
      return { scenarioId: scenario.id };
    }
    const count = await db.select({ id: scenarios.id }).from(scenarios).where(eq(scenarios.decisionId, scenario.decisionId));
    if (count.length >= 8) throw badRequest('A decision can have at most 8 scenarios. Archive or delete one first.');
    const newId = await db.transaction((tx) =>
      insertScenario(
        tx,
        user.id,
        scenario.decisionId,
        {
          ...scenario,
          name: exp.name.slice(0, 120),
          description: `From Decision Lab experiment on “${scenario.name}”.`,
          isBaseline: false,
          variables: inputs.variables,
          flows: inputs.flows,
          assumptions: [],
        },
        count.length,
        count.length % 8,
      ),
    );
    await touchDecision(db, scenario.decisionId);
    reply.status(201);
    return { scenarioId: newId };
  });

  // ── Evidence & research ───────────────────────────────────────────────
  app.get('/api/decisions/:id/evidence', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    await getOwnedDecision(db, user.id, id);
    const rows = await db.select().from(evidence).where(and(eq(evidence.decisionId, id), eq(evidence.userId, user.id))).orderBy(desc(evidence.createdAt)).limit(200);
    return rows.map(evidenceDTO);
  });

  app.post('/api/decisions/:id/evidence', async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    await getOwnedDecision(db, user.id, id);
    const input = parse(evidenceInputSchema, request.body);
    if (input.scenarioId) {
      const s = await loadScenario(db, user.id, input.scenarioId);
      if (s.decisionId !== id) throw badRequest('That scenario belongs to a different decision.');
    }
    const [row] = await db
      .insert(evidence)
      .values({ userId: user.id, decisionId: id, ...input, scenarioId: input.scenarioId ?? null, unit: input.unit ?? null, sourceUrl: input.sourceUrl ?? null, coverage: input.coverage ?? null, uncertainty: input.uncertainty ?? null, note: input.note ?? null })
      .returning();
    reply.status(201);
    return evidenceDTO(row!);
  });

  app.delete('/api/evidence/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const res = await db.delete(evidence).where(and(eq(evidence.id, id), eq(evidence.userId, user.id))).returning({ id: evidence.id });
    if (!res[0]) throw notFound('Evidence');
    return { ok: true };
  });

  /** Fetches a cited figure from a public data source and stores it as evidence. */
  app.post('/api/decisions/:id/research', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    await getOwnedDecision(db, user.id, id);
    if (!app.ctx.config.externalData) {
      throw new AppError(409, 'research_disabled', 'External data lookups are turned off on this instance (EXTERNAL_DATA=off).');
    }
    const input = parse(researchRequestSchema, request.body);
    const scenarioId = parse(z.object({ scenarioId: z.uuid().nullable().optional() }), request.body).scenarioId ?? null;
    const result = input.kind === 'exchange_rate' ? await exchangeRate(app.ctx.fetch, input.from, input.to) : await inflation(app.ctx.fetch, input.country);
    const [row] = await db
      .insert(evidence)
      .values({ userId: user.id, decisionId: id, scenarioId, ...result, note: null })
      .returning();
    reply.status(201);
    return evidenceDTO(row!);
  });
}
