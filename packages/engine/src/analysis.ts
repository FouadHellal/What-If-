/**
 * Decision analysis built on top of the projection engine. Everything here is
 * deterministic and derived from the same model the user edits.
 */
import { VARIABLES, getVariableDefinition, type VariableDefinition } from './catalog';
import { normalizeModel, resolveCase } from './normalize';
import { project } from './project';
import type { ScenarioModel, SimulationResult, VariableKey } from './types';
import { monthNumber, monthNumberToDate, percentileSorted, round2 } from './util';

// ── Helpers ─────────────────────────────────────────────────────────────────

export interface AnalysisScenario {
  id: string;
  name: string;
  isBaseline: boolean;
  model: ScenarioModel;
  result: SimulationResult;
  /** Base-currency units per unit of the scenario currency. */
  fx: number;
}

/** Expected-case net worth (scenario currency) at an absolute month, via one projection. */
export function expectedNetWorthAt(model: ScenarioModel, absMonth: number): number | null {
  const nm = normalizeModel(model);
  const offset = absMonth - monthNumber(nm.startDate);
  if (offset < 0 || offset >= nm.horizonMonths) return null;
  const core = project(resolveCase(nm, 'expected'), { startDate: nm.startDate, horizonMonths: nm.horizonMonths, checkpoints: [offset] }, false);
  const v = core.checkpointNetWorth[0];
  return v === undefined || Number.isNaN(v) ? null : v;
}

/** The last calendar month covered by both scenarios (absolute month number), or null. */
export function commonEnd(a: ScenarioModel, b: ScenarioModel): number | null {
  const endA = monthNumber(a.startDate) + Math.round(a.horizonYears) * 12 - 1;
  const endB = monthNumber(b.startDate) + Math.round(b.horizonYears) * 12 - 1;
  const startA = monthNumber(a.startDate);
  const startB = monthNumber(b.startDate);
  const end = Math.min(endA, endB);
  return end >= Math.max(startA, startB) ? end : null;
}

function setVariable(model: ScenarioModel, key: VariableKey, value: number): ScenarioModel {
  const prev = model.variables[key];
  return { ...model, variables: { ...model.variables, [key]: { value, low: null, high: null, source: prev?.source ?? 'user', note: prev?.note ?? null } } };
}

function setFlowAmount(model: ScenarioModel, flowId: string, value: number): ScenarioModel {
  return { ...model, flows: model.flows.map((f) => (f.id === flowId ? { ...f, amount: value, low: null, high: null } : f)) };
}

/** Changes one input (variable key or `flow:<id>`) without touching anything else. */
export function withInput(model: ScenarioModel, input: string, value: number): ScenarioModel {
  return input.startsWith('flow:') ? setFlowAmount(model, input.slice(5), value) : setVariable(model, input as VariableKey, value);
}

export function currentInputValue(model: ScenarioModel, input: string): number {
  if (input.startsWith('flow:')) return model.flows.find((f) => f.id === input.slice(5))?.amount ?? 0;
  const v = model.variables[input as VariableKey]?.value;
  if (v !== null && v !== undefined) return v;
  return getVariableDefinition(input as VariableKey).fallback;
}

export function inputLabel(model: ScenarioModel, input: string): string {
  if (input.startsWith('flow:')) return model.flows.find((f) => f.id === input.slice(5))?.label ?? 'Item';
  return getVariableDefinition(input as VariableKey).label;
}

export function inputUnit(input: string): VariableDefinition['unit'] {
  return input.startsWith('flow:') ? 'currency_month' : getVariableDefinition(input as VariableKey).unit;
}

// ── Break-even ──────────────────────────────────────────────────────────────

export interface BreakEven {
  alternativeId: string;
  baselineId: string;
  /** First month (YYYY-MM) from which the alternative stays ahead in the expected case. */
  overtakesAt: string | null;
  /** Months from the alternative's start until it stays ahead. */
  monthsToBreakEven: number | null;
  /** Largest shortfall versus the baseline, in base currency, and when. */
  maxDeficit: number;
  maxDeficitAt: string | null;
  /** Advantage (positive) or disadvantage at the common end, in base currency. */
  endAdvantage: number;
  endDate: string | null;
  /** Average monthly gain once ahead (base currency), measured over the last 12 common months. */
  monthlyGainAtEnd: number;
}

