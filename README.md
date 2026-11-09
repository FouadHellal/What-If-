# What-If

**Explore the consequences of your decisions before you make them.**

What-If is a self-hosted decision-planning and future-simulation platform. Describe a decision in plain language, such as *“What if I move from Algeria to Germany and work as a network engineer?”*. What-If turns it into alternative scenarios with explicit, editable assumptions, then projects each future with a deterministic engine. You can compare the paths side by side, test how fragile they are, record what you decide, and later check reality against the plan.

It is not a chatbot. Every number comes from a reproducible calculation that you can inspect. An AI analyst is available if you want one, and it is optional.

---

## Features

| Area | What you get |
|---|---|
| **Baseline profile** | Optional onboarding: location, work, income and costs, savings, priorities, risk tolerance and planning horizon. It pre-fills the “stay as I am” scenario of every decision. |
| **Decisions from natural language** | A built-in, offline parser recognises 10 decision types (relocation, job change, business, buy vs rent, investing, learning, city move, sabbatical, career change, family). It also extracts places, roles, amounts and durations. It never invents salaries or prices: unknown values are flagged as *Needs input*. |
| **Multiple scenarios** | Up to 8 alternatives per decision. You can duplicate, rename, archive, delete and change the baseline. Each scenario has its own currency and exchange rate. |
| **Value provenance** | Every assumption is labelled **You**, **AI estimate**, **External data** or **Assumption** (a system default or illustrative value). |
| **Simulation engine** | A month-by-month cash-flow model covering salary, tax, job-search risk, living costs, inflation, one-off and recurring items, property and mortgage, debt, investments and free time. |
| **Uncertainty** | Best, expected and worst cases built from your ranges, plus a seeded Monte Carlo analysis (500 runs) that gives P10–P90 bands and the chance of running out of cash. |
| **Sensitivity** | A tornado chart that ranks the assumptions that move the outcome most. |
| **Comparison** | Charts and a side-by-side table in one base currency. It shows when an alternative overtakes the baseline and how well each path fits your priorities, plus a deterministic “key differences” summary. |
| **Timeline** | Milestones derived from the model (salary starts, cash shortfall, mortgage paid off…) alongside your own milestones, each with an achieved/missed status. |
| **Risks & notes** | Rule-based risk and opportunity flags, plus your own notes on risks, opportunities, assumptions and open questions. |
| **Decision journal** | Records your reasoning, expectations, the decision itself and later reflections. Check-ins compare your actual numbers with the projection pinned when you decided. |
| **Reports** | Frozen report snapshots with 12 sections: a printable web view and a server-generated PDF. |
| **Decision intelligence** | A Summary that separates highest expected outcome, most robust path and best fit with your priorities. It shows break-even dates, the exact thresholds that would change the outcome (salary, rent, tax, exchange rate), failure modes, irreversible commitments, overlooked costs and what to research next. |
| **Robustness** | All scenarios face the same simulated futures (common random numbers). This gives win probability, regret and downside for each path, with year-by-year market and inflation swings, correlated inputs, job-loss risk and surprise expenses. |
| **Decision Lab** | Vary key assumptions with sliders and compare instantly against the original. Saved experiments can be applied in place or saved as new scenarios. |
| **Goals** | The probability of reaching a net-worth target by a date, or of never running out of cash, for each scenario. |
| **Life quality** | 10 subjective dimensions weighted by importance, with the smallest priority change that would alter the best fit. |
| **Evidence** | Cited figures with source, date and coverage. Optional ECB exchange-rate and World Bank inflation lookups. Evidence is never applied silently. |
| **AI analyst (optional)** | Reviews assumptions (with suggestions you can apply), explains results, identifies risks, proposes alternatives and writes an executive summary. Ask questions in plain language and get answers labelled by evidence type, using a decision memory you control. Works with OpenAI-compatible APIs, Anthropic, or a local Ollama model. Analyses are grounded in stored simulation runs, and any figure that does not appear in those results is flagged. |
| **Privacy & security** | Hashed passwords (scrypt), server-side sessions, CSRF protection, rate limiting, account lockout, encrypted API keys, an audit log, full data export and account deletion. |
| **Self-hosting** | One Docker Compose file (app + PostgreSQL), sized for a small VM, with no external services required. |

## Screens

- **Overview**: active decisions, upcoming milestones, recent activity.
- **Decisions**: search, filter by status and type, sort, paginate.
- **Workspace**: Summary · Scenarios · Compare · Lab · Risks & sensitivity · Timeline · Analyst · Decide, with an at-a-glance strip above every tab.
- **Journal**: chronological entries and plan-versus-reality check-ins.
- **Settings**: baseline, preferences (theme, number format), AI analyst, your data, security, instance administration.

## Quick start (Docker, recommended)

