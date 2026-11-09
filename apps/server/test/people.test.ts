import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminUserDTO, DecisionDTO, DecisionSummaryDTO, Paginated } from '@whatif/shared';
import { Client, createTestApp, type TestApp } from './helpers';

let t: TestApp;
let admin: Client;
let partner: Client;
let stranger: Client;
let partnerId: string;
let strangerId: string;
let d: DecisionDTO;

const PASSWORD = 'a long temporary password';

beforeAll(async () => {
  t = await createTestApp();
  admin = new Client(t.app);
  await admin.register('owner@example.com', 'correct horse battery', 'Fouad');
  // Registration closed: the administrator creates accounts instead.
  await admin.put('/api/admin/settings', { registrationOpen: false });
  const id = (await admin.post('/api/account/example')).json().id;
  d = (await admin.get(`/api/decisions/${id}`)).json();
});
afterAll(async () => t.close());

describe('accounts created by the administrator', () => {
  it('creates an account that can sign in even with registration closed', async () => {
    const res = await admin.post('/api/admin/users', { email: ' Partner@Example.com ', name: 'Sara', password: PASSWORD });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ email: 'partner@example.com', name: 'Sara', role: 'member' });
    partnerId = res.json().id;
    partner = new Client(t.app);
    expect((await partner.login('partner@example.com', PASSWORD)).statusCode).toBe(200);
    expect((await new Client(t.app).post('/api/auth/register', { email: 'x@example.com', password: PASSWORD, name: 'X' })).statusCode).toBe(403);

    const s = await admin.post('/api/admin/users', { email: 'stranger@example.com', name: 'Someone', password: PASSWORD });
    strangerId = s.json().id;
    stranger = new Client(t.app);
    await stranger.login('stranger@example.com', PASSWORD);
  });

  it('rejects duplicates, weak passwords and non-admins', async () => {
    expect((await admin.post('/api/admin/users', { email: 'partner@example.com', name: 'Again', password: PASSWORD })).statusCode).toBe(409);
    expect((await admin.post('/api/admin/users', { email: 'short@example.com', name: 'Short', password: 'short' })).statusCode).toBe(400);
    expect((await partner.get('/api/admin/users')).statusCode).toBe(403);
    expect((await partner.post('/api/admin/users', { email: 'p2@example.com', name: 'P2', password: PASSWORD })).statusCode).toBe(403);
  });

  it('lists accounts and resets a password, signing the user out', async () => {
    const list: AdminUserDTO[] = (await admin.get('/api/admin/users')).json();
    expect(list.map((u) => u.email)).toEqual(['owner@example.com', 'partner@example.com', 'stranger@example.com']);
    expect(list[0]!.decisions).toBe(1);
    const temp = new Client(t.app);
    await temp.login('stranger@example.com', PASSWORD);
    expect((await admin.post(`/api/admin/users/${strangerId}/password`, { password: 'another long password' })).statusCode).toBe(200);
    expect((await temp.get('/api/auth/session')).statusCode).toBe(401);
    expect((await stranger.login('stranger@example.com', 'another long password')).statusCode).toBe(200);
  });

  it('protects the last administrator', async () => {
    const me = (await admin.get('/api/auth/session')).json().user.id;
    expect((await admin.patch(`/api/admin/users/${me}`, { role: 'member' })).statusCode).toBe(400);
    expect((await admin.del(`/api/admin/users/${me}`)).statusCode).toBe(400);
  });
});