export function breakEven(alt: AnalysisScenario, base: AnalysisScenario): BreakEven {
  const aStart = monthNumber(alt.result.startDate);
  const bStart = monthNumber(base.result.startDate);
  const bMap = new Map<number, number>();
  for (const p of base.result.expected.months) bMap.set(bStart + p.t, p.netWorth * base.fx);
  let lastBehind: number | null = null;
  let firstCommon: number | null = null;
  let lastCommon: number | null = null;
  let maxDeficit = 0;
  let maxDeficitAt: number | null = null;
  const diffs: { m: number; d: number }[] = [];
  for (const p of alt.result.expected.months) {
    const m = aStart + p.t;
    const bv = bMap.get(m);
    if (bv === undefined) continue;
    const d = p.netWorth * alt.fx - bv;
    diffs.push({ m, d });
    if (firstCommon === null) firstCommon = m;
    lastCommon = m;
    if (d < 0) {
      lastBehind = m;
      if (d < maxDeficit) {
        maxDeficit = d;
        maxDeficitAt = m;
      }
    }
  }
  let overtakes: number | null = null;
  if (firstCommon !== null && lastCommon !== null) {
    if (lastBehind === null) overtakes = firstCommon;
    else if (lastBehind < lastCommon) overtakes = lastBehind + 1;
  }
  const tail = diffs.slice(-13);
  const monthlyGain = tail.length >= 2 ? (tail[tail.length - 1]!.d - tail[0]!.d) / (tail.length - 1) : 0;
  return {
    alternativeId: alt.id,
    baselineId: base.id,
    overtakesAt: overtakes === null ? null : monthNumberToDate(overtakes),
    monthsToBreakEven: overtakes === null ? null : overtakes - aStart,
    maxDeficit: round2(-maxDeficit),
    maxDeficitAt: maxDeficitAt === null ? null : monthNumberToDate(maxDeficitAt),
    endAdvantage: round2(diffs[diffs.length - 1]?.d ?? 0),
    endDate: lastCommon === null ? null : monthNumberToDate(lastCommon),
    monthlyGainAtEnd: round2(monthlyGain),
  };
}

// ── Threshold solver ────────────────────────────────────────────────────────

export interface Threshold {
  scenarioId: string;
  /** Variable key or `flow:<id>`. */
  input: string;
  label: string;
  unit: VariableDefinition['unit'];
  current: number;
  /** The value at which `scenarioId` and `rivalId` end level (expected case, common end date). */
  parity: number;
  rivalId: string;
  /** Whether the scenario gets better as the input rises. */
  direction: 'higher_is_better' | 'lower_is_better';
  /** Relative distance from the current value (0.15 = 15 %). */
  distance: number;
}

/**
 * Finds the value of one input in `subject` at which it ends level with `rival`
 * (expected case, in base currency, at the last common month). Uses bisection on
 * the deterministic model; returns null when no crossing exists in the search range.
 */
