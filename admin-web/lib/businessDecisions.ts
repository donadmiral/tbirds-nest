type Cursor = { decided_at: string | null; id: string };
export type BusinessDecision = Cursor & { company_name: string; desired_username: string; status: string; decision_reason: string | null };
type Search = { beforeDecision?: unknown; decisionId?: unknown };

export function decisionCursor({ beforeDecision, decisionId }: Search): Cursor | null {
  if (typeof decisionId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(decisionId)) return null;
  if (beforeDecision === 'undated') return { id: decisionId, decided_at: null };
  if (typeof beforeDecision !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(beforeDecision) ||
      !Number.isFinite(Date.parse(beforeDecision))) return null;
  // Preserve PostgreSQL microseconds when serializing the next request.
  return { id: decisionId, decided_at: beforeDecision };
}

export function businessesHref(page: number, applications: number, decision: Cursor | null) {
  const query = new URLSearchParams({ page: String(page), applications: String(applications) });
  if (decision) {
    query.set('beforeDecision', decision.decided_at ?? 'undated');
    query.set('decisionId', decision.id);
  }
  return '/businesses?' + query.toString();
}
