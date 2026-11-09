import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import type {
  AssumptionDTO,
  CreateDecisionInput,
  DecisionAccess,
  DecisionDTO,
  DecisionPeopleDTO,
  DecisionSummaryDTO,
  MilestoneDTO,
  ScenarioDraft,
} from '@whatif/shared';
import { exampleDecision, parseSettings } from '@whatif/shared';
import type { Db } from '../db/client';
import { assumptions, decisionMembers, decisions, journalEntries, milestones, scenarios, simulationResults, simulationRuns, users } from '../db/schema';
import { requireDecision, visibleDecisions } from './access';
import { ensureRun, loadScenariosForDecision, writeModel, type Tx } from './scenarios';

type DecisionRow = typeof decisions.$inferSelect;
type MilestoneRow = typeof milestones.$inferSelect;
type AssumptionRow = typeof assumptions.$inferSelect;

export function milestoneDTO(m: MilestoneRow): MilestoneDTO {
  return {
    id: m.id,
    decisionId: m.decisionId,
    scenarioId: m.scenarioId,
    title: m.title,
    description: m.description,
    date: m.date,
    status: m.status as MilestoneDTO['status'],
    achievedOn: m.achievedOn,
    createdAt: m.createdAt.toISOString(),
  };
}

export function assumptionDTO(a: AssumptionRow): AssumptionDTO {
  return {
    id: a.id,
    scenarioId: a.scenarioId,
    text: a.text,
    category: a.category as AssumptionDTO['category'],
    source: a.source as AssumptionDTO['source'],
    likelihood: (a.likelihood as AssumptionDTO['likelihood']) ?? null,
    impact: (a.impact as AssumptionDTO['impact']) ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Owner and members of a decision. */
export async function decisionPeople(db: Tx, decision: Pick<DecisionRow, 'id' | 'userId'>): Promise<DecisionPeopleDTO> {
  const [owner, members] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, decision.userId)).limit(1),
    db
      .select({ id: users.id, name: users.name, email: users.email, role: decisionMembers.role, addedAt: decisionMembers.createdAt })
      .from(decisionMembers)
      .innerJoin(users, eq(users.id, decisionMembers.userId))
      .where(eq(decisionMembers.decisionId, decision.id))
      .orderBy(asc(decisionMembers.createdAt)),
  ]);
  return {
    owner: owner[0] ?? { id: decision.userId, name: 'Unknown', email: '' },
    members: members.map((m) => ({ ...m, addedAt: m.addedAt.toISOString() })),
  };
}

export async function touchDecision(db: Tx, id: string): Promise<void> {
  await db.update(decisions).set({ updatedAt: new Date() }).where(eq(decisions.id, id));
}

/** Inserts one scenario (with model and assumptions) into a decision. */
export async function insertScenario(tx: Tx, userId: string, decisionId: string, draft: ScenarioDraft, position: number, colorIndex: number): Promise<string> {
  const [row] = await tx
    .insert(scenarios)
    .values({
      decisionId,
      userId,
      name: draft.name,
      description: draft.description ?? null,
      isBaseline: draft.isBaseline ?? false,
      position,
      colorIndex,
      startDate: draft.startDate,
      horizonYears: draft.horizonYears,
      currency: draft.currency,
      exchangeRateToBase: draft.exchangeRateToBase,
      exchangeRateSource: draft.exchangeRateSource ?? null,
      scores: draft.scores ?? {},
      tax: draft.tax ?? null,
    })
    .returning({ id: scenarios.id });
  const scenarioId = row!.id;
  await writeModel(tx, scenarioId, draft);
  if (draft.assumptions?.length) {
    await tx.insert(assumptions).values(
      draft.assumptions.map((a) => ({
        decisionId,
        scenarioId,
        text: a.text,
        category: a.category,
        source: a.source,
        likelihood: a.likelihood ?? null,
        impact: a.impact ?? null,
      })),
    );
  }
  return scenarioId;
}

