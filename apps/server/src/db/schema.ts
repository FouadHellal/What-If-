import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

// ── Identity ────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    csrfToken: text('csrf_token').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [uniqueIndex('sessions_token_hash_key').on(t.tokenHash), index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  country: text('country'),
  city: text('city'),
  ageRange: text('age_range'),
  employmentStatus: text('employment_status'),
  occupation: text('occupation'),
  education: text('education'),
  currency: text('currency').notNull().default('EUR'),
  annualIncome: doublePrecision('annual_income'),
  effectiveTaxRate: doublePrecision('effective_tax_rate'),
  monthlyHousingCost: doublePrecision('monthly_housing_cost'),
  monthlyLivingCost: doublePrecision('monthly_living_cost'),
  savings: doublePrecision('savings'),
  investments: doublePrecision('investments'),
  debt: doublePrecision('debt'),
  monthlyDebtPayment: doublePrecision('monthly_debt_payment'),
  goals: jsonb('goals').$type<string[]>().notNull().default([]),
  priorities: jsonb('priorities').$type<Record<string, number>>().notNull().default({}),
  riskTolerance: text('risk_tolerance'),
  planningHorizonYears: integer('planning_horizon_years'),
  onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
  updatedAt: updatedAt(),
});

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull().default({}),
  aiEnabled: boolean('ai_enabled').notNull().default(false),
  aiProvider: text('ai_provider'),
  aiBaseUrl: text('ai_base_url'),
  aiModel: text('ai_model'),
  /** AES-256-GCM encrypted with a key derived from APP_SECRET. Never returned to clients. */
  aiApiKeyEnc: text('ai_api_key_enc'),
  aiShareProfile: boolean('ai_share_profile').notNull().default(false),
  aiDailyLimit: integer('ai_daily_limit').notNull().default(25),
  aiMaxOutputTokens: integer('ai_max_output_tokens').notNull().default(2000),
  updatedAt: updatedAt(),
});

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
});

// ── Decisions & scenarios ───────────────────────────────────────────────────

export const decisions = pgTable(
  'decisions',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    question: text('question'),
    description: text('description'),
    category: text('category').notNull().default('other'),
    status: text('status').notNull().default('exploring'),
    baseCurrency: text('base_currency').notNull(),
    horizonYears: integer('horizon_years').notNull(),
    priorities: jsonb('priorities').$type<Record<string, number> | null>(),
    isExample: boolean('is_example').notNull().default(false),
    origin: text('origin').notNull().default('manual'),
    chosenScenarioId: uuid('chosen_scenario_id').references((): AnyPgColumn => scenarios.id, { onDelete: 'set null' }),
    decidedRunId: uuid('decided_run_id').references((): AnyPgColumn => simulationRuns.id, { onDelete: 'set null' }),
    rationale: text('rationale'),
    expectations: text('expectations'),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('decisions_user_updated_idx').on(t.userId, t.updatedAt), index('decisions_user_status_idx').on(t.userId, t.status)],
);