export function solveParity(subject: AnalysisScenario, rival: AnalysisScenario, input: string, opts: { searchFactor?: number } = {}): Threshold | null {
  const end = commonEnd(subject.model, rival.model);
  if (end === null) return null;
  const rivalNW = expectedNetWorthAt(rival.model, end);
  if (rivalNW === null) return null;
  const target = rivalNW * rival.fx;
  const current = currentInputValue(subject.model, input);
  const f = (x: number) => {
    const nw = expectedNetWorthAt(withInput(subject.model, input, x), end);
    return nw === null ? Number.NaN : nw * subject.fx - target;
  };
  const isVar = !input.startsWith('flow:');
  const def = isVar ? getVariableDefinition(input as VariableKey) : null;
  const minV = def ? def.min : 0;
  const maxV = def ? def.max : 1e12;
  const factor = opts.searchFactor ?? 3;
  const span = Math.max(Math.abs(current) * factor, def?.unit.startsWith('percent') ? 30 : def?.unit === 'months' ? 36 : 1000);
  const lo = Math.max(minV, current - span);
  const hi = Math.min(maxV, current + span);
  const f0 = f(current);
  if (!Number.isFinite(f0)) return null;
  if (Math.abs(f0) < 0.5) return null; // already level — no meaningful threshold
  const flo = f(lo);
  const fhi = f(hi);
  // Pick the side of `current` where the sign changes.
  let a: number;
  let b: number;
  let fa: number;
  if (Math.sign(flo) !== Math.sign(f0) && Number.isFinite(flo)) {
    a = lo;
    b = current;
    fa = flo;
  } else if (Math.sign(fhi) !== Math.sign(f0) && Number.isFinite(fhi)) {
    a = current;
    b = hi;
    fa = f0;
  } else {
    return null;
  }
  for (let i = 0; i < 48 && Math.abs(b - a) > Math.max(1e-6, Math.abs(current) * 1e-6); i++) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (!Number.isFinite(fm)) return null;
    if (Math.sign(fm) === Math.sign(fa)) {
      a = mid;
      fa = fm;
    } else {
      b = mid;
    }
  }
  const parity = (a + b) / 2;
  const higherBetter = f(parity + Math.max(Math.abs(parity) * 0.01, 0.01)) > f(parity - Math.max(Math.abs(parity) * 0.01, 0.01));
  return {
    scenarioId: subject.id,
    input,
    label: inputLabel(subject.model, input),
    unit: inputUnit(input),
    current: round2(current),
    parity: round2(parity),
    rivalId: rival.id,
    direction: higherBetter ? 'higher_is_better' : 'lower_is_better',
    distance: round2(current === 0 ? Math.abs(parity) : Math.abs(parity - current) / Math.abs(current)),
  };
}

/** Exchange-rate threshold: the base-currency value of one unit at which two scenarios end level. */
export function fxParity(subject: AnalysisScenario, rival: AnalysisScenario): { rate: number; current: number } | null {
  const end = commonEnd(subject.model, rival.model);
  if (end === null) return null;
  const s = expectedNetWorthAt(subject.model, end);
  const r = expectedNetWorthAt(rival.model, end);
  if (s === null || r === null || s <= 0 || r <= 0) return null;
  return { rate: round2((r * rival.fx) / s * 1e6) / 1e6, current: subject.fx };
}

// ── What would change my mind ───────────────────────────────────────────────

export interface MindChanger {
  /** Scenario whose input changes. */
  scenarioId: string;
  /** Scenario that would come out ahead at the threshold. */
  newLeaderId: string;
  previousLeaderId: string;
  input: string;
  label: string;
  unit: VariableDefinition['unit'];
  current: number;
  threshold: number;
  /** "below" means: if the input falls below the threshold, the outcome flips. */
  side: 'below' | 'above';
  distance: number;
}

/**
 * For the expected-case leader and each challenger, finds the input values that
 * would flip which one ends ahead. Candidate inputs come from both scenarios'
 * sensitivity rankings, so the search focuses on what actually matters.
 */
export function whatWouldChangeMyMind(scenarios: AnalysisScenario[], opts: { maxPerPair?: number; maxDistance?: number } = {}): { leaderId: string | null; changers: MindChanger[] } {
  const ranked = scenarios
    .map((s) => ({ s, end: s.result.expected.summary.finalNetWorth * s.fx }))
    .sort((a, b) => b.end - a.end);
  const leader = ranked[0]?.s;
  if (!leader || scenarios.length < 2) return { leaderId: leader?.id ?? null, changers: [] };
  const maxPerPair = opts.maxPerPair ?? 3;
  const maxDistance = opts.maxDistance ?? 1.5;
  const changers: MindChanger[] = [];
  for (const { s: rival } of ranked.slice(1)) {
    const found: MindChanger[] = [];
    // Inputs of the leader that could make it lose; inputs of the rival that could make it win.
    for (const [subject, other, makesSubjectLead] of [
      [leader, rival, false],
      [rival, leader, true],
    ] as const) {
      const inputs = subject.result.sensitivity.slice(0, 5).map((x) => x.key);
      for (const input of inputs) {
        const t = solveParity(subject, other, input);
        if (!t || t.distance > maxDistance) continue;
        const subjectGetsBetter = t.direction === 'higher_is_better';
        // Leader loses when its input moves in its unfavourable direction; rival wins when its input moves favourably.
        const side: 'below' | 'above' = makesSubjectLead ? (subjectGetsBetter ? 'above' : 'below') : subjectGetsBetter ? 'below' : 'above';
        found.push({
          scenarioId: subject.id,
          newLeaderId: rival.id,
          previousLeaderId: leader.id,
          input,
          label: t.label,
          unit: t.unit,
          current: t.current,
          threshold: t.parity,
          side,
          distance: t.distance,
        });
      }
    }
    changers.push(...found.sort((a, b) => a.distance - b.distance).slice(0, maxPerPair));
  }
  return { leaderId: leader.id, changers: changers.sort((a, b) => a.distance - b.distance) };
}