export async function createDecision(db: Db, userId: string, input: CreateDecisionInput, opts: { isExample?: boolean } = {}): Promise<string> {
  return db.transaction(async (tx) => {
    const [d] = await tx
      .insert(decisions)
      .values({
        userId,
        title: input.title,
        question: input.question ?? null,
        description: input.description ?? null,
        category: input.category,
        baseCurrency: input.baseCurrency,
        horizonYears: input.horizonYears,
        isExample: opts.isExample ?? false,
        origin: input.origin,
      })
      .returning({ id: decisions.id });
    const decisionId = d!.id;
    // Exactly one baseline: the first flagged one, or the first scenario.
    const baselineIdx = Math.max(0, input.scenarios.findIndex((s) => s.isBaseline));
    for (let i = 0; i < input.scenarios.length; i++) {
      await insertScenario(tx, userId, decisionId, { ...input.scenarios[i]!, isBaseline: i === baselineIdx }, i, i % 8);
    }
    return decisionId;
  });
}

export async function getDecisionDTO(db: Tx, userId: string, id: string): Promise<DecisionDTO> {
  const d = await requireDecision(db, userId, id, 'view');
  const [scenarioDtos, ms, as, people] = await Promise.all([
    loadScenariosForDecision(db, id),
    db.select().from(milestones).where(eq(milestones.decisionId, id)).orderBy(asc(milestones.date)),
    db.select().from(assumptions).where(eq(assumptions.decisionId, id)).orderBy(asc(assumptions.createdAt)),
    decisionPeople(db, d),
  ]);
  return {
    id: d.id,
    access: d.access,
    sharedBy: d.access === 'owner' ? null : people.owner.name,
    people,
    title: d.title,
    question: d.question,
    description: d.description,
    category: d.category as DecisionDTO['category'],
    status: d.status as DecisionDTO['status'],
    horizonYears: d.horizonYears,
    baseCurrency: d.baseCurrency,
    isExample: d.isExample,
    chosenScenarioId: d.chosenScenarioId,
    priorities: d.priorities,
    settings: parseSettings(d.settings),
    rationale: d.rationale,
    expectations: d.expectations,
    decidedAt: d.decidedAt?.toISOString() ?? null,
    decidedRunId: d.decidedRunId,
    origin: d.origin as DecisionDTO['origin'],
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    scenarios: scenarioDtos,
    assumptions: as.map(assumptionDTO),
    milestones: ms.map(milestoneDTO),
  };
}

export interface ListOptions {
  q?: string | undefined;
  status: string;
  category?: string | undefined;
  sort: 'updated' | 'created' | 'title';
  /** all (default), only my own decisions, or only those shared with me. */
  shared?: 'all' | 'mine' | 'with_me' | undefined;
  page: number;
  pageSize: number;
}

