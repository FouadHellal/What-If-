import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client';
import { auditLog } from '../db/schema';

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.locked'
  | 'auth.logout'
  | 'auth.password_changed'
  | 'auth.session_revoked'
  | 'account.exported'
  | 'account.deleted'
  | 'account.examples_removed'
  | 'profile.updated'
  | 'ai.settings_updated'
  | 'ai.request'
  | 'decision.created'
  | 'decision.deleted'
  | 'decision.decided'
  | 'scenario.deleted'
  | 'report.created'
  | 'admin.settings_updated';

/** Records a security- or privacy-relevant event. Never stores secrets or personal financial values. */
export async function audit(
  db: Db,
  request: FastifyRequest | null,
  action: AuditAction,
  opts: { userId?: string | null; entityType?: string; entityId?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId: opts.userId ?? request?.user?.id ?? null,
      action,
      entityType: opts.entityType ?? null,
      entityId: opts.entityId ?? null,
      ip: request?.ip ?? null,
      userAgent: request?.headers['user-agent']?.slice(0, 300) ?? null,
      metadata: opts.metadata ?? null,
    });
  } catch (err) {
    request?.log.warn({ err, action }, 'Failed to write audit log');
  }
}
