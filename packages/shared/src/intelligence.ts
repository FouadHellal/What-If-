/**
 * Decision Intelligence: a structured reading of a decision, computed from the
 * model. It never recommends a choice; it shows what the numbers depend on.
 */
import {
  breakEven,
  fxParity,
  getVariableDefinition,
  isVariableKey,
  lifeQuality,
  prioritySensitivity,
  robustness,
  whatWouldChangeMyMind,
  type AnalysisScenario,
  type BreakEven,
  type LifeWeights,
  type MindChanger,
  type PriorityFlip,
  type Robustness,
  type ScenarioModel,
  type SimulationResult,
  type ValueSource,
} from '@whatif/engine';
import type { AssumptionDTO, ScenarioDTO } from './dto';
import type { DecisionCategory } from './schemas';

export interface IntelligenceInput {
  title: string;
  question: string | null;
  category: DecisionCategory;
  baseCurrency: string;
  scenarios: ScenarioDTO[];
  results: Map<string, SimulationResult>;
  models: Map<string, ScenarioModel>;
  assumptions: AssumptionDTO[];
  lifeWeights: LifeWeights;
}

export interface KeyAssumption {
  scenarioId: string;
  input: string;
  label: string;
  /** Change in final net worth across the input's range, in base currency. */
  swing: number;
  source: ValueSource | 'missing';
  basis: 'range' | 'default';
}

export interface ResearchItem {
  scenarioId: string;
  input: string;
  label: string;
  why: string;
  priority: 'high' | 'medium' | 'low';
}

export interface HiddenCost {
  label: string;
  modelled: boolean;
  scenarioIds: string[];
}

export interface DecisionIntelligence {
  statement: string;
  alternatives: {
    id: string;
    name: string;
    isBaseline: boolean;
    expectedFinal: number;
    p10: number | null;
    p90: number | null;
    lifeScore: number | null;
    fxMissing: boolean;
  }[];
  financialLeaderId: string | null;
  robustLeaderId: string | null;
  lifeLeaderId: string | null;
  robustness: Robustness;
  breakEvens: BreakEven[];
  mindChangers: MindChanger[];
  fxThresholds: { scenarioId: string; rivalId: string; rate: number; current: number; currency: string }[];
  lifeFlips: PriorityFlip[];
  keyAssumptions: KeyAssumption[];
  toResearch: ResearchItem[];
  irreversible: { scenarioId: string; text: string }[];
  hiddenCosts: HiddenCost[];
  failureModes: { scenarioId: string; text: string; severity: 'high' | 'medium' | 'low' }[];
  userRisks: AssumptionDTO[];
  completeness: { missing: number; systemValues: number; aiValues: number; total: number };
  caveats: string[];
}

