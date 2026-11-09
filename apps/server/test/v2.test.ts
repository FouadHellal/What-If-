import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simulate } from '@whatif/engine';
import { simulationOptions, type DecisionDTO, type ExperimentDTO, type ScenarioDTO } from '@whatif/shared';
import { Client, createTestApp, type TestApp } from './helpers';
import { toEngineModel } from '../src/services/scenarios';

let t: TestApp;
let c: Client;
let other: Client;
let d: DecisionDTO;

beforeAll(async () => {
  t = await createTestApp();
  c = new Client(t.app);
  await c.register('v2@example.com');
  other = new Client(t.app);
  await other.register('v2-other@example.com');
  const id = (await c.post('/api/account/example')).json().id;
  d = (await c.get(`/api/decisions/${id}`)).json();
});
afterAll(async () => t.close());

const berlin = () => d.scenarios.find((s) => s.name === 'Move to Berlin')!;

describe('decision settings', () => {
  it('stores goals, run count and memory, and runs use them', async () => {
    const res = await c.patch(`/api/decisions/${d.id}`, {
      settings: { runs: 1000, goals: [{ id: 'g1', label: '€100k by the end', kind: 'net_worth_at', target: 100_000, date: null }], memory: { objectives: 'Grow my career in Europe', riskStance: 'balanced' } },
    });
    expect(res.statusCode, res.body).toBe(200);
    d = res.json();
    expect(d.settings.runs).toBe(1000);
    expect(d.settings.memory?.objectives).toBe('Grow my career in Europe');
    // Merging keeps earlier fields.
    d = (await c.patch(`/api/decisions/${d.id}`, { settings: { memory: { constraints: 'Partner must find work too' } } })).json();
    expect(d.settings.memory).toMatchObject({ objectives: 'Grow my career in Europe', constraints: 'Partner must find work too' });
    expect(d.settings.goals).toHaveLength(1);

    const run = (await c.get(`/api/scenarios/${berlin().id}/simulation`)).json();
    expect(run.runs).toBe(1000);
    expect(run.result.goals[0]).toMatchObject({ id: 'g1', label: '€100k by the end' });
    expect(run.result.goals[0].probability).toBeGreaterThanOrEqual(0);
    // The browser computes the same options, so hashes match the stored run.
    const s = berlin();
    const options = simulationOptions(d.settings, s, d.baseCurrency);
    expect(simulate(toEngineModel(s), options).inputHash).toBe(run.inputHash);
    expect((await c.get(`/api/decisions/${d.id}`)).json().scenarios.find((x: ScenarioDTO) => x.id === s.id).latestRun.inputHash).toBe(run.inputHash);
  });

  it('converts goals into each scenario’s currency', () => {
    const algiers = d.scenarios.find((s) => s.currency === 'DZD')!;
    const o = simulationOptions(d.settings, algiers, 'EUR');
    expect(o.goals![0]!.target).toBeCloseTo(100_000 / algiers.exchangeRateToBase!, 0);
  });

  it('rejects invalid settings', async () => {
    expect((await c.patch(`/api/decisions/${d.id}`, { settings: { runs: 50_000 } })).statusCode).toBe(400);
  });
});