describe('sharing a decision', () => {
  it('is invisible to others until shared', async () => {
    expect((await partner.get(`/api/decisions/${d.id}`)).statusCode).toBe(404);
    const list: Paginated<DecisionSummaryDTO> = (await partner.get('/api/decisions')).json();
    expect(list.total).toBe(0);
    expect((await partner.get('/api/people')).json().map((p: { email: string }) => p.email)).toContain('owner@example.com');
  });

  it('lets an editor open and change it, and lists it as shared', async () => {
    const res = await admin.post(`/api/decisions/${d.id}/people`, { userId: partnerId, role: 'editor' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().members).toMatchObject([{ id: partnerId, name: 'Sara', role: 'editor' }]);

    const shared: DecisionDTO = (await partner.get(`/api/decisions/${d.id}`)).json();
    expect(shared.access).toBe('editor');
    expect(shared.sharedBy).toBe('Fouad');
    expect(shared.people.owner.name).toBe('Fouad');
    const list: Paginated<DecisionSummaryDTO> = (await partner.get('/api/decisions?shared=with_me')).json();
    expect(list.items.map((i) => [i.id, i.access, i.sharedBy])).toEqual([[d.id, 'editor', 'Fouad']]);
    expect((await partner.get('/api/decisions?shared=mine')).json().total).toBe(0);
    expect((await admin.get('/api/decisions')).json().items[0]).toMatchObject({ access: 'owner', sharedBy: null, memberCount: 1 });

    // Edit a scenario, add one, add a milestone, run an experiment.
    const s = shared.scenarios[0]!;
    const put = await partner.put(`/api/scenarios/${s.id}/model`, { ...s, expectedVersion: s.version, variables: { ...s.variables, livingCostMonthly: { value: 1234, source: 'user' } } });
    expect(put.statusCode, put.body).toBe(200);
    const added = await partner.post(`/api/decisions/${d.id}/scenarios`, { fromScenarioId: s.id, name: 'Sara’s variant' });
    expect(added.statusCode, added.body).toBe(201);
    expect((await partner.post(`/api/decisions/${d.id}/milestones`, { title: 'Talk it through', date: '2030-01' })).statusCode).toBe(201);
    const exp = await partner.post(`/api/decisions/${d.id}/experiments`, { scenarioId: s.id, name: 'Cheaper rent', changes: { livingCostMonthly: 1000 } });
    expect(exp.statusCode, exp.body).toBe(201);
    expect(exp.json().createdBy).toBe('Sara');
    // The owner sees the collaborator's work.
    const mine: DecisionDTO = (await admin.get(`/api/decisions/${d.id}`)).json();
    expect(mine.scenarios.some((x) => x.name === 'Sara’s variant')).toBe(true);
    expect(mine.scenarios.find((x) => x.id === s.id)!.variables.livingCostMonthly!.value).toBe(1234);
    expect((await admin.get(`/api/decisions/${d.id}/experiments`)).json()[0].createdBy).toBe('Sara');
    // Runs triggered by the editor are readable by the owner.
    const run = (await partner.get(`/api/scenarios/${s.id}/simulation`)).json();
    expect((await admin.get(`/api/runs/${run.id}`)).statusCode).toBe(200);
  });

  it('keeps sharing and deletion for the owner', async () => {
    expect((await partner.post(`/api/decisions/${d.id}/people`, { userId: strangerId, role: 'viewer' })).statusCode).toBe(403);
    expect((await partner.del(`/api/decisions/${d.id}`)).statusCode).toBe(403);
  });

  it('makes viewers read-only', async () => {
    await admin.post(`/api/decisions/${d.id}/people`, { userId: strangerId, role: 'viewer' });
    const v: DecisionDTO = (await stranger.get(`/api/decisions/${d.id}`)).json();
    expect(v.access).toBe('viewer');
    const s = v.scenarios[0]!;
    expect((await stranger.get(`/api/scenarios/${s.id}/simulation`)).statusCode).toBe(200);
    expect((await stranger.put(`/api/scenarios/${s.id}/model`, { ...s, expectedVersion: s.version })).statusCode).toBe(403);
    expect((await stranger.patch(`/api/decisions/${d.id}`, { title: 'Hijacked' })).statusCode).toBe(403);
    expect((await stranger.post(`/api/decisions/${d.id}/scenarios`, { name: 'Nope' })).statusCode).toBe(403);
    expect((await stranger.post(`/api/decisions/${d.id}/experiments`, { scenarioId: s.id, name: 'x', changes: { livingCostMonthly: 1 } })).statusCode).toBe(403);
    // Viewers can still keep their own journal about it.
    expect((await stranger.post('/api/journal', { decisionId: d.id, type: 'note', title: 'My thoughts', body: '', entryDate: '2027-01-01' })).statusCode).toBe(201);
  });

  it('changes roles, lets members leave, and removes access', async () => {
    expect((await admin.patch(`/api/decisions/${d.id}/people/${strangerId}`, { role: 'editor' })).statusCode).toBe(200);
    expect((await stranger.get(`/api/decisions/${d.id}`)).json().access).toBe('editor');
    expect((await stranger.del(`/api/decisions/${d.id}/people/${strangerId}`)).statusCode).toBe(200);
    expect((await stranger.get(`/api/decisions/${d.id}`)).statusCode).toBe(404);
    expect((await admin.del(`/api/decisions/${d.id}/people/${partnerId}`)).statusCode).toBe(200);
    expect((await partner.get(`/api/decisions/${d.id}`)).statusCode).toBe(404);
    // Work they did stays with the decision.
    expect((await admin.get(`/api/decisions/${d.id}`)).json().scenarios.some((x: { name: string }) => x.name === 'Sara’s variant')).toBe(true);
  });

  it('removes shares when the administrator deletes an account', async () => {
    await admin.post(`/api/decisions/${d.id}/people`, { userId: strangerId, role: 'viewer' });
    expect((await admin.del(`/api/admin/users/${strangerId}`)).statusCode).toBe(200);
    expect((await admin.get(`/api/decisions/${d.id}`)).json().people.members).toHaveLength(0);
    expect((await stranger.login('stranger@example.com', 'another long password')).statusCode).toBe(401);
  });
});
