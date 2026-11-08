import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  DEFAULT_RUNS,
  DEFAULT_SEED,
  ENGINE_VERSION,
  hashInputs,
  isVariableKey,
  simulate,
  type FlowInput,
  type ScenarioModel,
  type SimulationResult,
  type VariableInput,
  type VariableKey,
} from '@whatif/engine';
import type { ScenarioDTO, ScenarioModelInput, SimulationRunDTO, SimulationRunMeta, ValueSourceT } from '@whatif/shared';
import type { Db } from '../db/client';
import { scenarioFlows, scenarioVariables, scenarios, simulationResults, simulationRuns } from '../db/schema';
import { notFound } from '../lib/errors';

type ScenarioRow = typeof scenarios.$inferSelect;
type VariableRow = typeof scenarioVariables.$inferSelect;
type FlowRow = typeof scenarioFlows.$inferSelect;
type RunRow = typeof simulationRuns.$inferSelect;

// Transactions expose the same query API as the database handle.
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;

export function variablesFromRows(rows: VariableRow[]): Partial<Record<VariableKey, VariableInput>> {
  const out: Partial<Record<VariableKey, VariableInput>> = {};
  for (const r of rows) {
    if (!isVariableKey(r.key)) continue;
    const v: VariableInput = { value: r.value, source: r.source as ValueSourceT };
    if (r.low !== null) v.low = r.low;
    if (r.high !== null) v.high = r.high;
    if (r.note) v.note = r.note;
    out[r.key] = v;
  }
  return out;
}

export function flowsFromRows(rows: FlowRow[]): FlowInput[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((r) => {
      const f: FlowInput = {
        id: r.clientId,
        kind: r.kind as FlowInput['kind'],
        label: r.label,
        amount: r.amount,
        amountMode: r.amountMode as 'fixed' | 'percent_of_income',
        startMonth: r.startMonth,
        endMonth: r.endMonth,
        annualGrowth: r.annualGrowth,
        source: r.source as ValueSourceT,
      };
      if (r.low !== null) f.low = r.low;
      if (r.high !== null) f.high = r.high;
      if (r.note) f.note = r.note;
      return f;
    });
}

export function runMeta(r: RunRow): SimulationRunMeta {
  return {
    id: r.id,
    scenarioVersion: r.scenarioVersion,
    engineVersion: r.engineVersion,
    inputHash: r.inputHash,
    seed: r.seed,
    runs: r.runs,
    createdAt: r.createdAt.toISOString(),
    durationMs: r.durationMs,
  };
}

export function toScenarioDTO(row: ScenarioRow, vars: VariableRow[], flows: FlowRow[], latestRun: RunRow | null): ScenarioDTO {
  return {
    id: row.id,
    decisionId: row.decisionId,
    name: row.name,
    description: row.description,
    isBaseline: row.isBaseline,
    status: row.status as 'active' | 'archived',
    colorIndex: row.colorIndex,
    position: row.position,
    version: row.version,
    startDate: row.startDate,
    horizonYears: row.horizonYears,
    currency: row.currency,
    exchangeRateToBase: row.exchangeRateToBase,
    exchangeRateSource: (row.exchangeRateSource as ValueSourceT | null) ?? null,
    variables: variablesFromRows(vars),
    flows: flowsFromRows(flows),
    scores: row.scores,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    latestRun: latestRun ? runMeta(latestRun) : null,
  };
}

/** The exact engine input for a scenario. The exchange rate is not part of the projection itself. */
export function toEngineModel(s: Pick<ScenarioDTO, 'startDate' | 'horizonYears' | 'currency' | 'variables' | 'flows'>): ScenarioModel {
  return {
    startDate: s.startDate,
    horizonYears: s.horizonYears,
    currency: s.currency,
    variables: s.variables,
    flows: s.flows,
  };
}

/** Replaces a scenario's variables and flows with the given model. Call inside a transaction. */
export async function writeModel(tx: Tx, scenarioId: string, model: Pick<ScenarioModelInput, 'variables' | 'flows'>): Promise<void> {
  await tx.delete(scenarioVariables).where(eq(scenarioVariables.scenarioId, scenarioId));
  await tx.delete(scenarioFlows).where(eq(scenarioFlows.scenarioId, scenarioId));
  const varRows = Object.entries(model.variables)
    .filter((e): e is [string, VariableInput] => Boolean(e[1]))
    .map(([key, v]) => ({
      scenarioId,
      key,
      value: v.value,
      low: v.low ?? null,
      high: v.high ?? null,
      source: v.source,
      note: v.note ?? null,
    }));
  if (varRows.length) await tx.insert(scenarioVariables).values(varRows);
  const seen = new Set<string>();
  const flowRows = model.flows.map((f, i) => {
    let clientId = f.id;
    while (seen.has(clientId)) clientId = `${f.id}_${i}`;
    seen.add(clientId);
    return {
      scenarioId,
      clientId,
      position: i,
      kind: f.kind,
      label: f.label,
      amount: f.amount,
      low: f.low ?? null,
      high: f.high ?? null,
      amountMode: f.amountMode ?? 'fixed',
      startMonth: f.startMonth,
      endMonth: f.endMonth ?? null,
      annualGrowth: f.annualGrowth ?? null,
      source: f.source,
      note: f.note ?? null,
    };
  });
  if (flowRows.length) await tx.insert(scenarioFlows).values(flowRows);
}