describe('scenario model v2', () => {
  it('persists tax schedules and the new flow kinds', async () => {
    const s = berlin();
    const res = await c.put(`/api/scenarios/${s.id}/model`, {
      expectedVersion: s.version,
      startDate: s.startDate,
      horizonYears: s.horizonYears,
      currency: s.currency,
      exchangeRateToBase: s.exchangeRateToBase,
      variables: s.variables,
      scores: { career: 5, family: 2, freedom: 4 },
      tax: { brackets: [{ upTo: 12_000, rate: 0 }, { upTo: 60_000, rate: 30 }, { upTo: null, rate: 42 }], flatRate: 10 },
      flows: [
        ...s.flows,
        { id: 'loan1', kind: 'loan', label: 'Relocation loan', amount: 5_000, rate: 5, termMonths: 36, startMonth: 0, source: 'user' },
        { id: 'gap1', kind: 'income_gap', label: 'Language course', amount: null, startMonth: 24, endMonth: 27, source: 'user' },
        { id: 'raise', kind: 'salary_change', label: 'Senior role', amount: 70_000, startMonth: 36, source: 'user' },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const saved = res.json() as ScenarioDTO;
    expect(saved.tax?.brackets).toHaveLength(3);
    expect(saved.scores).toMatchObject({ career: 5, freedom: 4 });
    const loan = saved.flows.find((f) => f.id === 'loan1')!;
    expect(loan).toMatchObject({ kind: 'loan', rate: 5, termMonths: 36 });
    const run = (await c.get(`/api/scenarios/${s.id}/simulation`)).json();
    expect(run.result.expected.summary.effectiveTaxRateYear1).toBeGreaterThan(20);
    d = (await c.get(`/api/decisions/${d.id}`)).json();
  });
});

describe('decision lab', () => {
  let exp: ExperimentDTO;

  it('runs an experiment without touching the original scenario', async () => {
    const s = berlin();
    const res = await c.post(`/api/decisions/${d.id}/experiments`, { scenarioId: s.id, name: 'Lower salary', changes: { grossAnnualIncome: 48_000, housingCostMonthly: 1_400 } });
    expect(res.statusCode, res.body).toBe(201);
    exp = res.json();
    expect(exp.variant.finalNetWorth).toBeLessThan(exp.original.finalNetWorth);
    expect(exp.stale).toBe(false);
    expect(exp.changes).toEqual({ grossAnnualIncome: 48_000, housingCostMonthly: 1_400 });
    const after = (await c.get(`/api/decisions/${d.id}`)).json() as DecisionDTO;
    expect(after.scenarios.find((x) => x.id === s.id)!.version).toBe(s.version);
    const detail = (await c.get(`/api/experiments/${exp.id}`)).json();
    expect(detail.inputs.variables.grossAnnualIncome.value).toBe(48_000);
    expect(detail.baseInputs.variables.grossAnnualIncome.value).toBe(s.variables.grossAnnualIncome!.value);
    expect((await c.get(`/api/decisions/${d.id}/experiments`)).json()).toHaveLength(1);
  });

  it('rejects unknown inputs and other users', async () => {
    expect((await c.post(`/api/decisions/${d.id}/experiments`, { scenarioId: berlin().id, name: 'x', changes: { notAThing: 1 } })).statusCode).toBe(400);
    expect((await other.get(`/api/experiments/${exp.id}`)).statusCode).toBe(404);
    expect((await other.post(`/api/experiments/${exp.id}/apply`, { mode: 'new' })).statusCode).toBe(404);
  });

  it('saves an experiment as a new scenario, then applies it in place', async () => {
    const asNew = await c.post(`/api/experiments/${exp.id}/apply`, { mode: 'new' });
    expect(asNew.statusCode).toBe(201);
    const after = (await c.get(`/api/decisions/${d.id}`)).json() as DecisionDTO;
    const created = after.scenarios.find((x) => x.id === asNew.json().scenarioId)!;
    expect(created.name).toBe('Lower salary');
    expect(created.variables.grossAnnualIncome!.value).toBe(48_000);
    const inPlace = await c.post(`/api/experiments/${exp.id}/apply`, { mode: 'update' });
    expect(inPlace.statusCode).toBe(200);
    const s2 = (await c.get(`/api/decisions/${d.id}`)).json().scenarios.find((x: ScenarioDTO) => x.id === berlin().id);
    expect(s2.variables.grossAnnualIncome.value).toBe(48_000);
    expect(s2.version).toBe(berlin().version + 1);
    // Now stale: applying again would overwrite newer work.
    const list = (await c.get(`/api/decisions/${d.id}/experiments`)).json() as ExperimentDTO[];
    expect(list[0]!.stale).toBe(true);
    expect((await c.post(`/api/experiments/${exp.id}/apply`, { mode: 'update' })).statusCode).toBe(409);
  });
});

describe('evidence and research', () => {
  it('stores cited evidence entered by hand', async () => {
    const res = await c.post(`/api/decisions/${d.id}/evidence`, { label: 'Median rent, 1-bed, Berlin', value: 1_250, unit: 'EUR/month', sourceName: 'City rent index', sourceUrl: 'https://example.org/rents', retrievedOn: '2026-11-01', coverage: 'Berlin, 2026' });
    expect(res.statusCode, res.body).toBe(201);
    expect((await c.get(`/api/decisions/${d.id}/evidence`)).json()[0].sourceName).toBe('City rent index');
    expect((await other.get(`/api/decisions/${d.id}/evidence`)).statusCode).toBe(404);
  });

  it('looks up an ECB exchange rate with source and date', async () => {
    t.net.respond = (url) => (url.includes('frankfurter') ? { status: 200, body: { amount: 1, base: 'EUR', date: '2026-11-06', rates: { CAD: 1.49 } } } : { status: 404, body: {} });
    const res = await c.post(`/api/decisions/${d.id}/research`, { kind: 'exchange_rate', from: 'EUR', to: 'CAD' });
    expect(res.statusCode, res.body).toBe(201);
    const e = res.json();
    expect(e).toMatchObject({ value: 1.49, origin: 'ecb', unit: 'CAD per EUR' });
    expect(e.coverage).toContain('2026-11-06');
    expect(t.net.calls.at(-1)).toContain('from=EUR&to=CAD');
  });

  it('explains when a source does not cover a currency', async () => {
    t.net.respond = () => ({ status: 404, body: { message: 'not found' } });
    const res = await c.post(`/api/decisions/${d.id}/research`, { kind: 'exchange_rate', from: 'DZD', to: 'EUR' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toContain('does not publish');
  });

  it('looks up World Bank inflation and handles outages', async () => {
    t.net.respond = (url) => (url.includes('worldbank') ? { status: 200, body: [{ page: 1 }, [{ date: '2025', value: 2.31, country: { value: 'Germany' } }]] } : { status: 404, body: {} });
    const res = await c.post(`/api/decisions/${d.id}/research`, { kind: 'inflation', country: 'Germany' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ value: 2.31, origin: 'worldbank' });
    t.net.respond = () => {
      throw new Error('ECONNREFUSED');
    };
    const down = await c.post(`/api/decisions/${d.id}/research`, { kind: 'inflation', country: 'Germany' });
    expect(down.statusCode).toBe(502);
  });
});

describe('analyst conversation', () => {
  it('answers with evidence-typed statements, flags invented numbers and suggests memory', async () => {
    await c.put('/api/ai/settings', { enabled: true, provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'sk-ant-test-0000000000', shareProfile: false, dailyLimit: 25, maxOutputTokens: 2000 });
    t.ai.respond = (req) => {
      const ctx = JSON.parse(req.user.slice(req.user.indexOf('\n') + 1, req.user.indexOf('\n\n')));
      expect(ctx.ANALYSIS.robustness).not.toBeNull();
      expect(ctx.MEMORY.objectives).toBe('Grow my career in Europe');
      expect(ctx.EVIDENCE.length).toBeGreaterThan(0);
      return {
        text: JSON.stringify({
          answer: [
            { text: `The expected leader is ${ctx.ANALYSIS.expectedLeader}.`, basis: 'model' },
            { text: 'It could reach 987,654 if all goes well.', basis: 'interpretation' },
          ],
          followUps: ['What if rent is higher?'],
          memoryFacts: ['Prefers to stay within the EU'],
        }),
        model: 'fake-1',
        inputTokens: 1,
        outputTokens: 1,
      };
    };
    const res = await c.post(`/api/decisions/${d.id}/ai/chat`, { message: 'Which option is strongest and why?' });
    expect(res.statusCode, res.body).toBe(201);
    const [q, a] = res.json();
    expect(q.role).toBe('user');
    expect(a.parts[0].basis).toBe('model');
    expect(a.unverifiedNumbers).toEqual(['987,654']);
    expect(a.followUps).toEqual(['What if rent is higher?']);
    expect(a.suggestedFacts).toEqual(['Prefers to stay within the EU']);
    // Facts are only suggested; memory is unchanged until the person saves it.
    expect((await c.get(`/api/decisions/${d.id}`)).json().settings.memory.facts).toBeUndefined();
    expect((await c.get(`/api/decisions/${d.id}/ai/chat`)).json()).toHaveLength(2);
    expect((await other.get(`/api/decisions/${d.id}/ai/chat`)).statusCode).toBe(404);
  });

  it('includes earlier turns and can be cleared', async () => {
    t.ai.respond = (req) => {
      expect(req.user).toContain('CONVERSATION SO FAR');
      expect(req.user).toContain('Which option is strongest');
      return { text: JSON.stringify({ answer: [{ text: 'Noted.', basis: 'interpretation' }] }), model: 'fake-1', inputTokens: 1, outputTokens: 1 };
    };
    expect((await c.post(`/api/decisions/${d.id}/ai/chat`, { message: 'And the strongest argument against it?' })).statusCode).toBe(201);
    expect((await c.del(`/api/decisions/${d.id}/ai/chat`)).statusCode).toBe(200);
    expect((await c.get(`/api/decisions/${d.id}/ai/chat`)).json()).toHaveLength(0);
  });

  it('reports provider failures without losing the app', async () => {
    t.ai.respond = () => ({ text: 'nonsense', model: 'fake-1', inputTokens: 1, outputTokens: 1 });
    const res = await c.post(`/api/decisions/${d.id}/ai/chat`, { message: 'Hello?' });
    expect(res.statusCode).toBe(502);
  });
});

describe('overview', () => {
  it('lists recent experiments and attention items', async () => {
    const o = (await c.get('/api/overview')).json();
    expect(o.recentExperiments[0].name).toBe('Lower salary');
    expect(typeof o.recentExperiments[0].delta).toBe('number');
    expect(o.profileCompleteness).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(o.attention)).toBe(true);
  });
});