// ── Robustness ──────────────────────────────────────────────────────────────

export type RobustnessLabel = 'consistent' | 'optimism_dependent' | 'vulnerable' | 'highest_upside' | 'lowest_downside';

export interface ScenarioRobustness {
  id: string;
  /** Share of simulated futures in which this scenario ends with the highest net worth. */
  winProbability: number;
  /** Average shortfall versus the best scenario in each future (base currency). */
  expectedRegret: number;
  /** 90th percentile of that shortfall. */
  regretP90: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  shortfallProbability: number | null;
  labels: RobustnessLabel[];
}

export interface Robustness {
  comparable: boolean;
  runs: number;
  reason: string | null;
  scenarios: ScenarioRobustness[];
  /** Expected-case leader (highest expected final net worth). */
  expectedLeaderId: string | null;
  /** Leader by win probability across simulated futures. */
  robustLeaderId: string | null;
}

/**
 * Compares scenarios future by future. Requires their uncertainty runs to share
 * seed and run count (common random numbers), which the platform guarantees per decision.
 */
export function robustness(scenarios: AnalysisScenario[]): Robustness {
  const withSamples = scenarios.filter((s) => s.result.uncertainty && s.result.uncertainty.samples.length > 0);
  const runs = withSamples[0]?.result.uncertainty?.samples.length ?? 0;
  const seed = withSamples[0]?.result.uncertainty?.seed;
  const comparable =
    withSamples.length === scenarios.length &&
    scenarios.length >= 2 &&
    runs > 1 &&
    withSamples.every((s) => s.result.uncertainty!.samples.length === runs && s.result.uncertainty!.seed === seed);
  const expectedLeader = [...scenarios].sort((a, b) => b.result.expected.summary.finalNetWorth * b.fx - a.result.expected.summary.finalNetWorth * a.fx)[0];

  if (!comparable) {
    return {
      comparable: false,
      runs,
      reason: scenarios.length < 2 ? 'Add another scenario to compare robustness.' : 'Scenarios were simulated with different settings or without uncertainty.',
      scenarios: scenarios.map((s) => {
        const u = s.result.uncertainty;
        const fp = u?.finalNetWorth;
        return {
          id: s.id,
          winProbability: Number.NaN,
          expectedRegret: Number.NaN,
          regretP90: Number.NaN,
          p10: round2((fp?.p10 ?? s.result.expected.summary.finalNetWorth) * s.fx),
          p25: round2((fp?.p25 ?? s.result.expected.summary.finalNetWorth) * s.fx),
          p50: round2((fp?.p50 ?? s.result.expected.summary.finalNetWorth) * s.fx),
          p75: round2((fp?.p75 ?? s.result.expected.summary.finalNetWorth) * s.fx),
          p90: round2((fp?.p90 ?? s.result.expected.summary.finalNetWorth) * s.fx),
          shortfallProbability: u?.shortfallProbability ?? null,
          labels: [],
        };
      }),
      expectedLeaderId: expectedLeader?.id ?? null,
      robustLeaderId: null,
    };
  }

  const values = scenarios.map((s) => s.result.uncertainty!.samples.map((v) => v * s.fx));
  const wins = new Array<number>(scenarios.length).fill(0);
  const regrets: number[][] = scenarios.map(() => []);
  for (let r = 0; r < runs; r++) {
    let best = -Infinity;
    let bestIdx = 0;
    for (let i = 0; i < scenarios.length; i++) {
      const v = values[i]![r]!;
      if (v > best) {
        best = v;
        bestIdx = i;
      }
    }
    wins[bestIdx]!++;
    for (let i = 0; i < scenarios.length; i++) regrets[i]!.push(best - values[i]![r]!);
  }
  const out: ScenarioRobustness[] = scenarios.map((s, i) => {
    const sorted = [...values[i]!].sort((a, b) => a - b);
    const reg = [...regrets[i]!].sort((a, b) => a - b);
    return {
      id: s.id,
      winProbability: round2(wins[i]! / runs),
      expectedRegret: round2(reg.reduce((a, b) => a + b, 0) / runs),
      regretP90: round2(percentileSorted(reg, 0.9)),
      p10: round2(percentileSorted(sorted, 0.1)),
      p25: round2(percentileSorted(sorted, 0.25)),
      p50: round2(percentileSorted(sorted, 0.5)),
      p75: round2(percentileSorted(sorted, 0.75)),
      p90: round2(percentileSorted(sorted, 0.9)),
      shortfallProbability: s.result.uncertainty!.shortfallProbability,
      labels: [],
    };
  });
  // Labels
  const maxP90 = Math.max(...out.map((o) => o.p90));
  const maxP10 = Math.max(...out.map((o) => o.p10));
  for (const o of out) {
    const s = scenarios.find((x) => x.id === o.id)!;
    const expectedFinal = s.result.expected.summary.finalNetWorth * s.fx;
    if (o.winProbability >= 0.6) o.labels.push('consistent');
    if (expectedLeader?.id === o.id && o.winProbability < 0.5) o.labels.push('optimism_dependent');
    else if (o.p50 < expectedFinal * 0.85 && expectedFinal > 0) o.labels.push('optimism_dependent');
    if ((o.shortfallProbability ?? 0) >= 0.25 || (s.result.uncertainty!.lossProbability ?? 0) >= 0.25) o.labels.push('vulnerable');
    // Only a single clear winner earns these labels; ties (e.g. before inputs are filled) earn none.
    if (o.p90 === maxP90 && out.filter((x) => x.p90 === maxP90).length === 1) o.labels.push('highest_upside');
    if (o.p10 === maxP10 && out.filter((x) => x.p10 === maxP10).length === 1) o.labels.push('lowest_downside');
  }
  const robustLeader = [...out].sort((a, b) => b.winProbability - a.winProbability || a.expectedRegret - b.expectedRegret)[0];
  return { comparable: true, runs, reason: null, scenarios: out, expectedLeaderId: expectedLeader?.id ?? null, robustLeaderId: robustLeader?.id ?? null };
}

