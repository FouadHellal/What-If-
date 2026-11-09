/**
 * Conversational analyst. Answers are grounded in the decision's stored
 * simulation runs, the Decision Intelligence analysis, cited evidence and the
 * decision memory. Every statement is tagged with its evidence type.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import type { SimulationResult } from '@whatif/engine';
import { buildIntelligence, parseSettings, type AiMessageDTO, type DecisionDTO, type EvidenceBasis, type ProfileInput } from '@whatif/shared';
import { z } from 'zod';
import type { AppContext, AuthUser } from '../../context';
import { aiMessages, evidence } from '../../db/schema';
import { AiProviderError, extractJson } from './provider';
import { buildFacts } from './prompts';
import { findUnverifiedNumbers } from './grounding';
import { requireAi, toAppError } from './service';
import { ensureRun, toEngineModel } from '../scenarios';

const BASES = ['app_data', 'user_assumption', 'external', 'model', 'interpretation'] as const;

const answerSchema = z.object({
  answer: z
    .array(z.object({ text: z.string().min(1).max(3000), basis: z.enum(BASES).catch('interpretation') }))
    .min(1)
    .max(12),
  followUps: z.array(z.string().max(200)).max(3).catch([]).default([]),
  memoryFacts: z.array(z.string().max(300)).max(3).catch([]).default([]),
});

export function messageDTO(r: typeof aiMessages.$inferSelect): AiMessageDTO {
  const out = (r.output as { answer?: { text: string; basis: EvidenceBasis }[]; followUps?: string[]; memoryFacts?: string[] } | null) ?? null;
  return {
    id: r.id,
    role: r.role,
    content: r.content,
    parts: out?.answer ?? null,
    followUps: out?.followUps ?? [],
    suggestedFacts: out?.memoryFacts ?? [],
    unverifiedNumbers: r.unverifiedNumbers,
    provider: r.provider,
    model: r.model,
    createdAt: r.createdAt.toISOString(),
  };
}

const RULES = `You are the analyst inside What-If, a decision-planning tool. A deterministic engine has calculated every projection; you interpret them.
Rules:
- Answer the person's question directly and specifically, using FACTS (simulation results), ANALYSIS (robustness, break-even, thresholds), EVIDENCE (cited external data) and MEMORY.
- Never invent numbers. Use only numbers present in the context. If a number is not available, say what would need to be modelled (for example: "add a scenario that delays the move by 12 months in Decision Lab").
- For "what if" questions the model has not computed, explain the likely direction qualitatively and point to the input to change — do not estimate the result.
- Tag every statement with its basis:
  app_data = figures computed by What-If from the scenarios;
  user_assumption = values the person entered or confirmed;
  external = cited evidence;
  model = analysis derived by What-If (robustness, thresholds, break-even);
  interpretation = your own reasoning or judgement.
- Do not tell the person what to decide. Do not give personalised investment, legal, tax or medical advice.
- Plain, calm English. No emojis, no markdown headings, short paragraphs.

Respond with a single JSON object and nothing else:
{
  "answer": [ { "text": string, "basis": "app_data" | "user_assumption" | "external" | "model" | "interpretation" } ],
  "followUps": [ string ],      // up to 3 short follow-up questions the person might ask next
  "memoryFacts": [ string ]     // up to 3 durable facts the PERSON stated in this message (objectives, constraints, preferences); empty if none
}`;

export async function chat(
  ctx: AppContext,
  user: AuthUser,
  request: { ip?: string } | null,
  decision: DecisionDTO,
  message: string,
  profile: ProfileInput | null,
): Promise<AiMessageDTO[]> {
  const ai = await requireAi(ctx, user, request);
  const active = decision.scenarios.filter((s) => s.status === 'active');
  const results = new Map<string, SimulationResult>();
  const runIds: string[] = [];
  for (const s of active) {
    const run = await ensureRun(ctx.db, user.id, s);
    results.set(s.id, run.result);
    runIds.push(run.id);
  }
  const settings = parseSettings(decision.settings);
  const facts = buildFacts(decision, results, ai.shareProfile ? profile : null);
  const intel = buildIntelligence({
    title: decision.title,
    question: decision.question,
    category: decision.category,
    baseCurrency: decision.baseCurrency,
    scenarios: active,
    results,
    models: new Map(active.map((s) => [s.id, toEngineModel(s)])),
    assumptions: decision.assumptions,
    lifeWeights: decision.priorities ?? profile?.priorities ?? {},
  });
  const nameOf = (id: string | null) => active.find((s) => s.id === id)?.name ?? null;
  const analysis = {
    currency: decision.baseCurrency,
    expectedLeader: nameOf(intel.financialLeaderId),
    robustLeader: nameOf(intel.robustLeaderId),
    lifeQualityLeader: nameOf(intel.lifeLeaderId),
    robustness: intel.robustness.comparable
      ? intel.robustness.scenarios.map((r) => ({ scenario: nameOf(r.id), winProbability: r.winProbability, expectedRegret: Math.round(r.expectedRegret), p10: Math.round(r.p10), p50: Math.round(r.p50), p90: Math.round(r.p90), labels: r.labels }))
      : null,
    breakEven: intel.breakEvens.map((b) => ({ alternative: nameOf(b.alternativeId), overtakesBaselineAt: b.overtakesAt, monthsToBreakEven: b.monthsToBreakEven, maxDeficit: Math.round(b.maxDeficit), endAdvantage: Math.round(b.endAdvantage) })),
    whatWouldChangeTheOutcome: intel.mindChangers.slice(0, 6).map((m) => ({ scenario: nameOf(m.scenarioId), input: m.label, current: m.current, threshold: m.threshold, side: m.side, newLeader: nameOf(m.newLeaderId) })),
    lifeQuality: intel.alternatives.map((a) => ({ scenario: a.name, score: a.lifeScore })),
    keyAssumptions: intel.keyAssumptions.slice(0, 6).map((k) => ({ scenario: nameOf(k.scenarioId), input: k.label, swing: Math.round(k.swing), source: k.source })),
    unmodelledHiddenCosts: intel.hiddenCosts.filter((h) => !h.modelled).map((h) => h.label),
  };
  const ev = await ctx.db.select().from(evidence).where(eq(evidence.decisionId, decision.id)).orderBy(desc(evidence.createdAt)).limit(20);
  const evidenceFacts = ev.map((e) => ({ label: e.label, value: e.value, unit: e.unit, source: e.sourceName, retrieved: e.retrievedOn, coverage: e.coverage }));
  const history = await ctx.db.select().from(aiMessages).where(and(eq(aiMessages.decisionId, decision.id), eq(aiMessages.userId, user.id))).orderBy(desc(aiMessages.createdAt)).limit(8);
  const transcript = history
    .reverse()
    .map((m) => `${m.role === 'user' ? 'Person' : 'Analyst'}: ${m.role === 'user' ? m.content : ((m.output as { answer?: { text: string }[] } | null)?.answer ?? []).map((p) => p.text).join(' ')}`)
    .join('\n');

  const context = { FACTS: facts, ANALYSIS: analysis, EVIDENCE: evidenceFacts, MEMORY: settings.memory ?? {} };
  const userPrompt = `CONTEXT (JSON; money in each scenario's currency in FACTS, in ${decision.baseCurrency} in ANALYSIS; probabilities 0–1):\n${JSON.stringify(context)}\n\n${transcript ? `CONVERSATION SO FAR:\n${transcript}\n\n` : ''}QUESTION: ${message}`;

  const [userRow] = await ctx.db.insert(aiMessages).values({ userId: user.id, decisionId: decision.id, role: 'user', content: message }).returning();
  const provider = ctx.aiFactory(ai.cfg);
  try {
    const completion = await provider.complete({ system: RULES, user: userPrompt, maxTokens: ai.maxOutputTokens });
    const parsed = answerSchema.safeParse(extractJson(completion.text));
    if (!parsed.success) throw new AiProviderError('bad_response', 'The AI response did not match the expected structure.');
    const text = parsed.data.answer.map((a) => a.text).join('\n');
    const unverified = findUnverifiedNumbers(text, context);
    const [row] = await ctx.db
      .insert(aiMessages)
      .values({
        userId: user.id,
        decisionId: decision.id,
        role: 'assistant',
        content: text,
        output: parsed.data,
        unverifiedNumbers: unverified,
        provider: ai.cfg.provider,
        model: completion.model,
        runIds,
      })
      .returning();
    return [messageDTO(userRow!), messageDTO(row!)];
  } catch (err) {
    // Keep the question so the person can retry; surface the provider error.
    throw toAppError(err);
  }
}

export async function history(ctx: AppContext, userId: string, decisionId: string): Promise<AiMessageDTO[]> {
  const rows = await ctx.db.select().from(aiMessages).where(and(eq(aiMessages.decisionId, decisionId), eq(aiMessages.userId, userId))).orderBy(asc(aiMessages.createdAt)).limit(200);
  return rows.map(messageDTO);
}
