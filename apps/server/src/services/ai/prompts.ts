import { VARIABLES, VARIABLE_KEYS, getVariableDefinition, type SimulationResult } from '@whatif/engine';
import { DECISION_CATEGORIES, type AiTask, type DecisionDTO, type ProfileInput } from '@whatif/shared';

export interface ScenarioFacts {
  scenarioId: string;
  name: string;
  isBaseline: boolean;
  currency: string;
  exchangeRateToBase: number | null;
  assumptions: Record<string, { value: number | null; low?: number | null; high?: number | null; source: string; unit: string }>;
  items: { label: string; kind: string; amount: number | null; startMonth: number; endMonth: number | null; source: string }[];
  qualitative: string[];
  results: {
    finalNetWorth: number;
    finalNetWorthInTodaysMoney: number;
    bestCaseFinalNetWorth: number;
    worstCaseFinalNetWorth: number;
    p10FinalNetWorth: number | null;
    p50FinalNetWorth: number | null;
    p90FinalNetWorth: number | null;
    chanceOfCashShortfall: number | null;
    upfrontCost: number;
    monthlyNetIncomeYear1: number;
    monthlyCostsYear1: number;
    monthlySurplusYear1: number;
    lowestCash: number;
    salaryStartsAfterMonths: number;
    freeHoursPerWeek: number;
    topSensitivities: { input: string; finalNetWorthAtLow: number; finalNetWorthAtHigh: number }[];
    engineFlags: string[];
    missingAssumptions: string[];
  };
}

export interface DecisionFacts {
  decision: { title: string; question: string | null; description: string | null; baseCurrency: string; horizonYears: number; category: string };
  profile?: Partial<ProfileInput>;
  scenarios: ScenarioFacts[];
}

const r0 = (n: number) => Math.round(n);

export function buildFacts(decision: DecisionDTO, results: Map<string, SimulationResult>, profile: ProfileInput | null, scenarioId?: string | null): DecisionFacts {
  const active = decision.scenarios.filter((s) => s.status === 'active' && (!scenarioId || s.id === scenarioId || s.isBaseline));
  const facts: DecisionFacts = {
    decision: {
      title: decision.title,
      question: decision.question,
      description: decision.description,
      baseCurrency: decision.baseCurrency,
      horizonYears: decision.horizonYears,
      category: decision.category,
    },
    scenarios: active.map((s) => {
      const r = results.get(s.id)!;
      const sum = r.expected.summary;
      const assumptions: ScenarioFacts['assumptions'] = {};
      for (const def of VARIABLES) {
        const v = s.variables[def.key];
        if (!v) continue;
        assumptions[def.key] = { value: v.value, low: v.low ?? null, high: v.high ?? null, source: v.source, unit: def.unit };
      }
      return {
        scenarioId: s.id,
        name: s.name,
        isBaseline: s.isBaseline,
        currency: s.currency,
        exchangeRateToBase: s.exchangeRateToBase,
        assumptions,
        items: s.flows.map((f) => ({ label: f.label, kind: f.kind, amount: f.amount, startMonth: f.startMonth, endMonth: f.endMonth ?? null, source: f.source })),
        qualitative: decision.assumptions.filter((a) => a.scenarioId === s.id).map((a) => `${a.category}: ${a.text}`),
        results: {
          finalNetWorth: r0(sum.finalNetWorth),
          finalNetWorthInTodaysMoney: r0(sum.finalRealNetWorth),
          bestCaseFinalNetWorth: r0(r.cases.best.summary.finalNetWorth),
          worstCaseFinalNetWorth: r0(r.cases.worst.summary.finalNetWorth),
          p10FinalNetWorth: r.uncertainty?.hasUncertainty ? r0(r.uncertainty.finalNetWorth.p10) : null,
          p50FinalNetWorth: r.uncertainty?.hasUncertainty ? r0(r.uncertainty.finalNetWorth.p50) : null,
          p90FinalNetWorth: r.uncertainty?.hasUncertainty ? r0(r.uncertainty.finalNetWorth.p90) : null,
          chanceOfCashShortfall: r.uncertainty ? r.uncertainty.shortfallProbability : null,
          upfrontCost: r0(sum.upfrontCost),
          monthlyNetIncomeYear1: r0(sum.avgMonthlyNetIncomeYear1),
          monthlyCostsYear1: r0(sum.avgMonthlyExpensesYear1),
          monthlySurplusYear1: r0(sum.avgMonthlyNetCashFlowYear1),
          lowestCash: r0(sum.lowestCash),
          salaryStartsAfterMonths: sum.effectiveIncomeStart,
          freeHoursPerWeek: Math.round(sum.avgFreeHoursPerWeek),
          topSensitivities: r.sensitivity.slice(0, 4).map((x) => ({ input: x.label, finalNetWorthAtLow: r0(x.atLow), finalNetWorthAtHigh: r0(x.atHigh) })),
          engineFlags: r.insights.map((i) => `${i.kind}/${i.severity}: ${i.title}`),
          missingAssumptions: r.warnings.filter((w) => w.code === 'missing_value' && w.key).map((w) => getVariableDefinition(w.key as never).label),
        },
      };
    }),
  };
  if (profile) {
    const { displayName: _n, goals, priorities, riskTolerance, country, city, employmentStatus, occupation, ageRange } = profile;
    facts.profile = { country, city, employmentStatus, occupation, ageRange, goals, priorities, riskTolerance };
  }
  return facts;
}