/** Pairwise: share of futures where `a` ends ahead of `b`. */
export function pairwiseWin(a: AnalysisScenario, b: AnalysisScenario): number | null {
  const sa = a.result.uncertainty?.samples;
  const sb = b.result.uncertainty?.samples;
  if (!sa || !sb || sa.length !== sb.length || sa.length < 2 || a.result.uncertainty!.seed !== b.result.uncertainty!.seed) return null;
  let w = 0;
  for (let i = 0; i < sa.length; i++) if (sa[i]! * a.fx > sb[i]! * b.fx) w++;
  return round2(w / sa.length);
}

// ── Life quality (multi-criteria) ───────────────────────────────────────────

export const LIFE_DIMENSIONS = [
  { key: 'career', label: 'Career satisfaction', description: 'Meaningful, enjoyable work and professional progress.' },
  { key: 'freedom', label: 'Personal freedom', description: 'Control over where, when and how you live and work.' },
  { key: 'time', label: 'Time availability', description: 'Time for rest, hobbies and the people you care about.' },
  { key: 'family', label: 'Family proximity', description: 'Being close to family, physically and emotionally.' },
  { key: 'social', label: 'Social connections', description: 'Friends, community and a sense of belonging.' },
  { key: 'lifestyle', label: 'Lifestyle & place', description: 'Climate, culture, housing and daily surroundings.' },
  { key: 'health', label: 'Health & wellbeing', description: 'Room for exercise, low stress, access to care.' },
  { key: 'learning', label: 'Learning opportunities', description: 'Chances to build skills and knowledge.' },
  { key: 'stability', label: 'Stability & security', description: 'Predictability, legal status, safety net.' },
  { key: 'growth', label: 'Personal growth', description: 'Adventure, challenge and becoming who you want to be.' },
] as const;

