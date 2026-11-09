import { and, count, eq, gte } from 'drizzle-orm';
import { isVariableKey, simulate, type SimulationResult } from '@whatif/engine';
import {
  draftFromQuestion,
  listMissing,
  decisionCategory,
  type AiAnalysisDTO,
  type AiOutput,
  type AiStatusDTO,
  type AiTask,
  type Baseline,
  type DecisionDraft,
  type ProfileInput,
  type ScenarioDraft,
} from '@whatif/shared';
import { z } from 'zod';
import type { AppContext, AuthUser } from '../../context';
import { aiAnalyses, auditLog, userSettings } from '../../db/schema';
import { keyHint } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { toEngineModel, ensureRun } from '../scenarios';
import type { DecisionDTO } from '@whatif/shared';
import { DEFAULT_MODELS, extractJson, isLocalUrl, AiProviderError, type AiProviderConfig } from './provider';
import { analysisPrompt, buildFacts, parsePrompt } from './prompts';
import { findUnverifiedNumbers } from './grounding';

type SettingsRow = typeof userSettings.$inferSelect;

export interface ResolvedAi {
  cfg: AiProviderConfig | null;
  origin: 'user' | 'instance' | 'none';
  settings: SettingsRow | null;
  enabled: boolean;
  shareProfile: boolean;
  dailyLimit: number;
  maxOutputTokens: number;
}

export async function getSettingsRow(ctx: AppContext, userId: string): Promise<SettingsRow> {
  const rows = await ctx.db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  if (rows[0]) return rows[0];
  const [row] = await ctx.db.insert(userSettings).values({ userId }).onConflictDoNothing().returning();
  if (row) return row;
  const again = await ctx.db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return again[0]!;
}

export async function resolveAi(ctx: AppContext, userId: string): Promise<ResolvedAi> {
  const s = await getSettingsRow(ctx, userId);
  const base = {
    settings: s,
    enabled: s.aiEnabled,
    shareProfile: s.aiShareProfile,
    dailyLimit: Math.min(s.aiDailyLimit, ctx.config.ai.dailyLimit),
    maxOutputTokens: s.aiMaxOutputTokens,
  };
  if (ctx.config.ai.allowUserConfig && s.aiProvider) {
    const provider = s.aiProvider as AiProviderConfig['provider'];
    const model = s.aiModel || DEFAULT_MODELS[provider] || null;
    const apiKey = s.aiApiKeyEnc ? ctx.secrets.decrypt(s.aiApiKeyEnc) : null;
    const needsKey = provider === 'anthropic' || (provider === 'openai' && !s.aiBaseUrl);
    if (model && (!needsKey || apiKey)) {
      return { ...base, origin: 'user', cfg: { provider, baseUrl: s.aiBaseUrl, model, apiKey, timeoutMs: ctx.config.ai.timeoutMs } };
    }
    return { ...base, origin: 'user', cfg: null };
  }
  const inst = ctx.config.ai;
  if (inst.provider) {
    const model = inst.model || DEFAULT_MODELS[inst.provider] || null;
    if (model) return { ...base, origin: 'instance', cfg: { provider: inst.provider, baseUrl: inst.baseUrl, model, apiKey: inst.apiKey, timeoutMs: inst.timeoutMs } };
  }
  return { ...base, origin: 'none', cfg: null };
}

export async function usedToday(ctx: AppContext, userId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const rows = await ctx.db
    .select({ n: count() })
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.action, 'ai.request'), gte(auditLog.createdAt, start)));
  return Number(rows[0]?.n ?? 0);
}