const HIDDEN_COSTS: Partial<Record<DecisionCategory, { label: string; match: RegExp }[]>> = {
  relocation: [
    { label: 'Visa, permits and document translation', match: /visa|permit|blue card|immigration|translat/i },
    { label: 'Flights and shipping belongings', match: /flight|ship|mov(e|ing)|reloc/i },
    { label: 'Rental deposit and agency fees', match: /deposit|agency|reloc|setup/i },
    { label: 'Temporary housing while searching', match: /temporar|airbnb|hotel|interim/i },
    { label: 'Language courses', match: /language|german|french|class|course/i },
    { label: 'Health insurance before employment starts', match: /insurance|health/i },
    { label: 'Recognition of qualifications', match: /recogni|accredit|diploma|qualif/i },
    { label: 'Trips home to see family', match: /visit|trip|family|home/i },
  ],
  city_move: [
    { label: 'Moving company or van', match: /mov(e|ing)|van|reloc/i },
    { label: 'Deposit and overlapping rent', match: /deposit|overlap|double rent|setup/i },
    { label: 'Change in commuting costs', match: /commut|transport|car|train/i },
  ],
  business: [
    { label: 'Health insurance and pension you now pay yourself', match: /insurance|pension|social/i },
    { label: 'Accounting and legal fees', match: /account|legal|lawyer|admin/i },
    { label: 'Equipment and software', match: /equipment|software|laptop|tool|setup/i },
    { label: 'Marketing to win first clients', match: /marketing|ads|brand|website/i },
    { label: 'Months with no paid holiday or sick pay', match: /holiday|sick|leave/i },
  ],
  housing: [
    { label: 'Purchase taxes, notary and agent fees', match: /purchase|notary|tax|agent/i },
    { label: 'Renovation and furnishing', match: /renovat|furnish|repair/i },
    { label: 'Maintenance and building charges', match: /maint|charge|hoa|condo/i },
    { label: 'Home insurance', match: /insurance/i },
  ],
  job_change: [
    { label: 'Gap between notice period and new start', match: /gap|notice|unemploy/i },
    { label: 'Lost benefits (pension matching, bonus, car)', match: /benefit|pension|bonus|car/i },
  ],
  education: [
    { label: 'Tuition and exam fees', match: /tuition|fee|exam|course/i },
    { label: 'Books, materials and equipment', match: /book|material|equipment|laptop/i },
    { label: 'Income lost while studying', match: /gap|income|study/i },
  ],
  career_change: [
    { label: 'Training and certification fees', match: /tuition|fee|course|certif|bootcamp/i },
    { label: 'Income lost while retraining', match: /gap|retrain|study|income/i },
    { label: 'Entry-level salary in the new field', match: /salary|junior|entry/i },
  ],
  sabbatical: [
    { label: 'Health insurance during the break', match: /insurance|health/i },
    { label: 'Pension contributions you will miss', match: /pension|retire/i },
    { label: 'Job search after returning', match: /search|return|gap/i },
  ],
  family: [
    { label: 'Childcare', match: /child|daycare|nursery|care/i },
    { label: 'Larger home', match: /home|housing|rent|bigger/i },
    { label: 'Income lost during parental leave', match: /leave|parental|income/i },
  ],
  investing: [
    { label: 'Fund and platform fees', match: /fee|cost|platform/i },
    { label: 'Taxes on investment gains', match: /tax/i },
  ],
};

const SOURCE_WEIGHT: Record<string, number> = { missing: 3, system: 2, ai: 2, external: 1, user: 0.5 };