export async function listDecisionSummaries(db: Db, userId: string, opts: ListOptions): Promise<{ items: DecisionSummaryDTO[]; total: number }> {
  const conds: SQL[] = [visibleDecisions(db, userId)];
  if (opts.shared === 'mine') conds.push(eq(decisions.userId, userId));
  else if (opts.shared === 'with_me') conds.push(ne(decisions.userId, userId));
  if (opts.status === 'active') conds.push(ne(decisions.status, 'archived'));
  else if (opts.status !== 'all') conds.push(eq(decisions.status, opts.status));
  if (opts.category) conds.push(eq(decisions.category, opts.category));
  if (opts.q) {
    const term = `%${opts.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(decisions.title, term), ilike(decisions.question, term), ilike(decisions.description, term))!);
  }
  const where = and(...conds);
  const order = opts.sort === 'title' ? asc(decisions.title) : opts.sort === 'created' ? desc(decisions.createdAt) : desc(decisions.updatedAt);
  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(decisions)
      .where(where)
      .orderBy(order, desc(decisions.id))
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize),
    db.select({ n: count() }).from(decisions).where(where),
  ]);
  return { items: await summarize(db, rows, userId), total: Number(totalRows[0]?.n ?? 0) };
}

/** Builds list summaries including each scenario's latest stored expected outcome. */
export async function summarize(db: Db, rows: DecisionRow[], userId: string): Promise<DecisionSummaryDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [memberRows, ownerRows] = await Promise.all([
    db.select({ decisionId: decisionMembers.decisionId, userId: decisionMembers.userId, role: decisionMembers.role }).from(decisionMembers).where(inArray(decisionMembers.decisionId, ids)),
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...new Set(rows.map((r) => r.userId))])),
  ]);
  const accessOf = (d: DecisionRow): DecisionAccess => (d.userId === userId ? 'owner' : (memberRows.find((m) => m.decisionId === d.id && m.userId === userId)?.role ?? 'viewer'));
  const scen = await db
    .select({
      id: scenarios.id,
      decisionId: scenarios.decisionId,
      name: scenarios.name,
      colorIndex: scenarios.colorIndex,
      isBaseline: scenarios.isBaseline,
      status: scenarios.status,
      currency: scenarios.currency,
      fx: scenarios.exchangeRateToBase,
      position: scenarios.position,
    })
    .from(scenarios)
    .where(inArray(scenarios.decisionId, ids))
    .orderBy(asc(scenarios.position));
  const scenIds = scen.map((s) => s.id);
  // Latest run summary per scenario (DISTINCT ON keeps this to one row each).
  const latest = scenIds.length
    ? await db
        .selectDistinctOn([simulationRuns.scenarioId], {
          scenarioId: simulationRuns.scenarioId,
          finalNetWorth: sql<number>`(${simulationResults.summary} ->> 'finalNetWorth')::float8`,
        })
        .from(simulationRuns)
        .innerJoin(simulationResults, eq(simulationResults.runId, simulationRuns.id))
        .where(inArray(simulationRuns.scenarioId, scenIds))
        .orderBy(simulationRuns.scenarioId, desc(simulationRuns.createdAt))
    : [];
  return rows.map((d) => {
    const own = scen.filter((s) => s.decisionId === d.id && s.status === 'active');
    return {
      id: d.id,
      title: d.title,
      question: d.question,
      category: d.category as DecisionSummaryDTO['category'],
      status: d.status as DecisionSummaryDTO['status'],
      horizonYears: d.horizonYears,
      baseCurrency: d.baseCurrency,
      isExample: d.isExample,
      scenarioCount: own.length,
      access: accessOf(d),
      sharedBy: d.userId === userId ? null : (ownerRows.find((o) => o.id === d.userId)?.name ?? null),
      memberCount: memberRows.filter((m) => m.decisionId === d.id).length,
      chosenScenarioId: d.chosenScenarioId,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      preview: own.map((s) => {
        const nw = latest.find((l) => l.scenarioId === s.id)?.finalNetWorth ?? null;
        const convertible = s.currency === d.baseCurrency || (s.fx !== null && s.fx > 0);
        return {
          id: s.id,
          name: s.name,
          colorIndex: s.colorIndex,
          isBaseline: s.isBaseline,
          finalNetWorth: nw === null || !convertible ? null : s.currency === d.baseCurrency ? nw : nw * (s.fx ?? 1),
          currency: convertible ? d.baseCurrency : s.currency,
        };
      }),
    };
  });
}

/** Creates the illustrative example decision for a user, with milestones and a journal entry. */
export async function createExample(db: Db, userId: string): Promise<string> {
  const now = new Date();
  const start = `${now.getUTCFullYear() + (now.getUTCMonth() === 11 ? 1 : 0)}-${String(((now.getUTCMonth() + 1) % 12) + 1).padStart(2, '0')}`;
  const ex = exampleDecision(start);
  const decisionId = await createDecision(db, userId, ex, { isExample: true });
  const scen = await db.select({ id: scenarios.id, position: scenarios.position }).from(scenarios).where(eq(scenarios.decisionId, decisionId)).orderBy(asc(scenarios.position));
  const [y, m] = start.split('-').map(Number) as [number, number];
  const at = (offset: number) => {
    const n = y * 12 + (m - 1) + offset;
    return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
  };
  await db.insert(milestones).values(
    ex.milestones.map((ms) => ({
      decisionId,
      scenarioId: ms.scenarioIndex === null ? null : (scen[ms.scenarioIndex]?.id ?? null),
      title: ms.title,
      description: ms.description,
      date: at(ms.offsetMonths),
    })),
  );
  await db.insert(journalEntries).values(
    ex.journal.map((j) => ({ userId, decisionId, type: j.type, title: j.title, body: j.body, entryDate: now.toISOString().slice(0, 10) })),
  );
  // Precompute runs so lists show outcomes immediately.
  for (const s of await loadScenariosForDecision(db, decisionId)) await ensureRun(db, userId, s);
  return decisionId;
}

export { decisions as decisionsTable };
