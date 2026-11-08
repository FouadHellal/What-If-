import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DecisionDTO, DecisionDraft } from '@whatif/shared';
import { Client, createTestApp, type TestApp } from './helpers';
import { AiProviderError } from '../src/services/ai/provider';
import { findUnverifiedNumbers } from '../src/services/ai/grounding';
import { userSettings } from '../src/db/schema';

let t: TestApp;
let c: Client;
let decision: DecisionDTO;

beforeAll(async () => {
  t = await createTestApp();
  c = new Client(t.app);
  await c.register('ai@example.com');
  const id = (await c.post('/api/account/example')).json().id;
  decision = (await c.get(`/api/decisions/${id}`)).json();
});
afterAll(async () => t.close());

const enable = (extra: Record<string, unknown> = {}) =>
  c.put('/api/ai/settings', { enabled: true, provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'sk-ant-test-1234567890', shareProfile: false, dailyLimit: 25, maxOutputTokens: 2000, ...extra });

describe('AI is optional', () => {
  it('reports the analyst as not configured and refuses requests cleanly', async () => {
    const s = (await c.get('/api/ai/settings')).json();
    expect(s).toMatchObject({ enabled: false, configured: false, origin: 'none' });
    const res = await c.post(`/api/decisions/${decision.id}/ai`, { task: 'explain' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ai_disabled');
  });

  it('still drafts decisions without AI', async () => {
    const res = await c.post('/api/decisions/draft', { question: 'What if I start my own business?' });
    expect(res.statusCode).toBe(200);
    expect(res.json().origin).toBe('parser');
  });
});

describe('AI settings', () => {
  it('stores API keys encrypted and never returns them', async () => {
    const res = await enable();
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.configured).toBe(true);
    expect(s.keyHint).toBe('••••7890');
    expect(JSON.stringify(s)).not.toContain('sk-ant-test');
    const rows = await t.database.db.select().from(userSettings);
    const row = rows.find((r) => r.aiApiKeyEnc)!;
    expect(row.aiApiKeyEnc).not.toContain('sk-ant');
    expect(row.aiApiKeyEnc!.startsWith('v1.')).toBe(true);
    const exported = (await c.get('/api/account/export')).body;
    expect(exported).not.toContain('sk-ant');
    expect(exported).not.toContain(row.aiApiKeyEnc!);
  });

  it('only lets administrators point at custom endpoints', async () => {
    const member = new Client(t.app);
    await member.register('member-ai@example.com');
    const res = await member.put('/api/ai/settings', { enabled: true, provider: 'ollama', baseUrl: 'http://10.0.0.5:11434', model: 'llama3', shareProfile: false, dailyLimit: 5, maxOutputTokens: 1000 });
    expect(res.statusCode).toBe(403);
  });
});

describe('AI analysis', () => {
  it('grounds the analysis in stored runs and flags numbers that are not in the facts', async () => {
    await enable();
    const berlin = decision.scenarios.find((s) => s.name === 'Move to Berlin')!;
    t.ai.respond = (req) => {
      const facts = JSON.parse(req.user.slice(req.user.indexOf('\n') + 1));
      const nw = facts.scenarios.find((s: { name: string }) => s.name === 'Move to Berlin').results.finalNetWorth;
      return {
        text: JSON.stringify({
          summary: `Berlin ends at about ${nw.toLocaleString('en-US')} EUR, but rent of 444,444 EUR is invented.`,
          points: [{ title: 'Rent drives the outcome', detail: 'Housing costs matter most.', kind: 'insight' }],
          suggestions: [
            { scenarioId: berlin.id, key: 'housingCostMonthly', value: 1300, low: 1100, high: 1600, rationale: 'Typical for central districts' },
            { scenarioId: berlin.id, key: 'notAKey', value: 1, rationale: 'ignored' },
            { scenarioId: 'other', key: 'housingCostMonthly', value: 1, rationale: 'ignored' },
          ],
        }),
        model: 'fake-1',
        inputTokens: 1000,
        outputTokens: 200,
      };
    };
    const res = await c.post(`/api/decisions/${decision.id}/ai`, { task: 'review' });
    expect(res.statusCode, res.body).toBe(201);
    const a = res.json();
    expect(a.status).toBe('completed');
    expect(a.runIds).toHaveLength(3);
    // The real result is accepted; only the invented figure is flagged.
    expect(a.unverifiedNumbers).toEqual(['444,444']);
    expect(a.output.suggestions).toHaveLength(1);
    expect(a.output.suggestions[0]).toMatchObject({ key: 'housingCostMonthly', value: 1300 });
    // Prompt honours privacy: no profile unless the user opted in.
    const last = t.ai.calls[t.ai.calls.length - 1]!;
    expect(last.user).not.toContain('"profile"');
    expect(last.system).toContain('Use only numbers that appear in FACTS');
    const list = (await c.get(`/api/decisions/${decision.id}/ai`)).json();
    expect(list[0].id).toBe(a.id);
  });

  it('includes the profile only after explicit consent', async () => {
    await c.put('/api/profile', { city: 'Algiers', country: 'Algeria', savings: 777_777 });
    await enable({ shareProfile: true, apiKey: undefined });
    t.ai.respond = () => ({ text: '{"summary":"fine","points":[]}', model: 'fake-1', inputTokens: 1, outputTokens: 1 });
    await c.post(`/api/decisions/${decision.id}/ai`, { task: 'summary' });
    const last = t.ai.calls[t.ai.calls.length - 1]!;
    expect(last.user).toContain('"profile"');
    expect(last.user).toContain('Algiers');
    expect(last.user).not.toContain('777777');
    await enable({ shareProfile: false, apiKey: undefined });
  });

  it('handles an unavailable provider gracefully', async () => {
    t.ai.respond = () => {
      throw new AiProviderError('unavailable', 'Could not reach the AI provider (ECONNREFUSED).');
    };
    const res = await c.post(`/api/decisions/${decision.id}/ai`, { task: 'explain' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('ai_unavailable');
    // The app keeps working.
    expect((await c.get(`/api/decisions/${decision.id}`)).statusCode).toBe(200);
  });

  it('handles malformed AI output', async () => {
    t.ai.respond = () => ({ text: 'Sorry, I cannot help with that.', model: 'fake-1', inputTokens: 1, outputTokens: 1 });
    const res = await c.post(`/api/decisions/${decision.id}/ai`, { task: 'risks' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('ai_bad_response');
  });

  it('falls back to the built-in parser when AI drafting fails, and labels AI drafts', async () => {
    t.ai.respond = () => ({ text: 'not json', model: 'fake-1', inputTokens: 1, outputTokens: 1 });
    const fb = (await c.post('/api/decisions/draft', { question: 'What if I move to Canada?', useAi: true })).json() as DecisionDraft;
    expect(fb.origin).toBe('parser');
    expect(fb.notes[0]).toContain('could not structure');

    t.ai.respond = () => ({
      text: '```json\n' + JSON.stringify({
        category: 'relocation',
        title: 'What if I move to Canada?',
        scenarios: [
          { name: 'Stay', description: 'As now', isBaseline: true, currency: 'EUR', variables: {}, items: [], assumptions: [] },
          { name: 'Move to Toronto', description: 'Relocate', isBaseline: false, currency: 'CAD', variables: { grossAnnualIncome: { value: 90000, low: 75000, high: 105000, note: 'Typical' }, bogus: { value: 1 } }, items: [{ kind: 'one_time_expense', label: 'Moving', amount: 8000, startMonth: 0 }], assumptions: [{ text: 'Work permit granted', category: 'assumption' }] },
        ],
      }) + '\n```',
      model: 'fake-1',
      inputTokens: 1,
      outputTokens: 1,
    });
    const draft = (await c.post('/api/decisions/draft', { question: 'What if I move to Canada?', useAi: true })).json() as DecisionDraft;
    expect(draft.origin).toBe('ai');
    const toronto = draft.scenarios[1]!;
    expect(toronto.variables.grossAnnualIncome).toMatchObject({ value: 90000, source: 'ai' });
    expect(toronto.exchangeRateToBase).toBeNull();
    expect(toronto.flows[0]!.source).toBe('ai');
    const created = await c.post('/api/decisions', { ...draft });
    expect(created.statusCode, created.body).toBe(201);
  });

  it('enforces the daily request limit', async () => {
    await enable({ dailyLimit: 1, apiKey: undefined });
    const res = await c.post(`/api/decisions/${decision.id}/ai`, { task: 'explain' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('ai_quota');
    await enable({ dailyLimit: 25, apiKey: undefined });
  });
});

describe('grounding check', () => {
  it('matches rounded and percentage forms of fact values', () => {
    const facts = { a: 338_412, p: 0.27, months: 4 };
    expect(findUnverifiedNumbers('About €340k, a 27 % chance, after 4 months, in 2031.', facts)).toEqual([]);
    expect(findUnverifiedNumbers('You will have 500,000 EUR.', facts)).toEqual(['500,000']);
  });
});

describe('reports', () => {
  it('creates a frozen snapshot and exports a PDF', async () => {
    const res = await c.post(`/api/decisions/${decision.id}/reports`, { includeAiSummary: true });
    expect(res.statusCode, res.body).toBe(201);
    const r = res.json();
    expect(r.snapshot.scenarios).toHaveLength(3);
    expect(r.snapshot.comparison.length).toBeGreaterThan(5);
    expect(r.snapshot.aiSummary).not.toBeNull();
    const pdf = await t.app.inject({ url: `/api/reports/${r.id}/pdf`, headers: { cookie: c.cookie } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.rawPayload.length).toBeGreaterThan(5000);
    const list = (await c.get(`/api/decisions/${decision.id}/reports`)).json();
    expect(list[0].id).toBe(r.id);
  });
});

describe('account', () => {
  it('exports all data and deletes the account with everything in it', async () => {
    const u = new Client(t.app);
    await u.register('leaving@example.com');
    const id = (await u.post('/api/account/example')).json().id;
    await u.post('/api/journal', { type: 'note', title: 'Hello', body: '', entryDate: '2027-01-01' });
    const exp = await u.get('/api/account/export');
    expect(exp.headers['content-disposition']).toContain('attachment');
    const data = exp.json();
    expect(data.format).toBe('what-if-export');
    expect(data.decisions).toHaveLength(1);
    expect(data.decisions[0].scenarios).toHaveLength(3);
    expect(data.journal.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(data)).not.toContain('passwordHash');

    expect((await u.del('/api/account', { password: 'wrong password', confirm: 'DELETE' })).statusCode).toBe(400);
    expect((await u.del('/api/account', { password: 'correct horse battery', confirm: 'nope' })).statusCode).toBe(400);
    expect((await u.del('/api/account', { password: 'correct horse battery', confirm: 'DELETE' })).statusCode).toBe(200);
    expect((await u.get('/api/auth/session')).statusCode).toBe(401);
    const { decisions, scenarios, journalEntries } = await import('../src/db/schema');
    const { eq } = await import('drizzle-orm');
    expect(await t.database.db.select().from(decisions).where(eq(decisions.id, id))).toHaveLength(0);
    expect(await t.database.db.select().from(scenarios).where(eq(scenarios.decisionId, id))).toHaveLength(0);
    expect((await t.database.db.select().from(journalEntries)).every((j) => j.title !== 'Hello')).toBe(true);
  });

  it('lists audit events for the user', async () => {
    const events = (await c.get('/api/account/audit')).json();
    const actions = events.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.register', 'ai.settings_updated', 'report.created']));
    expect(JSON.stringify(events)).not.toContain('sk-ant');
  });
});

describe('database unavailable', () => {
  it('reports a degraded health check', async () => {
    const { buildApp } = await import('../src/app');
    const broken = { ...t.database, ping: async () => false };
    const app = await buildApp({ config: t.config, database: broken, logger: false });
    const res = await app.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().database).toBe('unreachable');
    await app.close();
  });
});
