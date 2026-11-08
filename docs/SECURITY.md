# Security and privacy

What-If stores sensitive personal and financial information, so privacy is part of the architecture, not a setting.

## Authentication and sessions

- Passwords are hashed with **scrypt** (N = 32768, r = 8, p = 1, 16-byte salt). Hashes are upgraded on login if the cost increases. Passwords must be 10–200 characters.
- Sessions are server-side. The browser holds a random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie, which is `Secure` over HTTPS. Only the token's SHA-256 hash is stored. Sessions expire after 30 days of inactivity (sliding) and are purged hourly.
- Changing the password signs out every other session. Users can list and revoke sessions.
- After 10 failed logins an account is locked for 15 minutes. Unknown emails and wrong passwords return the same error after comparable work, so the response does not reveal whether an account exists.
- The first account becomes the administrator. Registration can then be closed.

## Request protection

- **CSRF**: every state-changing request must carry `X-Requested-With: what-if`, which cross-site forms cannot set and which forces a CORS preflight the API never approves. Authenticated requests must also send the per-session CSRF token. Cookies are `SameSite=Lax`.
- **Rate limiting**: a global per-IP limit, stricter limits on authentication, and dedicated limits on AI, drafting, reports and account deletion.
- **Validation**: every body, query and path parameter is validated with zod. Amounts are bounded (±10¹²), horizons are 1–50 years, and currencies must be ISO codes. The simulation engine also defends itself against non-finite input.
- **Headers** (helmet): a strict Content-Security-Policy (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`), `nosniff`, a same-origin referrer policy, and HSTS over HTTPS. API responses are `Cache-Control: no-store`.
- **Authorization**: every query is scoped to the signed-in user. Requests for another user's resources return 404, which avoids revealing that they exist. Integration tests cover cross-user access for each resource type.
- **SQL**: all queries are parameterised (Drizzle). Search terms escape LIKE wildcards.
- **Body size** is limited to 1 MB.

## AI providers

- AI is **off** by default and must be enabled by each user.
- API keys are stored **encrypted** (AES-256-GCM, key derived from `APP_SECRET` with HKDF). They are never returned to the browser (only `••••abcd` is shown), never logged, and never included in exports.
- Requests go from the server, never from the browser. Each request discloses exactly what is sent: the decision, its scenarios, assumptions and calculated results. Profile context (location, occupation, goals, priorities, risk tolerance) is added **only with explicit consent**. Financial baseline figures are never sent.
- Only administrators can point a provider at a custom URL, which prevents users from probing the internal network.
- Daily request limits and output-token caps apply per user. Every AI request is recorded in the audit log, with provider and model but no content.
- What-If does not train on user data. Whether a provider does depends on its terms. A local Ollama model keeps all data on your network.

## Audit log

Security- and privacy-relevant events are recorded with time and IP:

- sign-ins, failures and lockouts;
- password changes and session revocations;
- exports and deletions;
- AI settings changes and requests;
- creating and deleting decisions;
- reports and admin changes.

Personal values and amounts are never logged. Users can see their own log in **Settings → Security**.

## Data ownership

- **Export**: a complete JSON export of everything a user stored, including simulation inputs.
- **Deletion**: deleting an account requires the password plus typing `DELETE`. It removes the user and, by cascade, every profile, decision, scenario, run, analysis, report, journal entry, setting, session and audit entry.
- **Example data** is stored with `is_example = true`, labelled in the UI, and removable in one click. It is never mixed with real data.

## Operational recommendations

- Keep the app bound to `127.0.0.1` and publish it through a TLS reverse proxy. Set `PUBLIC_URL=https://…` and `TRUST_PROXY=true`.
- Keep `.env` at mode `600`. Back up `APP_SECRET` together with the database backups.
- Close registration once accounts exist.
- Update regularly (`git pull && docker compose up -d --build`).

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a public issue.
