# Architecture

## Decisions and why

| Decision | Reason |
|---|---|
| **Monorepo with npm workspaces** | The engine, the API contracts, the server and the web app share code without publishing packages. npm is the only tool required. |
| **Pure TypeScript engine shared by browser and server** | Recalculation is instant while editing, with no round trips. The server runs the same code to store authoritative runs, so there is a single source of truth for every formula. |
| **Fastify + Drizzle + PostgreSQL** | A fast, small-footprint HTTP server; typed SQL with plain migration files; a robust relational database. One process, no microservices. |
| **PGlite for development and tests** | Real PostgreSQL compiled to WebAssembly. Contributors need no database server, and tests exercise the same SQL and migrations as production. CI also runs the server suite on PostgreSQL 17. |
| **React + Vite SPA, served by the API process** | One container to deploy. The SPA is static, cached, and served with a strict CSP. |
| **Custom SVG charts** | Small bundle, a validated colour-blind-safe palette, crosshair tooltips and table fallbacks, and full control over the editorial look. |
| **Hand-written CSS with design tokens** | Restrained, consistent styling with light and dark themes and no utility-class soup (see `docs/DESIGN.md`). |
| **AI behind a provider interface using plain `fetch`** | Easy to audit; no SDK lock-in; OpenAI-compatible, Anthropic and Ollama in about 200 lines. AI is strictly optional. |

## Request flow

```
Browser ── /api/* (cookie session + CSRF header) ──▶ Fastify
   │                                                  ├─ auth hook (session lookup, sliding expiry)
   │  same @whatif/engine                             ├─ CSRF/custom-header check on writes
   │  (live preview)                                  ├─ rate limiting, helmet (CSP, HSTS)
   │                                                  ├─ zod validation → services → Drizzle → PostgreSQL
   └── static SPA (index.html no-cache, assets immutable)  └─ AI provider (optional, server-side only)
```

## Editing and versioning

1. The workspace keeps a local draft of each edited scenario. Every keystroke re-runs the engine in the browser (results are cached by input hash).
2. After 700 ms of inactivity the draft is saved with `PUT /api/scenarios/:id/model` and `expectedVersion`.
3. The server validates the input (zod, then a quick engine pass), increments `scenarios.version` with a conditional `UPDATE … WHERE version = expected`, replaces the variables and flows in a transaction, and stores a run.
4. A version mismatch returns **409** with the current scenario. The client shows the latest version and explains that the edit must be re-applied.
5. Runs are immutable rows in `simulation_runs` (with the full input snapshot) and `simulation_results`. Identical inputs reuse the existing run. Earlier runs stay available and verifiable.

Recording a decision pins the chosen scenario's current run (`decisions.decided_run_id`). Journal check-ins compare actual figures with that pinned projection, so later edits never rewrite history.

## Data model

```
users ─┬─ sessions
       ├─ profiles (baseline)            1:1
       ├─ user_settings (prefs, AI)      1:1, API key AES-256-GCM encrypted
       ├─ decisions ─┬─ scenarios ─┬─ scenario_variables   (key, value, low, high, source, note)
       │             │             ├─ scenario_flows       (one-off/recurring items, time)
       │             │             └─ simulation_runs ── simulation_results
       │             ├─ assumptions (qualitative: assumption/risk/opportunity/question)
       │             ├─ milestones
       │             ├─ ai_analyses (task, provider, model, output, unverified numbers, run ids)
       │             └─ reports (frozen snapshot JSON)
       ├─ journal_entries (decision/scenario links survive deletion as NULL)
       └─ audit_log
app_settings (instance-wide key/value, e.g. registration_open)
```

- Primary keys are UUIDs (`gen_random_uuid()`), and all timestamps are `timestamptz`.
- Foreign keys cascade from users and decisions. Journal links are set to NULL so the historical record survives.
- Indexes back every list query: decisions by user and updated time, scenarios by decision, runs by scenario and hash, journal by user and date.
- `decisions.chosen_scenario_id` and `decisions.decided_run_id` use `ON DELETE SET NULL`.
- Migrations live in `apps/server/drizzle/` and are applied automatically at start-up, or with `node dist/migrate.js`.

## API overview

| Area | Endpoints |
|---|---|
| Health | `GET /api/health` |
| Auth | `GET /auth/status`, `GET /auth/session`, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/password`, `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `POST /auth/sessions/revoke-others` |
| Account | `GET/PUT /profile`, `GET/PUT /preferences`, `GET /account/export`, `DELETE /account`, `GET /account/audit`, `POST /account/example`, `DELETE /account/examples`, `GET/PUT /admin/settings` |
| Decisions | `GET /overview`, `GET/POST /decisions`, `POST /decisions/draft`, `GET /decisions/templates/:category`, `GET/PATCH/DELETE /decisions/:id`, `POST /decisions/:id/decide` |
| Scenarios | `POST /decisions/:id/scenarios`, `PATCH/DELETE /scenarios/:id`, `PUT /scenarios/:id/model`, `GET /scenarios/:id/simulation`, `GET /scenarios/:id/runs`, `GET /runs/:id`, `POST /runs/:id/verify` |
| Planning | `POST /decisions/:id/assumptions`, `PATCH/DELETE /assumptions/:id`, `POST /decisions/:id/milestones`, `PATCH/DELETE /milestones/:id` |
| Journal | `GET/POST /journal`, `PATCH/DELETE /journal/:id` |
| AI | `GET/PUT /ai/settings`, `POST /ai/test`, `GET/POST /decisions/:id/ai`, `DELETE /ai/analyses/:id` |
| Reports | `GET/POST /decisions/:id/reports`, `GET/DELETE /reports/:id`, `GET /reports/:id/pdf` |

All endpoints are prefixed with `/api`. Errors share one shape: `{ "error": { "code", "message", "details?" } }`.

## AI integration

- `services/ai/provider.ts` defines the provider interface and three implementations.
- Configuration comes from the user's settings (if allowed) or the instance environment. The analyst must be **enabled explicitly** by each user before anything is sent.
- `services/ai/prompts.ts` builds a compact *facts* JSON from the decision, its scenarios and **stored runs**. The person's profile is included only with consent, and financial baseline figures are never included.
- Output must be JSON matching a zod schema. Suggestions are restricted to known variable keys and the decision's own scenarios.
- `services/ai/grounding.ts` extracts every number from the AI text and flags any that cannot be matched (within rounding) to the facts.
- Natural-language drafting can use AI. It falls back to the deterministic parser on any failure, never overrides user-provided values, and labels AI values as `ai`.
- Usage is limited per user per day, recorded in the audit log, and capped in output tokens.

## Frontend structure

```
src/api         fetch client (CSRF header, error type), React Query hooks
src/lib         session context, formatting, client-side simulation cache
src/components  ui/ (buttons, fields, dialogs, menus, toasts…), charts/ (LineChart, Tornado)
src/layout      app shell (sidebar, mobile drawer)
src/pages       Overview, Decisions, NewDecision, Journal, Report, Onboarding, settings/, workspace/
src/styles      tokens.css, base.css, components.css, layout.css, workspace.css
```

Routes are code-split. The largest view, the workspace, is about 32 kB gzipped.