Requirements: a Linux machine with Docker Engine 24+ and the Compose plugin. 1 vCPU and 1 GB RAM is enough.

```bash
git clone https://github.com/FouadHellal/What-If-.git /opt/what-if
```

```bash
cd /opt/what-if && cp .env.example .env
```

Generate the two required secrets into `.env`:

```bash
sed -i "s|^APP_SECRET=.*|APP_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env
```

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=\n')|" .env
```

Start it:

```bash
docker compose up -d --build
```

Open `http://127.0.0.1:3000` on the VM, or put a reverse proxy in front of it (see [Deployment](docs/DEPLOYMENT.md)). The **first account you create becomes the administrator**. After onboarding you can explore a fully modelled example decision. Its values are illustrative and labelled as such, and you can remove it with one click.

## Local development

Requirements: Node.js 22+ (24 recommended) and npm 10+. No database server is needed: development uses an embedded PostgreSQL (PGlite) stored in `apps/server/.data/`.

```bash
npm install
```

```bash
npm run dev:server     # API on http://localhost:3000
```

```bash
npm run dev:web        # web app on http://localhost:5173 (proxies /api)
```

To develop against a real PostgreSQL server, set `DATABASE_URL=postgres://user:pass@host:5432/db` before `npm run dev:server`.

### Useful scripts

| Command | Purpose |
|---|---|
| `npm run typecheck` | Type-check all packages |
| `npm test` | Engine, shared, server (API + DB) and web component tests |
| `npm run build` | Production build of web app and server bundle |
| `npm run test:e2e` | Playwright end-to-end tests against the production build (run `npm run build` first) |
| `npm run db:generate` | Create a new SQL migration after changing `apps/server/src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |

To run the server tests against a real PostgreSQL server instead of the embedded one:

```bash
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres npx vitest run --project server
```

## Architecture at a glance

```
packages/engine   Pure TypeScript simulation engine (no I/O, deterministic)
packages/shared   API contracts (zod), decision templates, NL parser, example data
apps/server       Fastify API, PostgreSQL via Drizzle, auth, AI providers, PDF reports
apps/web          React + Vite single-page app, custom SVG charts, design system
e2e               Playwright end-to-end tests
deploy            Backup/restore scripts, reverse-proxy and systemd examples
```

The same engine runs in the browser, for instant recalculation while you edit, and on the server, which stores immutable, versioned runs. Identical inputs always produce identical results; a run can be re-executed and verified from its stored inputs. Details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/SIMULATION.md](docs/SIMULATION.md).

## Configuration

All configuration is through environment variables (see [`.env.example`](.env.example)).

| Variable | Default | Description |
|---|---|---|
| `APP_SECRET` | — (required in production) | ≥ 32 characters. Encrypts stored AI keys. Keep it stable. |
| `DATABASE_URL` | `pglite:./.data/pglite` | `postgres://…` in production. `pglite:` is for development and tests only. |
| `PUBLIC_URL` | — | External URL. `https://…` turns on Secure cookies and HSTS. |
| `COOKIE_SECURE` | `auto` | `auto`, `true` or `false`. |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy. |
| `ALLOW_REGISTRATION` | `true` | Default for new sign-ups after the first (admin) account. Admins can change it in the UI. |
| `SESSION_TTL_DAYS` | `30` | Sliding session lifetime. |
| `AI_PROVIDER` | — | `anthropic`, `openai` or `ollama`: an instance-wide default provider. |
| `AI_BASE_URL` / `AI_MODEL` / `AI_API_KEY` | — | Instance provider settings. |
| `AI_DAILY_LIMIT` | `50` | Maximum AI requests per user per day. |
| `AI_ALLOW_USER_CONFIG` | `true` | Let users bring their own provider and key. |
| `EXTERNAL_DATA` | `on` | User-triggered public data lookups (ECB, World Bank). Set to `off` on air-gapped servers. |
| `LOG_LEVEL` | `info` | Structured JSON logs (pino). |
| `MIGRATE_ON_START` | `true` | Apply database migrations at start-up. |

## Documentation

- [Deployment, updates, backups and troubleshooting](docs/DEPLOYMENT.md)
- [Architecture and data model](docs/ARCHITECTURE.md)
- [Simulation engine: every formula and assumption](docs/SIMULATION.md)
- [Security and privacy](docs/SECURITY.md)
- [Design system](docs/DESIGN.md)
- [Changelog](CHANGELOG.md) · [v2 audit and roadmap](docs/AUDIT-V2.md)

## Important limitations

- What-If does **not** ship tax tables, salary data or exchange rates. You enter them (or accept an AI estimate), and every value shows where it came from.
- Projections are explorations of explicit assumptions, not predictions or financial advice.

## License

Copyright © the repository owner. All rights reserved unless a license file states otherwise.