export const scenarios = pgTable(
  'scenarios',
  {
    id: id(),
    decisionId: uuid('decision_id').notNull().references(() => decisions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isBaseline: boolean('is_baseline').notNull().default(false),
    status: text('status').notNull().default('active'),
    colorIndex: integer('color_index').notNull().default(0),
    position: integer('position').notNull().default(0),
    /** Incremented on every change to the model; used for optimistic concurrency and run versioning. */
    version: integer('version').notNull().default(1),
    startDate: text('start_date').notNull(),
    horizonYears: integer('horizon_years').notNull(),
    currency: text('currency').notNull(),
    exchangeRateToBase: doublePrecision('exchange_rate_to_base'),
    exchangeRateSource: text('exchange_rate_source'),
    scores: jsonb('scores').$type<Record<string, number>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('scenarios_decision_idx').on(t.decisionId, t.position), index('scenarios_user_updated_idx').on(t.userId, t.updatedAt)],
);

export const scenarioVariables = pgTable(
  'scenario_variables',
  {
    id: id(),
    scenarioId: uuid('scenario_id').notNull().references(() => scenarios.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: doublePrecision('value'),
    low: doublePrecision('low'),
    high: doublePrecision('high'),
    source: text('source').notNull().default('user'),
    note: text('note'),
  },
  (t) => [uniqueIndex('scenario_variables_key').on(t.scenarioId, t.key)],
);

export const scenarioFlows = pgTable(
  'scenario_flows',
  {
    id: id(),
    scenarioId: uuid('scenario_id').notNull().references(() => scenarios.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    position: integer('position').notNull().default(0),
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    amount: doublePrecision('amount'),
    low: doublePrecision('low'),
    high: doublePrecision('high'),
    amountMode: text('amount_mode').notNull().default('fixed'),
    startMonth: integer('start_month').notNull().default(0),
    endMonth: integer('end_month'),
    annualGrowth: doublePrecision('annual_growth'),
    source: text('source').notNull().default('user'),
    note: text('note'),
  },
  (t) => [uniqueIndex('scenario_flows_client_key').on(t.scenarioId, t.clientId)],
);

export const assumptions = pgTable(
  'assumptions',
  {
    id: id(),
    decisionId: uuid('decision_id').notNull().references(() => decisions.id, { onDelete: 'cascade' }),
    scenarioId: uuid('scenario_id').references(() => scenarios.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    category: text('category').notNull().default('assumption'),
    source: text('source').notNull().default('user'),
    likelihood: text('likelihood'),
    impact: text('impact'),
    createdAt: createdAt(),
  },
  (t) => [index('assumptions_decision_idx').on(t.decisionId)],
);

// ── Simulation (immutable, versioned) ───────────────────────────────────────

export const simulationRuns = pgTable(
  'simulation_runs',
  {
    id: id(),
    scenarioId: uuid('scenario_id').notNull().references((): AnyPgColumn => scenarios.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    scenarioVersion: integer('scenario_version').notNull(),
    engineVersion: text('engine_version').notNull(),
    inputHash: text('input_hash').notNull(),
    seed: integer('seed').notNull(),
    runs: integer('runs').notNull(),
    /** Complete engine input snapshot — enough to reproduce the result exactly. */
    inputs: jsonb('inputs').notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('simulation_runs_scenario_idx').on(t.scenarioId, t.createdAt), index('simulation_runs_hash_idx').on(t.scenarioId, t.inputHash)],
);

export const simulationResults = pgTable('simulation_results', {
  runId: uuid('run_id').primaryKey().references(() => simulationRuns.id, { onDelete: 'cascade' }),
  summary: jsonb('summary').notNull(),
  result: jsonb('result').notNull(),
});

// ── Planning artefacts ──────────────────────────────────────────────────────

export const milestones = pgTable(
  'milestones',
  {
    id: id(),
    decisionId: uuid('decision_id').notNull().references(() => decisions.id, { onDelete: 'cascade' }),
    scenarioId: uuid('scenario_id').references(() => scenarios.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    date: text('date').notNull(),
    status: text('status').notNull().default('planned'),
    achievedOn: text('achieved_on'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('milestones_decision_idx').on(t.decisionId, t.date)],
);

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id').references(() => decisions.id, { onDelete: 'set null' }),
    scenarioId: uuid('scenario_id').references(() => scenarios.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    entryDate: text('entry_date').notNull(),
    actuals: jsonb('actuals').$type<Record<string, number | null> | null>(),
    projected: jsonb('projected').$type<Record<string, number | null> | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('journal_user_date_idx').on(t.userId, t.entryDate), index('journal_decision_idx').on(t.decisionId)],
);

export const aiAnalyses = pgTable(
  'ai_analyses',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id').notNull().references(() => decisions.id, { onDelete: 'cascade' }),
    scenarioId: uuid('scenario_id').references(() => scenarios.id, { onDelete: 'set null' }),
    task: text('task').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: text('status').notNull(),
    output: jsonb('output'),
    error: text('error'),
    unverifiedNumbers: jsonb('unverified_numbers').$type<string[]>().notNull().default([]),
    runIds: jsonb('run_ids').$type<string[]>().notNull().default([]),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_analyses_decision_idx').on(t.decisionId, t.createdAt), index('ai_analyses_user_created_idx').on(t.userId, t.createdAt)],
);

export const reports = pgTable(
  'reports',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    decisionId: uuid('decision_id').notNull().references(() => decisions.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('reports_decision_idx').on(t.decisionId, t.createdAt)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_user_created_idx').on(t.userId, t.createdAt)],
);
