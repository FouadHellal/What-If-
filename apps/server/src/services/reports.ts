import { and, desc, eq } from 'drizzle-orm';
import {
  COMPARISON_METRICS,
  ENGINE_VERSION,
  VARIABLES,
  compareScenarios,
  type ComparableScenario,
} from '@whatif/engine';
import type { AiOutput, DecisionDTO, ProfileInput, ReportDTO, ReportSnapshot } from '@whatif/shared';
import type { Db } from '../db/client';
import { aiAnalyses, reports } from '../db/schema';
import { ensureRun } from './scenarios';

export async function buildSnapshot(db: Db, userId: string, decision: DecisionDTO, profile: ProfileInput | null, includeAi: boolean): Promise<ReportSnapshot> {
  const active = decision.scenarios.filter((s) => s.status === 'active');
  const runs = [];
  for (const s of active) runs.push({ scenario: s, run: await ensureRun(db, userId, s) });

  const comparable: ComparableScenario[] = runs.map(({ scenario, run }) => ({
    id: scenario.id,
    name: scenario.name,
    isBaseline: scenario.isBaseline,
    result: run.result,
    exchangeRateToBase: scenario.exchangeRateToBase ?? 1,
    scores: scenario.scores,
  }));
  const cmp = compareScenarios(comparable, decision.baseCurrency, decision.priorities ?? profile?.priorities ?? {});

  let aiSummary: ReportSnapshot['aiSummary'] = null;
  if (includeAi) {
    const rows = await db
      .select()
      .from(aiAnalyses)
      .where(and(eq(aiAnalyses.decisionId, decision.id), eq(aiAnalyses.task, 'summary'), eq(aiAnalyses.status, 'completed')))
      .orderBy(desc(aiAnalyses.createdAt))
      .limit(1);
    const a = rows[0];
    if (a?.output) aiSummary = { provider: a.provider, model: a.model, createdAt: a.createdAt.toISOString(), output: a.output as AiOutput, unverifiedNumbers: a.unverifiedNumbers };
  }

  return {
    generatedAt: new Date().toISOString(),
    decision: {
      id: decision.id,
      title: decision.title,
      question: decision.question,
      description: decision.description,
      category: decision.category,
      status: decision.status,
      baseCurrency: decision.baseCurrency,
      horizonYears: decision.horizonYears,
      rationale: decision.rationale,
      expectations: decision.expectations,
      decidedAt: decision.decidedAt,
      chosenScenarioId: decision.chosenScenarioId,
    },
    baseline: profile,
    scenarios: runs.map(({ scenario, run }) => {
      const r = run.result;
      const cs = cmp.scenarios.find((c) => c.id === scenario.id);
      return {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        isBaseline: scenario.isBaseline,
        currency: scenario.currency,
        exchangeRateToBase: scenario.exchangeRateToBase,
        version: scenario.version,
        runId: run.id,
        inputHash: run.inputHash,
        variables: VARIABLES.filter((d) => scenario.variables[d.key]).map((d) => {
          const v = scenario.variables[d.key]!;
          return { key: d.key, label: d.label, value: v.value, low: v.low ?? null, high: v.high ?? null, unit: d.unit, source: v.source, note: v.note ?? null };
        }),
        flows: scenario.flows,
        summary: r.expected.summary,
        best: r.cases.best.summary.finalNetWorth,
        worst: r.cases.worst.summary.finalNetWorth,
        uncertainty: r.uncertainty,
        sensitivity: r.sensitivity,
        insights: r.insights,
        milestones: r.milestones,
        yearly: r.expected.years.map((y) => ({ label: y.label, netWorth: y.netWorth, cash: y.cash, netIncome: y.netIncome, totalExpenses: y.totalExpenses })),
        warnings: r.warnings,
        fit: cs?.fit ?? null,
      };
    }),
    comparison: COMPARISON_METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      unit: m.unit,
      values: Object.fromEntries(cmp.scenarios.map((s) => [s.id, s.metrics[m.key] ?? null])),
      leader: cmp.leaders[m.key] ?? null,
    })),
    assumptions: decision.assumptions,
    milestones: decision.milestones,
    aiSummary,
    engineVersion: ENGINE_VERSION,
  };
}

export function reportDTO(row: typeof reports.$inferSelect): ReportDTO {
  return { id: row.id, decisionId: row.decisionId, title: row.title, createdAt: row.createdAt.toISOString(), snapshot: row.snapshot as ReportSnapshot };
}
