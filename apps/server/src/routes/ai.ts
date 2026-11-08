import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { aiAnalyzeSchema, aiSettingsSchema } from '@whatif/shared';
import { aiAnalyses, userSettings } from '../db/schema';
import { audit } from '../lib/audit';
import { forbidden, notFound, parse } from '../lib/errors';
import { requireUser } from '../http/auth';
import { getDecisionDTO } from '../services/decisions';
import { aiStatus, analysisDTO, getSettingsRow, runAnalysis, testConnection } from '../services/ai/service';
import { getProfile } from './account';

export async function aiRoutes(app: FastifyInstance) {
  const db = app.ctx.db;
  const aiLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  app.get('/api/ai/settings', async (request) => aiStatus(app.ctx, requireUser(request).id));

  app.put('/api/ai/settings', async (request) => {
    const user = requireUser(request);
    const input = parse(aiSettingsSchema, request.body);
    const current = await getSettingsRow(app.ctx, user.id);
    const patch: Partial<typeof userSettings.$inferInsert> = {
      aiEnabled: input.enabled,
      aiShareProfile: input.shareProfile,
      aiDailyLimit: input.dailyLimit,
      aiMaxOutputTokens: input.maxOutputTokens,
      updatedAt: new Date(),
    };
    const changesProvider = input.provider !== (current.aiProvider ?? null) || (input.baseUrl ?? null) !== (current.aiBaseUrl ?? null) || (input.model ?? null) !== (current.aiModel ?? null) || input.apiKey !== undefined;
    if (changesProvider) {
      if (!app.ctx.config.ai.allowUserConfig && input.provider !== null) {
        throw forbidden('The administrator manages the AI provider on this instance.');
      }
      // A custom endpoint can reach other machines on the network — limit that to administrators.
      if (input.baseUrl && user.role !== 'admin') throw forbidden('Only administrators can set a custom AI endpoint URL.');
      patch.aiProvider = input.provider;
      patch.aiBaseUrl = input.baseUrl ?? null;
      patch.aiModel = input.model ?? null;
      if (input.apiKey === null || input.provider === null) patch.aiApiKeyEnc = null;
      else if (input.apiKey) patch.aiApiKeyEnc = app.ctx.secrets.encrypt(input.apiKey);
    }
    await db.update(userSettings).set(patch).where(eq(userSettings.userId, user.id));
    await audit(db, request, 'ai.settings_updated', {
      metadata: { enabled: input.enabled, provider: input.provider, keyChanged: input.apiKey !== undefined, shareProfile: input.shareProfile },
    });
    return aiStatus(app.ctx, user.id);
  });

  app.post('/api/ai/test', { config: aiLimit }, async (request) => {
    const user = requireUser(request);
    return testConnection(app.ctx, user, request);
  });

  app.get<{ Params: { id: string } }>('/api/decisions/:id/ai', async (request) => {
    const user = requireUser(request);
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    await getDecisionDTO(db, user.id, id);
    const rows = await db
      .select()
      .from(aiAnalyses)
      .where(and(eq(aiAnalyses.decisionId, id), eq(aiAnalyses.userId, user.id)))
      .orderBy(desc(aiAnalyses.createdAt))
      .limit(30);
    return rows.map(analysisDTO);
  });

  app.post<{ Params: { id: string } }>('/api/decisions/:id/ai', { config: aiLimit }, async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    const input = parse(aiAnalyzeSchema, request.body);
    const decision = await getDecisionDTO(db, user.id, id);
    if (input.scenarioId && !decision.scenarios.some((s) => s.id === input.scenarioId)) throw notFound('Scenario');
    const profile = await getProfile(app, user.id);
    const dto = await runAnalysis(app.ctx, user, request, decision, input.task, input.scenarioId ?? null, profile);
    reply.status(201);
    return dto;
  });

  app.delete<{ Params: { id: string } }>('/api/ai/analyses/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    const res = await db.delete(aiAnalyses).where(and(eq(aiAnalyses.id, id), eq(aiAnalyses.userId, user.id))).returning({ id: aiAnalyses.id });
    if (!res[0]) throw notFound('Analysis');
    return { ok: true };
  });
}
