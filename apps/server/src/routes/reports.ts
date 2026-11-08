import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createReportSchema, type ReportSnapshot } from '@whatif/shared';
import { reports } from '../db/schema';
import { audit } from '../lib/audit';
import { notFound, parse } from '../lib/errors';
import { requireUser } from '../http/auth';
import { getDecisionDTO } from '../services/decisions';
import { buildSnapshot, reportDTO } from '../services/reports';
import { renderReportPdf } from '../services/pdf';
import { getProfile } from './account';

const idParam = z.object({ id: z.uuid() });

export async function reportRoutes(app: FastifyInstance) {
  const db = app.ctx.db;

  app.post('/api/decisions/:id/reports', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const input = parse(createReportSchema, request.body ?? {});
    const decision = await getDecisionDTO(db, user.id, id);
    const profile = await getProfile(app, user.id);
    const snapshot = await buildSnapshot(db, user.id, decision, profile, input.includeAiSummary);
    const title = input.title ?? `${decision.title} — ${new Date().toISOString().slice(0, 10)}`;
    const [row] = await db.insert(reports).values({ userId: user.id, decisionId: id, title, snapshot }).returning();
    await audit(db, request, 'report.created', { entityType: 'report', entityId: row!.id });
    reply.status(201);
    return reportDTO(row!);
  });

  app.get('/api/decisions/:id/reports', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const rows = await db
      .select({ id: reports.id, title: reports.title, createdAt: reports.createdAt, decisionId: reports.decisionId })
      .from(reports)
      .where(and(eq(reports.decisionId, id), eq(reports.userId, user.id)))
      .orderBy(desc(reports.createdAt))
      .limit(50);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });

  app.get('/api/reports/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const rows = await db.select().from(reports).where(and(eq(reports.id, id), eq(reports.userId, user.id))).limit(1);
    if (!rows[0]) throw notFound('Report');
    return reportDTO(rows[0]);
  });

  app.get('/api/reports/:id/pdf', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const rows = await db.select().from(reports).where(and(eq(reports.id, id), eq(reports.userId, user.id))).limit(1);
    const row = rows[0];
    if (!row) throw notFound('Report');
    const pdf = await renderReportPdf(row.snapshot as ReportSnapshot, row.title);
    const filename = row.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'decision-report';
    void reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${filename}.pdf"`).header('cache-control', 'private, no-store');
    return reply.send(pdf);
  });

  app.delete('/api/reports/:id', async (request) => {
    const user = requireUser(request);
    const { id } = parse(idParam, request.params);
    const res = await db.delete(reports).where(and(eq(reports.id, id), eq(reports.userId, user.id))).returning({ id: reports.id });
    if (!res[0]) throw notFound('Report');
    return { ok: true };
  });
}
