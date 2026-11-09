import { MAX_HORIZON_YEARS, MAX_MONEY, MIN_HORIZON_YEARS, VARIABLE_KEYS, type VariableKey } from '@whatif/engine';
import { z } from 'zod';

// ── Primitives ──────────────────────────────────────────────────────────────

export const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use the YYYY-MM format');
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format');
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code');
export const uuid = z.uuid();

const boundedNumber = z.number().finite().min(-MAX_MONEY).max(MAX_MONEY);

export const valueSource = z.enum(['user', 'ai', 'external', 'system']);
export type ValueSourceT = z.infer<typeof valueSource>;

export const DECISION_CATEGORIES = [
  'relocation',
  'job_change',
  'business',
  'housing',
  'investing',
  'education',
  'city_move',
  'sabbatical',
  'career_change',
  'family',
  'job_offer',
  'debt_payoff',
  'major_purchase',
  'working_hours',
  'study_path',
  'certification',
  'other',
] as const;
export const decisionCategory = z.enum(DECISION_CATEGORIES);
export type DecisionCategory = z.infer<typeof decisionCategory>;

export const DECISION_STATUSES = ['exploring', 'deciding', 'decided', 'archived'] as const;
export const decisionStatus = z.enum(DECISION_STATUSES);
export type DecisionStatus = z.infer<typeof decisionStatus>;

// ── Auth ────────────────────────────────────────────────────────────────────

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'Use at most 200 characters');

export const registerSchema = z.object({
  email: z.email('Enter a valid email address').max(254).transform((s) => s.trim().toLowerCase()),
  password: passwordSchema,
  name: z.string().trim().min(1, 'Tell us what to call you').max(80),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(200),
  confirm: z.literal('DELETE'),
});

// ── Profile / baseline ──────────────────────────────────────────────────────

/** Life-quality dimension keys (v2) plus v1 names that are still accepted and mapped. */
export const LIFE_KEYS = ['career', 'freedom', 'time', 'family', 'social', 'lifestyle', 'health', 'learning', 'stability', 'growth', 'financial', 'relationships'] as const;
const lifeKey = z.enum(LIFE_KEYS);
export const priorityWeightsSchema = z.partialRecord(lifeKey, z.number().int().min(0).max(5));

const optMoney = z.number().finite().min(0).max(MAX_MONEY).nullable().optional();
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

export const profileSchema = z.object({
  displayName: optText(80),
  country: optText(80),
  city: optText(80),
  ageRange: z.enum(['under_25', '25_34', '35_44', '45_54', '55_64', '65_plus']).nullable().optional(),
  employmentStatus: z
    .enum(['employed', 'self_employed', 'unemployed', 'student', 'retired', 'career_break', 'other'])
    .nullable()
    .optional(),
  occupation: optText(120),
  education: optText(120),
  currency: currencyCode.optional(),
  annualIncome: optMoney,
  effectiveTaxRate: z.number().finite().min(0).max(100).nullable().optional(),
  monthlyHousingCost: optMoney,
  monthlyLivingCost: optMoney,
  savings: z.number().finite().min(-MAX_MONEY).max(MAX_MONEY).nullable().optional(),
  investments: optMoney,
  debt: optMoney,
  monthlyDebtPayment: optMoney,
  goals: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
  priorities: priorityWeightsSchema.optional(),
  riskTolerance: z.enum(['low', 'medium', 'high']).nullable().optional(),
  planningHorizonYears: z.number().int().min(MIN_HORIZON_YEARS).max(MAX_HORIZON_YEARS).nullable().optional(),
  onboardingCompleted: z.boolean().optional(),
});
export type ProfileInput = z.infer<typeof profileSchema>;

// ── Scenario model ──────────────────────────────────────────────────────────

export const variableInputSchema = z.object({
  value: boundedNumber.nullable(),
  low: boundedNumber.nullable().optional(),
  high: boundedNumber.nullable().optional(),
  source: valueSource,
  note: z.string().max(500).nullable().optional(),
});

const variableKeyEnum = z.enum(VARIABLE_KEYS as [VariableKey, ...VariableKey[]]);

export const variablesSchema = z.partialRecord(variableKeyEnum, variableInputSchema);

export const flowSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.enum(['income', 'expense', 'one_time_income', 'one_time_expense', 'time', 'salary_change', 'income_gap', 'loan']),
    label: z.string().trim().min(1, 'Give this item a name').max(120),
    amount: z.number().finite().min(0, 'Amounts cannot be negative — choose income or expense instead').max(MAX_MONEY).nullable(),
    low: z.number().finite().min(0).max(MAX_MONEY).nullable().optional(),
    high: z.number().finite().min(0).max(MAX_MONEY).nullable().optional(),
    amountMode: z.enum(['fixed', 'percent_of_income']).optional(),
    startMonth: z.number().int().min(0).max(MAX_HORIZON_YEARS * 12),
    endMonth: z.number().int().min(1).max(MAX_HORIZON_YEARS * 12).nullable().optional(),
    annualGrowth: z.number().finite().min(-50).max(100).nullable().optional(),
    rate: z.number().finite().min(0).max(100).nullable().optional(),
    termMonths: z.number().int().min(1).max(600).nullable().optional(),
    source: valueSource,
    note: z.string().max(500).nullable().optional(),
  })
  .refine((f) => f.endMonth === null || f.endMonth === undefined || f.endMonth > f.startMonth, {
    message: 'End must be after start',
    path: ['endMonth'],
  });