/** Loads complete scenario DTOs for a set of scenario rows with as few queries as possible. */
export async function hydrateScenarios(db: Tx, rows: ScenarioRow[]): Promise<ScenarioDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [vars, flows] = await Promise.all([
    db.select().from(scenarioVariables).where(inArray(scenarioVariables.scenarioId, ids)),
    db.select().from(scenarioFlows).where(inArray(scenarioFlows.scenarioId, ids)),
  ]);
  const dtos = rows.map((r) =>
    toScenarioDTO(
      r,
      vars.filter((v) => v.scenarioId === r.id),
      flows.filter((f) => f.scenarioId === r.id),
      null,
    ),
  );
  // The current run is the one whose input hash matches the scenario's current model.
  const hashes = dtos.map((d) => hashInputs(toEngineModel(d), { seed: DEFAULT_SEED, runs: DEFAULT_RUNS }));
  const runs = await db
    .select()
    .from(simulationRuns)
    .where(and(inArray(simulationRuns.scenarioId, ids), inArray(simulationRuns.inputHash, hashes), eq(simulationRuns.engineVersion, ENGINE_VERSION)))
    .orderBy(desc(simulationRuns.createdAt));
  dtos.forEach((d, i) => {
    const latest = runs.find((run) => run.scenarioId === d.id && run.inputHash === hashes[i]);
    d.latestRun = latest ? runMeta(latest) : null;
  });
  return dtos;
}

export async function loadScenario(db: Tx, userId: string, scenarioId: string): Promise<ScenarioDTO> {
  const rows = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.id, scenarioId), eq(scenarios.userId, userId)))
    .limit(1);
  if (!rows[0]) throw notFound('Scenario');
  const [dto] = await hydrateScenarios(db, rows);
  return dto!;
}

export async function loadScenariosForDecision(db: Tx, decisionId: string): Promise<ScenarioDTO[]> {
  const rows = await db.select().from(scenarios).where(eq(scenarios.decisionId, decisionId)).orderBy(asc(scenarios.position), asc(scenarios.createdAt));
  return hydrateScenarios(db, rows);
}

/**
 * Returns the simulation run for the scenario's current inputs, creating one if needed.
 * Runs are immutable: when inputs change a new run is stored and old runs (with their
 * inputs) remain available for reproduction.
 */
export async function ensureRun(db: Tx, userId: string, scenario: ScenarioDTO): Promise<SimulationRunDTO> {
  const model = toEngineModel(scenario);
  const options = { seed: DEFAULT_SEED, runs: DEFAULT_RUNS };
  const hash = hashInputs(model, options);
  const existing = await db
    .select()
    .from(simulationRuns)
    .innerJoin(simulationResults, eq(simulationResults.runId, simulationRuns.id))
    .where(and(eq(simulationRuns.scenarioId, scenario.id), eq(simulationRuns.inputHash, hash), eq(simulationRuns.engineVersion, ENGINE_VERSION)))
    .orderBy(desc(simulationRuns.createdAt))
    .limit(1);
  const hit = existing[0];
  if (hit) {
    // Identical inputs (e.g. after an edit was undone) reuse the stored, immutable run.
    return { ...runMeta(hit.simulation_runs), scenarioId: scenario.id, result: hit.simulation_results.result as SimulationResult };
  }
  const t0 = performance.now();
  const result = simulate(model, options);
  const durationMs = Math.round(performance.now() - t0);
  const [run] = await db
    .insert(simulationRuns)
    .values({
      scenarioId: scenario.id,
      userId,
      scenarioVersion: scenario.version,
      engineVersion: ENGINE_VERSION,
      inputHash: hash,
      seed: options.seed,
      runs: options.runs,
      inputs: { model, options },
      durationMs,
    })
    .returning();
  await db.insert(simulationResults).values({ runId: run!.id, summary: result.expected.summary, result });
  return { ...runMeta(run!), scenarioId: scenario.id, result };
}

export async function loadRun(db: Tx, userId: string, runId: string): Promise<SimulationRunDTO & { inputs: { model: ScenarioModel; options: { seed: number; runs: number } } }> {
  const rows = await db
    .select()
    .from(simulationRuns)
    .innerJoin(simulationResults, eq(simulationResults.runId, simulationRuns.id))
    .where(and(eq(simulationRuns.id, runId), eq(simulationRuns.userId, userId)))
    .limit(1);
  const r = rows[0];
  if (!r) throw notFound('Simulation run');
  return {
    ...runMeta(r.simulation_runs),
    scenarioId: r.simulation_runs.scenarioId,
    result: r.simulation_results.result as SimulationResult,
    inputs: r.simulation_runs.inputs as { model: ScenarioModel; options: { seed: number; runs: number } },
  };
}