export async function aiStatus(ctx: AppContext, userId: string): Promise<AiStatusDTO> {
  const r = await resolveAi(ctx, userId);
  const s = r.settings!;
  const storedKey = s.aiApiKeyEnc ? ctx.secrets.decrypt(s.aiApiKeyEnc) : null;
  const provider = r.cfg?.provider ?? (s.aiProvider as AiStatusDTO['provider']) ?? ctx.config.ai.provider ?? null;
  const baseUrl = r.cfg?.baseUrl ?? (r.origin === 'user' ? s.aiBaseUrl : ctx.config.ai.baseUrl) ?? null;
  return {
    enabled: r.enabled,
    configured: r.cfg !== null,
    provider,
    model: r.cfg?.model ?? s.aiModel ?? null,
    baseUrl: r.origin === 'instance' ? null : baseUrl,
    keyHint: r.origin === 'user' ? keyHint(storedKey) : r.origin === 'instance' && ctx.config.ai.apiKey ? 'Set by the administrator' : null,
    origin: r.origin,
    shareProfile: r.shareProfile,
    dailyLimit: r.dailyLimit,
    maxOutputTokens: r.maxOutputTokens,
    usedToday: await usedToday(ctx, userId),
    isLocal: provider === 'ollama' || isLocalUrl(baseUrl),
  };
}

export async function requireAi(ctx: AppContext, user: AuthUser, request: Parameters<typeof recordRequest>[1]) {
  const r = await resolveAi(ctx, user.id);
  if (!r.enabled) throw new AppError(409, 'ai_disabled', 'The AI analyst is turned off. Enable it in Settings → AI analyst.');
  if (!r.cfg) throw new AppError(409, 'ai_not_configured', 'No AI provider is configured. Add one in Settings → AI analyst.');
  if ((await usedToday(ctx, user.id)) >= r.dailyLimit) {
    throw new AppError(429, 'ai_quota', `You have reached today’s limit of ${r.dailyLimit} AI requests. The limit resets at midnight UTC.`);
  }
  await recordRequest(ctx, request, user.id, r.cfg.provider, r.cfg.model);
  return r as ResolvedAi & { cfg: AiProviderConfig };
}

async function recordRequest(ctx: AppContext, request: { ip?: string; headers?: Record<string, unknown> } | null, userId: string, provider: string, model: string) {
  await ctx.db.insert(auditLog).values({ userId, action: 'ai.request', ip: request?.ip ?? null, metadata: { provider, model } });
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof AiProviderError) {
    const status = err.code === 'rate_limited' ? 429 : err.code === 'auth' || err.code === 'not_configured' ? 409 : 502;
    return new AppError(status, `ai_${err.code}`, err.message);
  }
  return new AppError(502, 'ai_unavailable', 'The AI provider failed unexpectedly.');
}

const outputSchema = z.object({
  summary: z.string().max(4000),
  points: z
    .array(
      z.object({
        title: z.string().max(300),
        detail: z.string().max(3000),
        kind: z.enum(['risk', 'opportunity', 'cost', 'assumption', 'alternative', 'insight']).catch('insight').optional(),
      }),
    )
    .max(20)
    .default([]),
  suggestions: z
    .array(
      z.object({
        scenarioId: z.string(),
        key: z.string(),
        value: z.number().finite(),
        low: z.number().finite().nullable().optional(),
        high: z.number().finite().nullable().optional(),
        rationale: z.string().max(1000),
      }),
    )
    .max(30)
    .default([]),
});

export interface AnalysisOutcome {
  dto: AiAnalysisDTO;
}