export const scoresSchema = z.partialRecord(lifeKey, z.number().int().min(1).max(5));

export const taxScheduleSchema = z.object({
  brackets: z
    .array(z.object({ upTo: z.number().finite().min(0).max(MAX_MONEY).nullable(), rate: z.number().finite().min(0).max(100) }))
    .min(1)
    .max(20),
  allowance: z.number().finite().min(0).max(MAX_MONEY).optional(),
  flatRate: z.number().finite().min(0).max(100).optional(),
});

export const scenarioModelSchema = z.object({
  startDate: monthString,
  horizonYears: z.number().int().min(MIN_HORIZON_YEARS).max(MAX_HORIZON_YEARS),
  currency: currencyCode,
  exchangeRateToBase: z.number().finite().positive().max(1e9).nullable(),
  exchangeRateSource: valueSource.nullable().optional(),
  variables: variablesSchema,
  flows: z.array(flowSchema).max(60),
  scores: scoresSchema.optional(),
  tax: taxScheduleSchema.nullable().optional(),
});
export type ScenarioModelInput = z.infer<typeof scenarioModelSchema>;

// ── Decision settings ───────────────────────────────────────────────────────

export const goalSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(['net_worth_at', 'cash_floor']),
  /** In the decision's base currency. */
  target: z.number().finite().min(-MAX_MONEY).max(MAX_MONEY),
  /** YYYY-MM for net_worth_at; null means the end of the horizon. */
  date: monthString.nullable().optional(),
});
export type GoalInput = z.infer<typeof goalSchema>;

export const decisionMemorySchema = z.object({
  objectives: z.string().trim().max(2000).optional(),
  riskStance: z.enum(['cautious', 'balanced', 'adventurous']).nullable().optional(),
  constraints: z.string().trim().max(2000).optional(),
  /** Short facts the person confirmed during analyst conversations. */
  facts: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
});
export type DecisionMemory = z.infer<typeof decisionMemorySchema>;

export const decisionSettingsSchema = z.object({
  runs: z.number().int().min(100).max(5000).optional(),
  correlations: z.enum(['default', 'none']).optional(),
  goals: z.array(goalSchema).max(6).optional(),
  memory: decisionMemorySchema.optional(),
});
export type DecisionSettings = z.infer<typeof decisionSettingsSchema>;

// ── Experiments (Decision Lab) ──────────────────────────────────────────────

export const experimentInputSchema = z.object({
  scenarioId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  note: z.string().trim().max(2000).nullable().optional(),
  /** Inputs changed relative to the scenario: variable key or flow:<id> → new value. */
  changes: z.record(z.string().max(80), z.number().finite().min(-MAX_MONEY).max(MAX_MONEY)).refine((c) => Object.keys(c).length <= 40, 'Too many changes'),
});

// ── Evidence (external data with citations) ─────────────────────────────────

export const evidenceInputSchema = z.object({
  scenarioId: z.uuid().nullable().optional(),
  label: z.string().trim().min(1).max(200),
  value: z.number().finite().min(-MAX_MONEY).max(MAX_MONEY).nullable(),
  unit: z.string().trim().max(40).nullable().optional(),
  sourceName: z.string().trim().min(1).max(200),
  sourceUrl: z.url({ protocol: /^https?$/ }).max(1000).nullable().optional(),
  retrievedOn: dateString,
  coverage: z.string().trim().max(200).nullable().optional(),
  uncertainty: z.string().trim().max(300).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

export const researchRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exchange_rate'), from: currencyCode, to: currencyCode }),
  z.object({ kind: z.literal('inflation'), country: z.string().trim().min(2).max(80) }),
]);

export const aiChatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  scenarioId: z.uuid().nullable().optional(),
});

export const assumptionCategory = z.enum(['assumption', 'risk', 'opportunity', 'question']);

export const assumptionInputSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  category: assumptionCategory.default('assumption'),
  source: valueSource.default('user'),
  likelihood: z.enum(['low', 'medium', 'high']).nullable().optional(),
  impact: z.enum(['low', 'medium', 'high']).nullable().optional(),
});

export const scenarioDraftSchema = scenarioModelSchema.extend({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  isBaseline: z.boolean().default(false),
  assumptions: z.array(assumptionInputSchema).max(40).optional(),
});
export type ScenarioDraft = z.infer<typeof scenarioDraftSchema>;

