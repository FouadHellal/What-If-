import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { monthNumber, type SimulationResult } from '@whatif/engine';
import { JOURNAL_TYPES, journalEntrySchema, updateJournalEntrySchema, type JournalEntryDTO, type Paginated } from '@whatif/shared';
import type { Db } from '../db/client';
import { decisions, journalEntries, scenarios, simulationResults } from '../db/schema';
import { badRequest, notFound, parse } from '../lib/errors';
import { requireUser } from '../http/auth';
import { decisionAccess } from '../services/access';

type Row = typeof journalEntries.$inferSelect;

export function journalDTO(r: Row, decisionTitle: string | null): JournalEntryDTO {
  return {
    id: r.id,
    decisionId: r.decisionId,
    decisionTitle,
    scenarioId: r.scenarioId,
    type: r.type as JournalEntryDTO['type'],
    title: r.title,
    body: r.body,
    entryDate: r.entryDate,
    actuals: (r.actuals as JournalEntryDTO['actuals']) ?? null,
    projected: (r.projected as JournalEntryDTO['projected']) ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Looks up what the pinned (decided) run projected for the month of a check-in, in base currency. */
async function projectedFor(db: Db, userId: string, decisionId: string | null | undefined, entryDate: string): Promise<JournalEntryDTO['projected']> {
  if (!decisionId) return null;
  const d = (await decisionAccess(db, userId, decisionId))?.row;
  if (!d?.decidedRunId || !d.chosenScenarioId) return null;
  const [res, scen] = await Promise.all([
    db.select({ result: simulationResults.result }).from(simulationResults).where(eq(simulationResults.runId, d.decidedRunId)).limit(1),
    db.select().from(scenarios).where(eq(scenarios.id, d.chosenScenarioId)).limit(1),
  ]);
  const result = res[0]?.result as SimulationResult | undefined;
  const s = scen[0];
  if (!result || !s) return null;
  const fx = s.currency === d.baseCurrency ? 1 : (s.exchangeRateToBase ?? null);
  if (fx === null) return null;
  const offset = monthNumber(entryDate.slice(0, 7)) - monthNumber(result.startDate);
  const pt = result.expected.months[offset];
  if (!pt) return null;
  const c = (n: number) => Math.round(n * fx);
  return { netWorth: c(pt.netWorth), cash: c(pt.cash), monthlyIncome: c(pt.netIncome), monthlyExpenses: c(pt.totalExpenses) };
}

export async function journalRoutes(app: FastifyInstance) {
  const db = app.ctx.db;

  app.get('/api/journal', async (request): Promise<Paginated<JournalEntryDTO>> => {
    const user = requireUser(request);
    const q = parse(
      z.object({
        decisionId: z.uuid().optional(),
        type: z.enum(JOURNAL_TYPES).optional(),
        page: z.coerce.number().int().min(1).max(10_000).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(30),
      }),
      request.query,
    );
    const conds: SQL[] = [eq(journalEntries.userId, user.id)];
    if (q.decisionId) conds.push(eq(journalEntries.decisionId, q.decisionId));
    if (q.type) conds.push(eq(journalEntries.type, q.type));
    const where = and(...conds);
    const [rows, total] = await Promise.all([
      db
        .select({ j: journalEntries, title: decisions.title })
        .from(journalEntries)
        .leftJoin(decisions, eq(decisions.id, journalEntries.decisionId))
        .where(where)
        .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      db.select({ n: count() }).from(journalEntries).where(where),
    ]);
    return { items: rows.map((r) => journalDTO(r.j, r.title)), total: Number(total[0]?.n ?? 0), page: q.page, pageSize: q.pageSize };
  });

  app.post('/api/journal', async (request, reply) => {
    const user = requireUser(request);
    const input = parse(journalEntrySchema, request.body);
    await assertLinks(user.id, input.decisionId, input.scenarioId);
    const projected = input.type === 'checkin' ? await projectedFor(db, user.id, input.decisionId, input.entryDate) : null;
    const [row] = await db
      .insert(journalEntries)
      .values({
        userId: user.id,
        decisionId: input.decisionId ?? null,
        scenarioId: input.scenarioId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        entryDate: input.entryDate,
        actuals: input.actuals ?? null,
        projected,
      })
      .returning();
    reply.status(201);
    return journalDTO(row!, await decisionTitle(input.decisionId));
  });

  app.patch<{ Params: { id: string } }>('/api/journal/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    const input = parse(updateJournalEntrySchema, request.body);
    const existing = await db.select().from(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.userId, user.id))).limit(1);
    if (!existing[0]) throw notFound('Journal entry');
    await assertLinks(user.id, input.decisionId, input.scenarioId);
    const merged = { ...existing[0], ...input };
    const projected = merged.type === 'checkin' ? await projectedFor(db, user.id, merged.decisionId, merged.entryDate) : null;
    const [row] = await db
      .update(journalEntries)
      .set({ ...input, projected, updatedAt: new Date() })
      .where(eq(journalEntries.id, id))
      .returning();
    return journalDTO(row!, await decisionTitle(row!.decisionId));
  });

  app.delete<{ Params: { id: string } }>('/api/journal/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(z.object({ id: z.uuid() }), request.params);
    const res = await db.delete(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.userId, user.id))).returning({ id: journalEntries.id });
    if (!res[0]) throw notFound('Journal entry');
    return { ok: true };
  });

  async function assertLinks(userId: string, decisionId?: string | null, scenarioId?: string | null) {
    // Journal entries are personal, but may point at any decision the user can open.
    if (decisionId && !(await decisionAccess(db, userId, decisionId))) throw badRequest('That decision does not exist.');
    if (scenarioId) {
      const s = await db.select({ decisionId: scenarios.decisionId }).from(scenarios).where(eq(scenarios.id, scenarioId)).limit(1);
      if (!s[0] || (decisionId && s[0].decisionId !== decisionId) || !(await decisionAccess(db, userId, s[0].decisionId))) {
        throw badRequest('That scenario does not belong to the selected decision.');
      }
    }
  }

  async function decisionTitle(id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    const r = await db.select({ t: decisions.title }).from(decisions).where(eq(decisions.id, id)).limit(1);
    return r[0]?.t ?? null;
  }
}