export type LifeKey = (typeof LIFE_DIMENSIONS)[number]['key'];
export type LifeWeights = Partial<Record<string, number>>;
export type LifeScores = Partial<Record<string, number>>;

/** v1 used six factors; map them onto the v2 dimensions so existing ratings keep working. */
const LEGACY: Record<string, LifeKey> = { financial: 'stability', relationships: 'family' };

export function normalizeLifeMap(m: Partial<Record<string, number>> | null | undefined): Partial<Record<LifeKey, number>> {
  const out: Partial<Record<LifeKey, number>> = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const key = (LEGACY[k] ?? k) as LifeKey;
    if (!LIFE_DIMENSIONS.some((d) => d.key === key)) continue;
    if (out[key] === undefined) out[key] = v;
  }
  return out;
}

export interface LifeQuality {
  /** 0–100, or null when nothing relevant is rated. */
  score: number | null;
  /** Per dimension: weight share (0–1) and contribution to the score (points of 100). */
  contributions: { key: LifeKey; label: string; weight: number; weightShare: number; rating: number | null; points: number }[];
  ratedShare: number;
}

/**
 * Weighted average of 1–5 ratings, rescaled to 0–100. Unrated dimensions are
 * excluded rather than guessed. Default weight is 3 when unspecified.
 */
export function lifeQuality(scoresIn: LifeScores, weightsIn: LifeWeights): LifeQuality {
  const scores = normalizeLifeMap(scoresIn);
  const weights = normalizeLifeMap(weightsIn);
  const rows = LIFE_DIMENSIONS.map((d) => {
    const w = Math.max(0, Math.min(5, weights[d.key] ?? 3));
    const s = scores[d.key];
    return { key: d.key, label: d.label, weight: w, rating: typeof s === 'number' ? Math.max(1, Math.min(5, s)) : null };
  });
  const rated = rows.filter((r) => r.rating !== null && r.weight > 0);
  const totalW = rated.reduce((a, r) => a + r.weight, 0);
  const allW = rows.reduce((a, r) => a + r.weight, 0);
  const contributions = rows.map((r) => {
    const share = totalW > 0 && r.rating !== null ? r.weight / totalW : 0;
    return { ...r, weightShare: round2(share), points: r.rating === null ? 0 : round2(share * ((r.rating - 1) / 4) * 100) };
  });
  return {
    score: totalW > 0 ? Math.round(contributions.reduce((a, c) => a + c.points, 0)) : null,
    contributions,
    ratedShare: allW > 0 ? round2(totalW / allW) : 0,
  };
}

export interface PriorityFlip {
  dimension: LifeKey;
  label: string;
  currentWeight: number;
  weight: number;
  newLeaderId: string;
}

/** Which single change of importance (0–5) would change the life-quality leader. */
export function prioritySensitivity(items: { id: string; scores: LifeScores }[], weightsIn: LifeWeights): { leaderId: string | null; flips: PriorityFlip[] } {
  const weights = normalizeLifeMap(weightsIn);
  const leaderFor = (w: LifeWeights) => {
    const ranked = items.map((i) => ({ id: i.id, s: lifeQuality(i.scores, w).score })).filter((x) => x.s !== null);
    ranked.sort((a, b) => b.s! - a.s!);
    if (ranked.length < 2) return ranked[0]?.id ?? null;
    return ranked[0]!.s === ranked[1]!.s ? null : ranked[0]!.id;
  };
  const leader = leaderFor(weights);
  const flips: PriorityFlip[] = [];
  for (const d of LIFE_DIMENSIONS) {
    const cur = weights[d.key] ?? 3;
    // Search outward from the current weight so the smallest change is reported.
    for (const delta of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
      const w = cur + delta;
      if (w < 0 || w > 5) continue;
      const l = leaderFor({ ...weights, [d.key]: w });
      if (l && l !== leader) {
        flips.push({ dimension: d.key, label: d.label, currentWeight: cur, weight: w, newLeaderId: l });
        break;
      }
    }
  }
  return { leaderId: leader, flips };
}

export { VARIABLES };