export const updateScenarioModelSchema = scenarioModelSchema.extend({
  expectedVersion: z.number().int().min(1),
});

export const updateScenarioMetaSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
  isBaseline: z.boolean().optional(),
  colorIndex: z.number().int().min(0).max(7).optional(),
});

// ── Decisions ───────────────────────────────────────────────────────────────

export const createDecisionSchema = z.object({
  title: z.string().trim().min(3, 'Describe the decision in a few words').max(200),
  question: z.string().trim().max(1000).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  category: decisionCategory.default('other'),
  baseCurrency: currencyCode,
  horizonYears: z.number().int().min(MIN_HORIZON_YEARS).max(MAX_HORIZON_YEARS),
  scenarios: z.array(scenarioDraftSchema).min(1).max(8),
  origin: z.enum(['manual', 'template', 'parser', 'ai']).default('manual'),
});
export type CreateDecisionInput = z.infer<typeof createDecisionSchema>;

export const updateDecisionSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  question: z.string().trim().max(1000).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  category: decisionCategory.optional(),
  status: decisionStatus.optional(),
  baseCurrency: currencyCode.optional(),
  horizonYears: z.number().int().min(MIN_HORIZON_YEARS).max(MAX_HORIZON_YEARS).optional(),
  priorities: priorityWeightsSchema.nullable().optional(),
  settings: decisionSettingsSchema.optional(),
});

export const recordDecisionSchema = z.object({
  chosenScenarioId: uuid.nullable(),
  rationale: z.string().trim().max(5000).nullable().optional(),
  expectations: z.string().trim().max(5000).nullable().optional(),
});

export const listDecisionsQuery = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.union([decisionStatus, z.literal('active'), z.literal('all')]).default('active'),
  category: decisionCategory.optional(),
  sort: z.enum(['updated', 'created', 'title']).default('updated'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ── Milestones ──────────────────────────────────────────────────────────────

export const milestoneSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  date: monthString,
  scenarioId: uuid.nullable().optional(),
  status: z.enum(['planned', 'achieved', 'missed', 'cancelled']).default('planned'),
  achievedOn: dateString.nullable().optional(),
});
export const updateMilestoneSchema = milestoneSchema.partial();

// ── Journal ─────────────────────────────────────────────────────────────────

export const JOURNAL_TYPES = ['note', 'reasoning', 'expectation', 'decision', 'outcome', 'checkin', 'reflection'] as const;
export const journalEntrySchema = z.object({
  decisionId: uuid.nullable().optional(),
  scenarioId: uuid.nullable().optional(),
  type: z.enum(JOURNAL_TYPES),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(20_000).default(''),
  entryDate: dateString,
  /** Actual figures recorded during a check-in, in the decision's base currency. */
  actuals: z
    .object({
      netWorth: boundedNumber.nullable().optional(),
      cash: boundedNumber.nullable().optional(),
      monthlyIncome: boundedNumber.nullable().optional(),
      monthlyExpenses: boundedNumber.nullable().optional(),
      satisfaction: z.number().int().min(1).max(5).nullable().optional(),
    })
    .nullable()
    .optional(),
});
export const updateJournalEntrySchema = journalEntrySchema.partial();

// ── AI ──────────────────────────────────────────────────────────────────────

export const AI_PROVIDERS = ['openai', 'anthropic', 'ollama'] as const;
export const aiProvider = z.enum(AI_PROVIDERS);

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: aiProvider.nullable(),
  baseUrl: z.url({ protocol: /^https?$/ }).max(500).nullable().optional(),
  model: z.string().trim().max(200).nullable().optional(),
  /** Write-only. `undefined` keeps the stored key, `null` removes it. */
  apiKey: z.string().trim().max(500).nullable().optional(),
  shareProfile: z.boolean(),
  dailyLimit: z.number().int().min(1).max(1000),
  maxOutputTokens: z.number().int().min(256).max(16_000),
});
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

export const AI_TASKS = ['review', 'explain', 'risks', 'alternatives', 'summary'] as const;
export const aiTask = z.enum(AI_TASKS);
export type AiTask = z.infer<typeof aiTask>;

export const aiAnalyzeSchema = z.object({
  task: aiTask,
  scenarioId: uuid.nullable().optional(),
});

export const parseQuestionSchema = z.object({
  question: z.string().trim().min(5, 'Describe the decision in a sentence').max(1000),
  useAi: z.boolean().default(false),
});

// ── Preferences ─────────────────────────────────────────────────────────────

export const preferencesSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).optional(),
  currency: currencyCode.optional(),
  numberLocale: z.enum(['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'nl-NL']).optional(),
  showRealValues: z.boolean().optional(),
});
export type Preferences = z.infer<typeof preferencesSchema>;

// ── Reports ─────────────────────────────────────────────────────────────────

export const createReportSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  includeAiSummary: z.boolean().default(true),
});
