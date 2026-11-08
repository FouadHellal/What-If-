import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

describe('health', () => {
  it('reports database status', async () => {
    const res = await t.app.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
});

describe('registration and login', () => {
  it('makes the first user an administrator and later users members', async () => {
    const a = new Client(t.app);
    const first = await a.register('admin@example.com');
    expect(first.user.role).toBe('admin');
    expect(first.csrfToken).toBeTruthy();
    const b = new Client(t.app);
    const second = await b.register('Member@Example.com');
    expect(second.user.role).toBe('member');
    expect(second.user.email).toBe('member@example.com');
  });

  it('stores passwords hashed and never returns them', async () => {
    const { users } = await import('../src/db/schema');
    const rows = await t.database.db.select().from(users);
    for (const r of rows) {
      expect(r.passwordHash.startsWith('scrypt$')).toBe(true);
      expect(r.passwordHash).not.toContain('correct horse');
    }
    const c = new Client(t.app);
    await c.login('admin@example.com');
    const me = await c.get('/api/auth/session');
    expect(me.body).not.toContain('scrypt$');
    expect(me.body).not.toContain('password');
  });

  it('rejects duplicate emails, weak passwords and invalid emails', async () => {
    const c = new Client(t.app);
    expect((await c.post('/api/auth/register', { email: 'admin@example.com', password: 'another long password', name: 'X' })).statusCode).toBe(409);
    const weak = await c.post('/api/auth/register', { email: 'weak@example.com', password: 'short', name: 'X' });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe('validation_error');
    expect((await c.post('/api/auth/register', { email: 'not-an-email', password: 'long enough password', name: 'X' })).statusCode).toBe(400);
  });

  it('sets a secure-by-default session cookie', async () => {
    const c = new Client(t.app);
    const res = await c.post('/api/auth/login', { email: 'admin@example.com', password: 'correct horse battery' });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  it('gives the same error for unknown users and wrong passwords', async () => {
    const c = new Client(t.app);
    const a = await c.login('nobody@example.com', 'whatever password');
    const b = await c.login('admin@example.com', 'wrong password!!');
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().error.message).toBe(b.json().error.message);
  });

  it('locks an account after repeated failures', async () => {
    const c = new Client(t.app);
    await c.register('locked@example.com');
    const d = new Client(t.app);
    for (let i = 0; i < 10; i++) await d.login('locked@example.com', 'wrong password!!');
    const res = await d.login('locked@example.com');
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('account_locked');
  });

  it('requires a session for protected endpoints', async () => {
    const c = new Client(t.app);
    expect((await c.get('/api/auth/session')).statusCode).toBe(401);
    expect((await c.get('/api/decisions')).statusCode).toBe(401);
    expect((await c.get('/api/journal')).statusCode).toBe(401);
  });

  it('logs out and invalidates the session server-side', async () => {
    const c = new Client(t.app);
    await c.login('admin@example.com');
    const saved = c.cookie;
    expect((await c.post('/api/auth/logout')).statusCode).toBe(200);
    const replay = await t.app.inject({ url: '/api/auth/session', headers: { cookie: saved } });
    expect(replay.statusCode).toBe(401);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without the custom header', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'a@b.c', password: 'x' } });
    expect(res.statusCode).toBe(403);
  });

  it('rejects authenticated writes with a missing or wrong CSRF token', async () => {
    const c = new Client(t.app);
    await c.login('admin@example.com');
    const noToken = await c.request('PUT', '/api/profile', { city: 'Lyon' }, { 'x-csrf-token': '' });
    expect(noToken.statusCode).toBe(403);
    const wrong = await c.request('PUT', '/api/profile', { city: 'Lyon' }, { 'x-csrf-token': 'not-the-token' });
    expect(wrong.statusCode).toBe(403);
    const ok = await c.put('/api/profile', { city: 'Lyon' });
    expect(ok.statusCode).toBe(200);
  });
});

describe('sessions and password changes', () => {
  it('changing the password signs out other sessions', async () => {
    const a = new Client(t.app);
    await a.register('pw@example.com');
    const b = new Client(t.app);
    await b.login('pw@example.com');
    const sessions = await a.get('/api/auth/sessions');
    expect(sessions.json()).toHaveLength(2);
    expect((await a.post('/api/auth/password', { currentPassword: 'wrong one', newPassword: 'a brand new password' })).statusCode).toBe(400);
    expect((await a.post('/api/auth/password', { currentPassword: 'correct horse battery', newPassword: 'a brand new password' })).statusCode).toBe(200);
    expect((await b.get('/api/auth/session')).statusCode).toBe(401);
    expect((await a.get('/api/auth/session')).statusCode).toBe(200);
    const fresh = new Client(t.app);
    expect((await fresh.login('pw@example.com', 'a brand new password')).statusCode).toBe(200);
  });
});

describe('registration control', () => {
  it('lets administrators close registration', async () => {
    const admin = new Client(t.app);
    await admin.login('admin@example.com');
    const member = new Client(t.app);
    await member.login('member@example.com');
    expect((await member.put('/api/admin/settings', { registrationOpen: false })).statusCode).toBe(403);
    expect((await admin.put('/api/admin/settings', { registrationOpen: false })).statusCode).toBe(200);
    const res = await new Client(t.app).post('/api/auth/register', { email: 'late@example.com', password: 'long enough password', name: 'Late' });
    expect(res.statusCode).toBe(403);
    await admin.put('/api/admin/settings', { registrationOpen: true });
  });
});

describe('unknown routes', () => {
  it('returns structured 404s', async () => {
    const res = await t.app.inject({ url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });
});