export async function runAnalysis(
  ctx: AppContext,
  user: AuthUser,
  request: { ip?: string; headers?: Record<string, unknown> } | null,
  decision: DecisionDTO,
  task: AiTask,
  scenarioId: string | null,
  profile: ProfileInput | null,
): Promise<AiAnalysisDTO> {
  const ai = await requireAi(ctx, user, request);
  const active = decision.scenarios.filter((s) => s.status === 'active');
  if (active.length === 0) throw new AppError(400, 'no_scenarios', 'Add at least one active scenario before asking the analyst.');

  // Ground the analysis in stored, reproducible runs.
  const results = new Map<string, SimulationResult>();
  const runIds: string[] = [];
  for (const s of active) {
    const run = await ensureRun(ctx.db, user.id, s);
    results.set(s.id, run.result);
    runIds.push(run.id);
  }
  const facts = buildFacts(decision, results, ai.shareProfile ? profile : null, scenarioId);
  const prompt = analysisPrompt(task, facts);
  const provider = ctx.aiFactory(ai.cfg);

  let output: AiOutput | null = null;
  let error: string | null = null;
  let unverified: string[] = [];
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  try {
    const completion = await provider.complete({ system: prompt.system, user: prompt.user, maxTokens: ai.maxOutputTokens });
    inputTokens = completion.inputTokens;
    outputTokens = completion.outputTokens;
    const parsed = outputSchema.safeParse(extractJson(completion.text));
    if (!parsed.success) throw new AiProviderError('bad_response', 'The AI response did not match the expected structure.');
    const validIds = new Set(active.map((s) => s.id));
    const suggestions = parsed.data.suggestions
      .filter((s) => validIds.has(s.scenarioId) && isVariableKey(s.key))
      .map((s) => ({ scenarioId: s.scenarioId, key: s.key as never, value: s.value, low: s.low ?? null, high: s.high ?? null, rationale: s.rationale }));
    output = {
      summary: parsed.data.summary,
      points: parsed.data.points.map((p) => ({ title: p.title, detail: p.detail, kind: p.kind ?? 'insight' })),
      ...(task === 'review' ? { suggestions } : {}),
    };
    const text = [output.summary, ...output.points.map((p) => `${p.title} ${p.detail}`)].join('\n');
    unverified = findUnverifiedNumbers(text, facts);
  } catch (err) {
    const e = toAppError(err);
    error = e.message;
    const [row] = await ctx.db
      .insert(aiAnalyses)
      .values({ userId: user.id, decisionId: decision.id, scenarioId, task, provider: ai.cfg.provider, model: ai.cfg.model, status: 'failed', error, runIds })
      .returning();
    void row;
    throw e;
  }

  const [row] = await ctx.db
    .insert(aiAnalyses)
    .values({
      userId: user.id,
      decisionId: decision.id,
      scenarioId,
      task,
      provider: ai.cfg.provider,
      model: provider.model,
      status: 'completed',
      output,
      unverifiedNumbers: unverified,
      runIds,
      inputTokens,
      outputTokens,
    })
    .returning();
  return analysisDTO(row!);
}

export function analysisDTO(row: typeof aiAnalyses.$inferSelect): AiAnalysisDTO {
  return {
    id: row.id,
    decisionId: row.decisionId,
    scenarioId: row.scenarioId,
    task: row.task,
    provider: row.provider,
    model: row.model,
    status: row.status as 'completed' | 'failed',
    output: (row.output as AiOutput | null) ?? null,
    error: row.error,
    unverifiedNumbers: row.unverifiedNumbers,
    runIds: row.runIds,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    createdAt: row.createdAt.toISOString(),
  };
}

const flowKind = z.enum(['income', 'expense', 'one_time_income', 'one_time_expense', 'time']);
const parseOutputSchema = z.object({
  category: decisionCategory.catch('other'),
  title: z.string().min(3).max(200),
  scenarios: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional().default(''),
        isBaseline: z.boolean().optional().default(false),
        currency: z.string().regex(/^[A-Z]{3}$/).catch('EUR'),
        variables: z
          .record(
            z.string(),
            z.object({
              value: z.number().finite().nullable(),
              low: z.number().finite().nullable().optional(),
              high: z.number().finite().nullable().optional(),
              note: z.string().max(500).optional(),
            }),
          )
          .default({}),
        items: z
          .array(
            z.object({
              kind: flowKind,
              label: z.string().min(1).max(120),
              amount: z.number().finite().min(0).nullable(),
              startMonth: z.number().int().min(0).max(600).catch(0),
              endMonth: z.number().int().min(1).max(600).nullable().optional(),
              note: z.string().max(500).optional(),
            }),
          )
          .max(20)
          .default([]),
        assumptions: z
          .array(z.object({ text: z.string().min(1).max(1000), category: z.enum(['assumption', 'risk', 'opportunity', 'question']).catch('assumption') }))
          .max(12)
          .default([]),
      }),
    )
    .min(1)
    .max(6),
});

/**
 * Natural-language → structured decision using the configured AI. Falls back to the
 * deterministic parser when AI is unavailable or returns something unusable.
 */
