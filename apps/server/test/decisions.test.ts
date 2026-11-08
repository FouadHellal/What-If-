import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '@whatif/engine';
import type { DecisionDTO, DecisionDraft, ScenarioDTO } from '@whatif/shared';
import { Client, createTestApp, type TestApp } from './helpers';

let t: TestApp;
let alice: Client;
let bob: Client;

beforeAll(async () => {
  t = await createTestApp();
  alice = new Client(t.app);
  await alice.register('alice@example.com');
  bob = new Client(t.app);
  await bob.register('bob@example.com');
  await alice.put('/api/profile', { currency: 'EUR', savings: 20_000, annualIncome: 50_000, effectiveTaxRate: 30, monthlyHousingCost: 900, monthlyLivingCost: 1_100, planningHorizonYears: 5, country: 'France', city: 'Lyon' });
});
afterAll(async () => t.close());

function modelBody(s: ScenarioDTO, patch: Partial<ScenarioDTO> = {}) {
  const m = { ...s, ...patch };
  return { expectedVersion: m.version, startDate: m.startDate, horizonYears: m.horizonYears, currency: m.currency, exchangeRateToBase: m.exchangeRateToBase, exchangeRateSource: m.exchangeRateSource, variables: m.variables, flows: m.flows, scores: m.scores };
}

