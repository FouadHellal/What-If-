// Dev utility: signs in to a running instance and calls a few API endpoints.
// Usage: SHOT_EMAIL=… SHOT_PASSWORD=… node scripts/api-check.mjs <decisionId>
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const id = process.argv[2];
const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'what-if' }, body: JSON.stringify({ email: process.env.SHOT_EMAIL, password: process.env.SHOT_PASSWORD }) });
const cookie = login.headers.get('set-cookie')?.split(';')[0];
const { csrfToken } = await login.json();
const h = { 'content-type': 'application/json', 'x-requested-with': 'what-if', 'x-csrf-token': csrfToken, cookie };
const call = async (body) => fetch(`${base}/api/decisions/${id}/research`, { method: 'POST', headers: h, body: JSON.stringify(body) }).then((r) => r.json());
const a = await call({ kind: 'exchange_rate', from: 'CAD', to: 'EUR' });
const b = await call({ kind: 'exchange_rate', from: 'DZD', to: 'EUR' });
const c = await call({ kind: 'inflation', country: 'Germany' });
console.log(JSON.stringify({ cad: [a.value, a.coverage, a.error?.message], dzd: b.error?.message ?? b.value, de: [c.label, c.value, c.error?.message] }, null, 1));
