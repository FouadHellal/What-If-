import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  AiAnalysisDTO,
  AiStatusDTO,
  AuditEventDTO,
  DecisionDTO,
  DecisionSummaryDTO,
  JournalEntryDTO,
  MilestoneDTO,
  OverviewDTO,
  Paginated,
  ReportDTO,
  ScenarioDTO,
} from '@whatif/shared';
import { del, get, patch, post, put } from './client';

export const keys = {
  overview: ['overview'] as const,
  decisions: (params: Record<string, unknown>) => ['decisions', params] as const,
  decision: (id: string) => ['decision', id] as const,
  journal: (params: Record<string, unknown>) => ['journal', params] as const,
  ai: (decisionId: string) => ['ai', decisionId] as const,
  aiSettings: ['ai-settings'] as const,
  reports: (decisionId: string) => ['reports', decisionId] as const,
  report: (id: string) => ['report', id] as const,
  sessions: ['sessions'] as const,
  audit: (page: number) => ['audit', page] as const,
  admin: ['admin'] as const,
  runs: (scenarioId: string) => ['runs', scenarioId] as const,
};

export function useOverview() {
  return useQuery({ queryKey: keys.overview, queryFn: ({ signal }) => get<OverviewDTO>('/overview', signal) });
}

export function useDecisions(params: { q?: string; status?: string; category?: string; sort?: string; page?: number }) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
  return useQuery({
    queryKey: keys.decisions(params),
    queryFn: ({ signal }) => get<Paginated<DecisionSummaryDTO>>(`/decisions?${qs}`, signal),
    placeholderData: keepPreviousData,
  });
}

export function useDecision(id: string | undefined) {
  return useQuery({ queryKey: keys.decision(id ?? ''), queryFn: ({ signal }) => get<DecisionDTO>(`/decisions/${id}`, signal), enabled: Boolean(id) });
}

/** Keeps every decision-dependent view fresh after a change. */
export function useInvalidateDecision() {
  const qc = useQueryClient();
  return (id?: string) => {
    if (id) void qc.invalidateQueries({ queryKey: keys.decision(id) });
    void qc.invalidateQueries({ queryKey: ['decisions'] });
    void qc.invalidateQueries({ queryKey: keys.overview });
  };
}

export function useUpdateDecision(id: string) {
  const qc = useQueryClient();
  const inv = useInvalidateDecision();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => patch<DecisionDTO>(`/decisions/${id}`, body),
    onSuccess: (d) => {
      qc.setQueryData(keys.decision(id), d);
      inv();
    },
  });
}

export function setScenarioInCache(qc: ReturnType<typeof useQueryClient>, s: ScenarioDTO) {
  qc.setQueryData<DecisionDTO>(keys.decision(s.decisionId), (d) => (d ? { ...d, scenarios: d.scenarios.map((x) => (x.id === s.id ? s : x)) } : d));
}

export function useJournal(params: { decisionId?: string; type?: string; page?: number }) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, String(v));
  return useQuery({ queryKey: keys.journal(params), queryFn: ({ signal }) => get<Paginated<JournalEntryDTO>>(`/journal?${qs}`, signal), placeholderData: keepPreviousData });
}

export function useAiSettings() {
  return useQuery({ queryKey: keys.aiSettings, queryFn: ({ signal }) => get<AiStatusDTO>('/ai/settings', signal) });
}

export function useAnalyses(decisionId: string) {
  return useQuery({ queryKey: keys.ai(decisionId), queryFn: ({ signal }) => get<AiAnalysisDTO[]>(`/decisions/${decisionId}/ai`, signal) });
}

export function useReports(decisionId: string) {
  return useQuery({ queryKey: keys.reports(decisionId), queryFn: ({ signal }) => get<{ id: string; title: string; createdAt: string }[]>(`/decisions/${decisionId}/reports`, signal) });
}

export function useReport(id: string | undefined) {
  return useQuery({ queryKey: keys.report(id ?? ''), queryFn: ({ signal }) => get<ReportDTO>(`/reports/${id}`, signal), enabled: Boolean(id) });
}

export function useAudit(page: number) {
  return useQuery({ queryKey: keys.audit(page), queryFn: ({ signal }) => get<{ items: AuditEventDTO[]; page: number; pageSize: number }>(`/account/audit?page=${page}`, signal) });
}

export function useSessions() {
  return useQuery({
    queryKey: keys.sessions,
    queryFn: ({ signal }) => get<{ id: string; current: boolean; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; expiresAt: string }[]>('/auth/sessions', signal),
  });
}

export function useRuns(scenarioId: string | undefined) {
  return useQuery({
    queryKey: keys.runs(scenarioId ?? ''),
    queryFn: ({ signal }) => get<{ id: string; scenarioVersion: number; engineVersion: string; inputHash: string; seed: number; runs: number; createdAt: string; durationMs: number }[]>(`/scenarios/${scenarioId}/runs`, signal),
    enabled: Boolean(scenarioId),
  });
}

export { del, get, patch, post, put };
export type { MilestoneDTO };