const OUTPUT_CONTRACT = `Respond with a single JSON object and nothing else:
{
  "summary": string,            // 2–5 sentences, plain language
  "points": [ { "title": string, "detail": string, "kind": "risk" | "opportunity" | "cost" | "assumption" | "alternative" | "insight" } ],
  "suggestions": [ { "scenarioId": string, "key": string, "value": number, "low": number | null, "high": number | null, "rationale": string } ]
}`;

const RULES = `Rules:
- You are the analyst inside What-If, a decision-planning tool. A deterministic engine has already calculated every projection.
- Use only numbers that appear in FACTS. Never calculate new projections, totals or percentages. If a number you need is not in FACTS, describe it qualitatively.
- Be specific to this person and these scenarios. Do not give generic advice. Do not give personalised investment, legal, tax or medical advice; suggest consulting a professional where relevant.
- Values with source "system" are default or illustrative assumptions; values with source "user" came from the person; "ai" values are earlier AI estimates.
- Projections are uncertain estimates, never guarantees. Say so when it matters.
- Write in clear, calm, professional English. No emojis. No markdown headings.`;

const TASKS: Record<AiTask, string> = {
  review: `Task: review the assumptions. Challenge values that look unrealistic for the stated places, roles and situation; point out overlooked costs (e.g. taxes, insurance, deposits, visas, childcare) and missing assumptions. For concrete corrections, add entries to "suggestions" using only these keys: ${VARIABLE_KEYS.join(', ')}. Suggested values are estimates and will be shown to the user as AI estimates for them to accept or reject — explain the basis in "rationale". Give 3–8 points.`,
  explain: `Task: explain the results. For each scenario, say what drives the outcome (which assumptions matter most, using topSensitivities), how the scenarios differ and why. Keep "suggestions" empty. Give 3–6 points.`,
  risks: `Task: identify risks and opportunities that the numbers alone may not capture — practical, personal, regulatory, market and timing risks — and say how each could be tested or mitigated. Reference engineFlags where relevant. Keep "suggestions" empty. Give 4–8 points with kind "risk" or "opportunity".`,
  alternatives: `Task: suggest 2–4 alternative scenarios worth modelling (e.g. a phased approach, a different destination, a hybrid). Each point's title is the scenario name and detail explains what would change and why it might be better. Use kind "alternative". Keep "suggestions" empty.`,
  summary: `Task: write an executive summary of the decision for a report: the main trade-offs, what the expected, best and worst cases show, the key uncertainties, and what would need to be true for each option to be the better choice. Do not tell the person what to choose. Keep "suggestions" empty. Give 3–6 points.`,
};

export function analysisPrompt(task: AiTask, facts: DecisionFacts): { system: string; user: string } {
  return {
    system: `${RULES}\n\n${TASKS[task]}\n\n${OUTPUT_CONTRACT}`,
    user: `FACTS (JSON, money in each scenario's own currency; exchangeRateToBase converts to ${facts.decision.baseCurrency}; months are counted from the scenario start; probabilities are 0–1):\n${JSON.stringify(facts)}`,
  };
}

export function parsePrompt(question: string, baseCurrency: string, profile: Partial<ProfileInput> | null): { system: string; user: string } {
  const keys = VARIABLES.map((v) => `${v.key} (${v.unit}${v.description ? `: ${v.description.slice(0, 80)}` : ''})`).join('\n');
  return {
    system: `${RULES}

Task: turn the person's decision question into a structured set of scenarios to compare. Always include the status quo as the first scenario with "isBaseline": true. Propose 2–4 scenarios in total.
For each scenario, propose values ONLY where you can make a reasonable, explainable estimate; otherwise use null so the person is asked. Every proposed value is shown as an AI estimate. Give low/high ranges for uncertain values. Use the local currency of the place each scenario happens in (ISO 4217).
Available variable keys:
${keys}

Respond with a single JSON object and nothing else:
{
  "category": one of ${DECISION_CATEGORIES.join(' | ')},
  "title": string,           // the question, starting with "What if"
  "scenarios": [ {
    "name": string, "description": string, "isBaseline": boolean, "currency": string,
    "variables": { "<key>": { "value": number | null, "low": number | null, "high": number | null, "note": string } },
    "items": [ { "kind": "income" | "expense" | "one_time_income" | "one_time_expense" | "time", "label": string, "amount": number | null, "startMonth": number, "endMonth": number | null, "note": string } ],
    "assumptions": [ { "text": string, "category": "assumption" | "risk" | "opportunity" | "question" } ]
  } ]
}`,
    user: `Question: ${question}\nPreferred comparison currency: ${baseCurrency}${profile ? `\nPerson's baseline (shared with consent): ${JSON.stringify(profile)}` : ''}`,
  };
}