export async function aiDraft(
  ctx: AppContext,
  user: AuthUser,
  request: { ip?: string; headers?: Record<string, unknown> } | null,
  question: string,
  opts: { baseline: Baseline | null; startDate: string; baseCurrency: string; horizonYears: number; profile: ProfileInput | null },
): Promise<DecisionDraft> {
  const fallback = draftFromQuestion(question, { baseline: opts.baseline, startDate: opts.startDate, baseCurrency: opts.baseCurrency, horizonYears: opts.horizonYears });
  const ai = await requireAi(ctx, user, request);
  const provider = ctx.aiFactory(ai.cfg);
  const prompt = parsePrompt(question, opts.baseCurrency, ai.shareProfile && opts.profile ? opts.profile : null);
  try {
    const completion = await provider.complete({ system: prompt.system, user: prompt.user, maxTokens: Math.max(ai.maxOutputTokens, 3000) });
    const parsed = parseOutputSchema.safeParse(extractJson(completion.text));
    if (!parsed.success) throw new AiProviderError('bad_response', 'The AI response did not match the expected structure.');
    const p = parsed.data;
    const baselineIdx = Math.max(0, p.scenarios.findIndex((s) => s.isBaseline));
    const scenarios: ScenarioDraft[] = p.scenarios.map((s, i) => {
      const variables: ScenarioDraft['variables'] = {};
      // Start from the deterministic draft's matching scenario so system defaults and baseline values remain labelled correctly.
      const template = fallback.scenarios[Math.min(i, fallback.scenarios.length - 1)]!;
      Object.assign(variables, i === baselineIdx ? fallback.scenarios[0]!.variables : template.variables);
      for (const [key, v] of Object.entries(s.variables)) {
        if (!isVariableKey(key)) continue;
        const existing = variables[key];
        // Never override what the person told us.
        if (existing && existing.source === 'user' && existing.value !== null) continue;
        let low = v.low ?? null;
        let high = v.high ?? null;
        if (v.value !== null && low !== null && low > v.value) low = v.value;
        if (v.value !== null && high !== null && high < v.value) high = v.value;
        variables[key] = { value: v.value, low, high, source: 'ai', note: v.note ?? 'AI estimate — review before relying on it' };
      }
      return {
        name: s.name,
        description: s.description || null,
        isBaseline: i === baselineIdx,
        startDate: opts.startDate,
        horizonYears: opts.horizonYears,
        currency: s.currency,
        exchangeRateToBase: s.currency === opts.baseCurrency ? 1 : null,
        exchangeRateSource: null,
        variables,
        flows: s.items.map((it, j) => ({
          id: `ai_${i}_${j}`,
          kind: it.kind,
          label: it.label,
          amount: it.amount,
          startMonth: it.startMonth,
          endMonth: it.kind.startsWith('one_time') ? null : it.endMonth != null && it.endMonth > it.startMonth ? it.endMonth : null,
          source: 'ai',
          note: it.note ?? 'AI estimate — review before relying on it',
        })),
        scores: {},
        assumptions: s.assumptions.map((a) => ({ text: a.text, category: a.category, source: 'ai' as const, likelihood: null, impact: null })),
      };
    });
    // Validate that the engine can run every scenario.
    for (const s of scenarios) simulate(toEngineModel(s), { quick: true });
    return {
      title: p.title.startsWith('What if') ? p.title : fallback.title,
      question: fallback.question,
      category: p.category,
      baseCurrency: opts.baseCurrency,
      horizonYears: opts.horizonYears,
      scenarios,
      notes: [`Structured by ${provider.name} (${provider.model}). AI estimates are marked — review each one.`],
      missing: listMissing(scenarios),
      origin: 'ai',
    };
  } catch (err) {
    const e = toAppError(err);
    return { ...fallback, notes: [`The AI analyst could not structure this question (${e.message}) — showing the built-in interpretation instead.`, ...fallback.notes] };
  }
}

export async function testConnection(ctx: AppContext, user: AuthUser, request: { ip?: string } | null): Promise<{ ok: true; model: string; latencyMs: number }> {
  const ai = await requireAi(ctx, user, request);
  const provider = ctx.aiFactory(ai.cfg);
  const t0 = Date.now();
  try {
    const c = await provider.complete({ system: 'Reply with the JSON object {"ok": true} and nothing else.', user: 'Connection test.', maxTokens: 50 });
    return { ok: true, model: c.model, latencyMs: Date.now() - t0 };
  } catch (err) {
    throw toAppError(err);
  }
}