export function buildIntelligence(input: IntelligenceInput): DecisionIntelligence {
  const active = input.scenarios.filter((s) => s.status === 'active' && input.results.has(s.id) && input.models.has(s.id));
  const fxOf = (s: ScenarioDTO) => (s.currency === input.baseCurrency ? { rate: 1, missing: false } : s.exchangeRateToBase ? { rate: s.exchangeRateToBase, missing: false } : { rate: 1, missing: true });
  const items: AnalysisScenario[] = active.map((s) => ({ id: s.id, name: s.name, isBaseline: s.isBaseline, model: input.models.get(s.id)!, result: input.results.get(s.id)!, fx: fxOf(s).rate }));
  const comparableItems = items.filter((i) => !fxOf(active.find((s) => s.id === i.id)!).missing);
  const rob = robustness(comparableItems);
  const baseline = items.find((i) => i.isBaseline) ?? null;
  const breakEvens = baseline ? comparableItems.filter((i) => i.id !== baseline.id).map((i) => breakEven(i, baseline)) : [];
  const mind = comparableItems.length >= 2 ? whatWouldChangeMyMind(comparableItems, { maxPerPair: 3 }) : { leaderId: comparableItems[0]?.id ?? null, changers: [] };

  // Exchange-rate thresholds for scenarios in another currency.
  const fxThresholds: DecisionIntelligence['fxThresholds'] = [];
  const leader = comparableItems.find((i) => i.id === mind.leaderId);
  for (const i of comparableItems) {
    const dto = active.find((s) => s.id === i.id)!;
    if (dto.currency === input.baseCurrency || !leader) continue;
    const rival = i.id === leader.id ? comparableItems.filter((x) => x.id !== i.id).sort((a, b) => b.result.expected.summary.finalNetWorth * b.fx - a.result.expected.summary.finalNetWorth * a.fx)[0] : leader;
    if (!rival) continue;
    const t = fxParity(i, rival);
    if (t) fxThresholds.push({ scenarioId: i.id, rivalId: rival.id, rate: t.rate, current: t.current, currency: dto.currency });
  }

  // Life quality
  const life = active.map((s) => ({ id: s.id, q: lifeQuality(s.scores, input.lifeWeights) }));
  const lifeRanked = life.filter((l) => l.q.score !== null).sort((a, b) => b.q.score! - a.q.score!);
  const lifeLeader = lifeRanked.length >= 2 && lifeRanked[0]!.q.score !== lifeRanked[1]!.q.score ? lifeRanked[0]!.id : lifeRanked.length === 1 ? lifeRanked[0]!.id : null;
  const flips = prioritySensitivity(active.map((s) => ({ id: s.id, scores: s.scores })), input.lifeWeights).flips;

  // Key assumptions: biggest swings across scenarios, weighted by how unverified they are.
  const keyAssumptions: KeyAssumption[] = [];
  for (const i of items) {
    const dto = active.find((s) => s.id === i.id)!;
    for (const sens of i.result.sensitivity.slice(0, 6)) {
      let source: KeyAssumption['source'] = 'user';
      if (sens.key.startsWith('flow:')) source = dto.flows.find((f) => `flow:${f.id}` === sens.key)?.source ?? 'user';
      else if (isVariableKey(sens.key)) {
        const v = dto.variables[sens.key];
        source = !v || v.value === null ? (getVariableDefinition(sens.key).hasSystemDefault ? 'system' : 'missing') : v.source;
      }
      keyAssumptions.push({ scenarioId: i.id, input: sens.key, label: sens.label, swing: sens.swing * i.fx, source, basis: sens.basis });
    }
  }
  keyAssumptions.sort((a, b) => b.swing - a.swing);

  // What to research: high-impact values that are not the person's own.
  const maxSwing = keyAssumptions[0]?.swing ?? 1;
  const toResearch: ResearchItem[] = keyAssumptions
    .filter((k) => k.source !== 'user' || k.basis === 'default')
    .map((k) => ({ k, score: (k.swing / Math.max(1, maxSwing)) * (SOURCE_WEIGHT[k.source] ?? 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ k, score }) => ({
      scenarioId: k.scenarioId,
      input: k.input,
      label: k.label,
      why:
        k.source === 'missing'
          ? 'Not set yet, so it counts as zero.'
          : k.source === 'system'
            ? 'Uses a default or illustrative assumption.'
            : k.source === 'ai'
              ? 'An AI estimate you have not confirmed.'
              : k.source === 'external'
                ? 'From external data — check it still applies to you.'
                : 'Highly influential, but no range has been given for it.',
      priority: score > 1.2 ? 'high' : score > 0.5 ? 'medium' : 'low',
    }));

  // Irreversible commitments
  const irreversible: DecisionIntelligence['irreversible'] = [];
  for (const i of items) {
    const dto = active.find((s) => s.id === i.id)!;
    if (dto.isBaseline) continue;
    const cash = Math.max(1, dto.variables.startingCash?.value ?? 0);
    for (const f of dto.flows) {
      if (f.kind === 'one_time_expense' && (f.amount ?? 0) >= cash * 0.1) irreversible.push({ scenarioId: i.id, text: `${f.label}: a one-off cost you cannot recover.` });
      if (f.kind === 'loan') irreversible.push({ scenarioId: i.id, text: `${f.label}: a loan repaid over ${f.termMonths ?? 60} months whatever happens.` });
      if (f.kind === 'income_gap') irreversible.push({ scenarioId: i.id, text: `${f.label}: months without salary that cannot be earned back later.` });
    }
    if ((dto.variables.propertyPrice?.value ?? 0) > 0) irreversible.push({ scenarioId: i.id, text: 'Buying property: purchase costs are sunk and selling takes time.' });
    if ((dto.variables.incomeStartMonth?.value ?? 0) > 0 && input.category !== 'investing') irreversible.push({ scenarioId: i.id, text: 'Leaving current income: returning to the same role may not be possible.' });
  }

  // Hidden costs checklist
  const checklist = HIDDEN_COSTS[input.category] ?? [];
  const alternatives = active.filter((s) => !s.isBaseline);
  const hiddenCosts: HiddenCost[] = checklist.map((c) => {
    const ids = alternatives.filter((s) => s.flows.some((f) => c.match.test(f.label)) || input.assumptions.some((a) => a.scenarioId === s.id && c.match.test(a.text))).map((s) => s.id);
    return { label: c.label, modelled: ids.length > 0, scenarioIds: ids };
  });

  // Failure modes
  const failureModes: DecisionIntelligence['failureModes'] = [];
  for (const r of rob.scenarios) {
    const i = items.find((x) => x.id === r.id)!;
    const res = i.result;
    if (r.labels.includes('optimism_dependent')) failureModes.push({ scenarioId: r.id, severity: 'high', text: 'Comes out ahead only when assumptions turn out favourably; in most simulated futures it does not lead.' });
    if ((r.shortfallProbability ?? 0) >= 0.25) failureModes.push({ scenarioId: r.id, severity: 'high', text: `Runs out of cash in ${Math.round((r.shortfallProbability ?? 0) * 100)} % of simulated futures.` });
    if (res.cases.worst.summary.finalNetWorth < res.expected.summary.startingNetWorth) failureModes.push({ scenarioId: r.id, severity: 'medium', text: 'In the worst case it ends below today’s net worth.' });
    if (res.expected.summary.firstShortfallMonth !== null) failureModes.push({ scenarioId: r.id, severity: 'high', text: 'Cash goes negative even in the expected case.' });
  }
  // Completeness
  let missing = 0;
  let systemValues = 0;
  let aiValues = 0;
  let total = 0;
  for (const s of active) {
    for (const [, v] of Object.entries(s.variables)) {
      if (!v) continue;
      total++;
      if (v.value === null) missing++;
      else if (v.source === 'system') systemValues++;
      else if (v.source === 'ai') aiValues++;
    }
  }

  const caveats: string[] = [
    'Projections follow from the assumptions shown; they are not forecasts.',
    'Robustness compares scenarios across the same simulated futures (shared random draws), so differences reflect the scenarios, not chance.',
  ];
  if (active.some((s) => fxOf(s).missing)) caveats.push('Scenarios without an exchange rate are left out of cross-scenario comparisons.');
  if (missing > 0) caveats.push(`${missing} assumption${missing === 1 ? ' is' : 's are'} still missing and count${missing === 1 ? 's' : ''} as zero.`);

  return {
    statement: input.question || input.title,
    alternatives: items.map((i) => {
      const dto = active.find((s) => s.id === i.id)!;
      const u = i.result.uncertainty;
      return {
        id: i.id,
        name: i.name,
        isBaseline: i.isBaseline,
        expectedFinal: i.result.expected.summary.finalNetWorth * i.fx,
        p10: u?.hasUncertainty ? u.finalNetWorth.p10 * i.fx : null,
        p90: u?.hasUncertainty ? u.finalNetWorth.p90 * i.fx : null,
        lifeScore: life.find((l) => l.id === i.id)?.q.score ?? null,
        fxMissing: fxOf(dto).missing,
      };
    }),
    financialLeaderId: mind.leaderId,
    robustLeaderId: rob.robustLeaderId,
    lifeLeaderId: lifeLeader,
    robustness: rob,
    breakEvens,
    mindChangers: mind.changers,
    fxThresholds,
    lifeFlips: flips,
    keyAssumptions: keyAssumptions.slice(0, 8),
    toResearch,
    irreversible: irreversible.slice(0, 10),
    hiddenCosts,
    failureModes,
    userRisks: input.assumptions.filter((a) => a.category === 'risk'),
    completeness: { missing, systemValues, aiValues, total },
    caveats,
  };
}
