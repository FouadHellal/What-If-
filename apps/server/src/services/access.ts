/**
 * Who may do what with a decision. A decision belongs to one owner and can be
 * shared with other users of the instance as editors (change everything except
 * sharing and deletion) or viewers (read only). Everything inside a decision —
 * scenarios, runs, assumptions, milestones, experiments, evidence — follows the
 * decision's access. Journals, reports, AI conversations and profiles stay personal.
 */
import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import type { DecisionAccess } from '@whatif/shared';
import { decisionMembers, decisions, scenarios } from '../db/schema';
import { forbidden, notFound } from '../lib/errors';
import type { Tx } from './scenarios';

type DecisionRow = typeof decisions.$inferSelect;
export type AccessNeed = 'view' | 'edit' | 'owner';

const RANK: Record<DecisionAccess, number> = { viewer: 0, editor: 1, owner: 2 };
const NEED: Record<AccessNeed, number> = { view: 0, edit: 1, owner: 2 };

export function allows(access: DecisionAccess, need: AccessNeed): boolean {
  return RANK[access] >= NEED[need];
}

/** The decision and the user's access to it, or null when they cannot see it at all. */
export async function decisionAccess(db: Tx, userId: string, decisionId: string): Promise<{ row: DecisionRow; access: DecisionAccess } | null> {
  const rows = await db
    .select({ d: decisions, role: decisionMembers.role })
    .from(decisions)
    .leftJoin(decisionMembers, and(eq(decisionMembers.decisionId, decisions.id), eq(decisionMembers.userId, userId)))
    .where(eq(decisions.id, decisionId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  if (r.d.userId === userId) return { row: r.d, access: 'owner' };
  if (r.role) return { row: r.d, access: r.role };
  return null;
}

function denied(need: AccessNeed) {
  return forbidden(
    need === 'owner'
      ? 'Only the owner of this decision can do that.'
      : 'This decision was shared with you to view only. Ask the owner for edit access.',
  );
}

/** Loads a decision the user may access at the required level. Unknown and invisible decisions are both 404. */
export async function requireDecision(db: Tx, userId: string, decisionId: string, need: AccessNeed): Promise<DecisionRow & { access: DecisionAccess }> {
  const a = await decisionAccess(db, userId, decisionId);
  if (!a) throw notFound('Decision');
  if (!allows(a.access, need)) throw denied(need);
  return { ...a.row, access: a.access };
}

/** Checks access to the decision that owns a scenario. Throws 404 for scenarios the user cannot see. */
export async function requireScenarioAccess(db: Tx, userId: string, scenarioId: string, need: AccessNeed): Promise<typeof scenarios.$inferSelect> {
  const rows = await db.select().from(scenarios).where(eq(scenarios.id, scenarioId)).limit(1);
  const s = rows[0];
  if (!s) throw notFound('Scenario');
  const a = await decisionAccess(db, userId, s.decisionId);
  if (!a) throw notFound('Scenario');
  if (!allows(a.access, need)) throw denied(need);
  return s;
}

/** SQL condition: decisions the user owns or that are shared with them. */
export function visibleDecisions(db: Tx, userId: string): SQL {
  return or(
    eq(decisions.userId, userId),
    inArray(decisions.id, db.select({ id: decisionMembers.decisionId }).from(decisionMembers).where(eq(decisionMembers.userId, userId))),
  )!;
}