async function createFromQuestion(c: Client, question: string): Promise<DecisionDTO> {
  const draft = (await c.post('/api/decisions/draft', { question })).json() as DecisionDraft;
  const res = await c.post('/api/decisions', { ...draft, origin: 'parser' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

describe('creating decisions', () => {
  it('drafts from natural language using the baseline profile', async () => {
    const res = await alice.post('/api/decisions/draft', { question: 'What if I relocate from Lyon to Paris?' });
    expect(res.statusCode).toBe(200);
    const d = res.json() as DecisionDraft;
    expect(d.category).toBe('city_move');
    expect(d.baseCurrency).toBe('EUR');
    expect(d.horizonYears).toBe(5);
    expect(d.scenarios[0]!.variables.startingCash).toMatchObject({ value: 20_000, source: 'user' });
    expect(d.scenarios[1]!.variables.grossAnnualIncome!.value).toBeNull();
  });

  it('creates a decision with scenarios, variables, flows and assumptions', async () => {
    const d = await createFromQuestion(alice, 'What if I relocate from Lyon to Paris?');
    expect(d.scenarios).toHaveLength(2);
    expect(d.scenarios.filter((s) => s.isBaseline)).toHaveLength(1);
    expect(d.scenarios[1]!.flows[0]!.label).toBe('Relocation & setup');
    expect(d.assumptions.length).toBeGreaterThan(0);
    expect(d.scenarios[0]!.version).toBe(1);
  });

  it('serves template drafts for every category', async () => {
    for (const cat of ['relocation', 'housing', 'business', 'family', 'other']) {
      const res = await alice.get(`/api/decisions/templates/${cat}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().scenarios.length).toBeGreaterThanOrEqual(2);
    }
    expect((await alice.get('/api/decisions/templates/nonsense')).statusCode).toBe(400);
  });

  it('validates input', async () => {
    const res = await alice.post('/api/decisions', { title: 'x', baseCurrency: 'EUR', horizonYears: 5, scenarios: [] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.fields.length).toBeGreaterThan(0);
  });
});

describe('listing', () => {
  it('searches, filters and paginates', async () => {
    await createFromQuestion(alice, 'What if I buy a house instead of renting?');
    await createFromQuestion(alice, 'What if I invest 300 EUR per month?');
    const all = (await alice.get('/api/decisions?pageSize=2')).json();
    expect(all.total).toBeGreaterThanOrEqual(3);
    expect(all.items).toHaveLength(2);
    const page2 = (await alice.get('/api/decisions?pageSize=2&page=2')).json();
    expect(page2.items[0].id).not.toBe(all.items[0].id);
    const found = (await alice.get('/api/decisions?q=house')).json();
    expect(found.items.map((i: { category: string }) => i.category)).toEqual(['housing']);
    const byCat = (await alice.get('/api/decisions?category=investing')).json();
    expect(byCat.total).toBe(1);
    expect(byCat.items[0].scenarioCount).toBe(2);
  });
});

describe('authorization', () => {
  it('never exposes one user’s data to another', async () => {
    const d = await createFromQuestion(alice, 'What if I take a year off?');
    const sid = d.scenarios[0]!.id;
    expect((await bob.get(`/api/decisions/${d.id}`)).statusCode).toBe(404);
    expect((await bob.patch(`/api/decisions/${d.id}`, { title: 'Hijacked decision' })).statusCode).toBe(404);
    expect((await bob.del(`/api/decisions/${d.id}`)).statusCode).toBe(404);
    expect((await bob.put(`/api/scenarios/${sid}/model`, modelBody(d.scenarios[0]!))).statusCode).toBe(404);
    expect((await bob.get(`/api/scenarios/${sid}/simulation`)).statusCode).toBe(404);
    expect((await bob.post(`/api/decisions/${d.id}/milestones`, { title: 'x', date: '2030-01' })).statusCode).toBe(404);
    expect((await bob.post(`/api/decisions/${d.id}/reports`, {})).statusCode).toBe(404);
    expect((await bob.post('/api/journal', { decisionId: d.id, type: 'note', title: 'x', entryDate: '2027-01-01' })).statusCode).toBe(400);
    const run = (await alice.get(`/api/scenarios/${sid}/simulation`)).json();
    expect((await bob.get(`/api/runs/${run.id}`)).statusCode).toBe(404);
    expect((await bob.get('/api/decisions')).json().total).toBe(0);
    expect((await alice.get(`/api/decisions/${d.id}`)).statusCode).toBe(200);
  });

  it('rejects malformed ids', async () => {
    expect((await alice.get('/api/decisions/not-a-uuid')).statusCode).toBe(400);
  });
});

describe('scenario editing, versioning and isolation', () => {
  let d: DecisionDTO;
  beforeAll(async () => {
    d = await createFromQuestion(alice, 'What if I leave my current job?');
  });

  it('updates a model, bumps the version and stores an immutable run', async () => {
    const s = d.scenarios[1]!;
    const res = await alice.put(`/api/scenarios/${s.id}/model`, modelBody(s, { variables: { ...s.variables, grossAnnualIncome: { value: 65_000, source: 'user' } } }));
    expect(res.statusCode, res.body).toBe(200);
    const updated = res.json() as ScenarioDTO;
    expect(updated.version).toBe(2);
    expect(updated.variables.grossAnnualIncome!.value).toBe(65_000);
    expect(updated.latestRun).not.toBeNull();
    const runs = (await alice.get(`/api/scenarios/${s.id}/runs`)).json();
    expect(runs).toHaveLength(1);
  });

  it('rejects stale writes with 409 (concurrent updates)', async () => {
    const s = (await alice.get(`/api/decisions/${d.id}`)).json().scenarios[1] as ScenarioDTO;
    const a = alice.put(`/api/scenarios/${s.id}/model`, modelBody(s, { horizonYears: 6 }));
    const b = alice.put(`/api/scenarios/${s.id}/model`, modelBody(s, { horizonYears: 7 }));
    const results = await Promise.all([a, b]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    const conflict = results.find((r) => r.statusCode === 409)!.json();
    expect(conflict.error.details.current.version).toBe(s.version + 1);
  });

  it('keeps scenarios isolated from each other', async () => {
    const fresh = (await alice.get(`/api/decisions/${d.id}`)).json() as DecisionDTO;
    const [base, alt] = fresh.scenarios as [ScenarioDTO, ScenarioDTO];
    const before = JSON.stringify({ v: base.variables, f: base.flows, version: base.version });
    const baseRunBefore = (await alice.get(`/api/scenarios/${base.id}/simulation`)).json();
    await alice.put(`/api/scenarios/${alt.id}/model`, modelBody(alt, { variables: { ...alt.variables, livingCostMonthly: { value: 4_000, source: 'user' } } }));
    const after = (await alice.get(`/api/decisions/${d.id}`)).json() as DecisionDTO;
    const baseAfter = after.scenarios.find((s) => s.id === base.id)!;
    expect(JSON.stringify({ v: baseAfter.variables, f: baseAfter.flows, version: baseAfter.version })).toBe(before);
    const baseRunAfter = (await alice.get(`/api/scenarios/${base.id}/simulation`)).json();
    expect(baseRunAfter.id).toBe(baseRunBefore.id);
    expect(baseRunAfter.result.inputHash).toBe(baseRunBefore.result.inputHash);
  });

  it('duplicates a scenario without linking the copies', async () => {
    const fresh = (await alice.get(`/api/decisions/${d.id}`)).json() as DecisionDTO;
    const src = fresh.scenarios[1]!;
    const res = await alice.post(`/api/decisions/${d.id}/scenarios`, { fromScenarioId: src.id });
    expect(res.statusCode).toBe(201);
    const copy = res.json() as ScenarioDTO;
    expect(copy.name).toBe(`${src.name} (copy)`);
    expect(copy.isBaseline).toBe(false);
    expect(copy.variables).toEqual(src.variables);
    await alice.put(`/api/scenarios/${copy.id}/model`, modelBody(copy, { variables: { ...copy.variables, grossAnnualIncome: { value: 1, source: 'user' } } }));
    const srcAfter = (await alice.get(`/api/decisions/${d.id}`)).json().scenarios.find((s: ScenarioDTO) => s.id === src.id);
    expect(srcAfter.variables.grossAnnualIncome.value).toBe(src.variables.grossAnnualIncome!.value);
  });

  it('preserves historical runs and reproduces them exactly', async () => {
    const fresh = (await alice.get(`/api/decisions/${d.id}`)).json() as DecisionDTO;
    const s = fresh.scenarios[1]!;
    const runsBefore = (await alice.get(`/api/scenarios/${s.id}/runs`)).json();
    await alice.put(`/api/scenarios/${s.id}/model`, modelBody(s, { variables: { ...s.variables, monthlyInvestment: { value: 250, source: 'user' } } }));
    const runsAfter = (await alice.get(`/api/scenarios/${s.id}/runs`)).json();
    expect(runsAfter.length).toBe(runsBefore.length + 1);
    const oldest = runsAfter[runsAfter.length - 1];
    const old = (await alice.get(`/api/runs/${oldest.id}`)).json();
    expect(old.inputs.model.variables.monthlyInvestment?.value ?? 0).not.toBe(250);
    const verify = (await alice.post(`/api/runs/${oldest.id}/verify`)).json();
    expect(verify.reproducible).toBe(true);
    // The browser runs the same engine; identical inputs give an identical hash.
    expect(simulate(old.inputs.model, old.inputs.options).inputHash).toBe(old.inputHash);
  });

  it('rejects invalid assumptions', async () => {
    const s = (await alice.get(`/api/decisions/${d.id}`)).json().scenarios[0] as ScenarioDTO;
    const neg = await alice.put(`/api/scenarios/${s.id}/model`, modelBody(s, { flows: [{ id: 'x', kind: 'expense', label: 'Bad', amount: -5, startMonth: 0, source: 'user' }] }));
    expect(neg.statusCode).toBe(400);
    const huge = await alice.put(`/api/scenarios/${s.id}/model`, modelBody(s, { horizonYears: 500 }));
    expect(huge.statusCode).toBe(400);
    const cur = await alice.put(`/api/scenarios/${s.id}/model`, modelBody(s, { currency: 'euros' }));
    expect(cur.statusCode).toBe(400);
  });

  it('moves the baseline when the baseline scenario is deleted, and cleans up its runs', async () => {
    const fresh = (await alice.get(`/api/decisions/${d.id}`)).json() as DecisionDTO;
    const base = fresh.scenarios.find((s) => s.isBaseline)!;
    const run = (await alice.get(`/api/scenarios/${base.id}/simulation`)).json();
    expect((await alice.del(`/api/scenarios/${base.id}`)).statusCode).toBe(200);
    const after = (await alice.get(`/api/decisions/${d.id}`)).json() as DecisionDTO;
    expect(after.scenarios.find((s) => s.id === base.id)).toBeUndefined();
    expect(after.scenarios.filter((s) => s.isBaseline)).toHaveLength(1);
    expect((await alice.get(`/api/runs/${run.id}`)).statusCode).toBe(404);
    expect((await alice.get(`/api/scenarios/${base.id}/simulation`)).statusCode).toBe(404);
    expect((await alice.put(`/api/scenarios/${base.id}/model`, modelBody(base))).statusCode).toBe(404);
  });

  it('switches the baseline and refuses to archive it', async () => {
    const fresh = (await alice.get(`/api/decisions/${d.id}`)).json() as DecisionDTO;
    const other = fresh.scenarios.find((s) => !s.isBaseline)!;
    await alice.patch(`/api/scenarios/${other.id}`, { isBaseline: true });
    const after = (await alice.get(`/api/decisions/${d.id}`)).json() as DecisionDTO;
    expect(after.scenarios.filter((s) => s.isBaseline).map((s) => s.id)).toEqual([other.id]);
    expect((await alice.patch(`/api/scenarios/${other.id}`, { status: 'archived' })).statusCode).toBe(400);
  });
});

describe('milestones, assumptions and decisions', () => {
  it('records the final decision, pins the run and compares check-ins with the projection', async () => {
    const d = await createFromQuestion(alice, 'What if I invest 500 EUR per month?');
    const chosen = d.scenarios[1]!;
    const m = await alice.post(`/api/decisions/${d.id}/milestones`, { title: 'First review', date: chosen.startDate, scenarioId: chosen.id });
    expect(m.statusCode).toBe(201);
    expect((await alice.patch(`/api/milestones/${m.json().id}`, { status: 'achieved', achievedOn: '2027-02-01' })).json().status).toBe('achieved');
    const a = await alice.post(`/api/decisions/${d.id}/assumptions`, { text: 'Markets may fall for years', category: 'risk', scenarioId: chosen.id, likelihood: 'medium', impact: 'high' });
    expect(a.statusCode).toBe(201);

    const decided = await alice.post(`/api/decisions/${d.id}/decide`, { chosenScenarioId: chosen.id, rationale: 'Long-term growth', expectations: 'Stay the course' });
    expect(decided.statusCode).toBe(200);
    const dd = decided.json() as DecisionDTO;
    expect(dd.status).toBe('decided');
    expect(dd.decidedRunId).toBeTruthy();

    const journal = (await alice.get(`/api/journal?decisionId=${d.id}`)).json();
    expect(journal.items.some((j: { type: string }) => j.type === 'decision')).toBe(true);

    const checkin = await alice.post('/api/journal', {
      decisionId: d.id,
      scenarioId: chosen.id,
      type: 'checkin',
      title: 'Six months in',
      body: 'On track.',
      entryDate: `${chosen.startDate}-15`,
      actuals: { netWorth: 21_000, cash: 15_000 },
    });
    expect(checkin.statusCode, checkin.body).toBe(201);
    const j = checkin.json();
    expect(j.projected).not.toBeNull();
    expect(typeof j.projected.netWorth).toBe('number');
    expect(j.actuals.netWorth).toBe(21_000);
  });

  it('keeps the journal when a decision is deleted', async () => {
    const d = await createFromQuestion(alice, 'What if we start a family?');
    const e = await alice.post('/api/journal', { decisionId: d.id, type: 'reasoning', title: 'Why', body: 'Because', entryDate: '2027-01-01' });
    await alice.del(`/api/decisions/${d.id}`);
    const all = (await alice.get('/api/journal')).json();
    const kept = all.items.find((i: { id: string }) => i.id === e.json().id);
    expect(kept).toBeTruthy();
    expect(kept.decisionId).toBeNull();
  });
});

describe('overview and example', () => {
  it('creates an example decision that is clearly flagged and removable', async () => {
    const c = new Client(t.app);
    await c.register('example@example.com');
    const res = await c.post('/api/account/example');
    expect(res.statusCode).toBe(201);
    const d = (await c.get(`/api/decisions/${res.json().id}`)).json() as DecisionDTO;
    expect(d.isExample).toBe(true);
    expect(d.scenarios).toHaveLength(3);
    expect(d.milestones.length).toBeGreaterThan(0);
    expect(d.scenarios.every((s) => s.latestRun !== null)).toBe(true);
    const overview = (await c.get('/api/overview')).json();
    expect(overview.hasExample).toBe(true);
    expect(overview.activeDecisions[0].preview.every((p: { finalNetWorth: number | null }) => p.finalNetWorth !== null)).toBe(true);
    expect((await c.del('/api/account/examples')).json().removed).toBe(1);
    expect((await c.get('/api/overview')).json().hasExample).toBe(false);
  });
});
