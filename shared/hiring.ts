export type ApplicantCursor = { id: string; applied_at: string };
export type ApplicantPage<T> = { applications: T[]; counts: Record<string, number>; has_more: boolean; cursor: ApplicantCursor | null; next_interviews?: { id: string; interview_at: string; name: string }[]; interviews_today?: number };
type Client = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isJobId(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
export async function loadApplicantPage<T>(client: Client, jobId: string, status = 'all', cursor: ApplicantCursor | null = null): Promise<ApplicantPage<T>> {
  if (!isJobId(jobId)) throw new Error('This job link is invalid.');
  const { data, error } = await client.rpc('studio_applicant_page', { p_job: jobId, p_status: status, p_before_at: cursor?.applied_at ?? null, p_before_id: cursor?.id ?? null, p_limit: 25 });
  if (error || !data || !Array.isArray(data.applications) || !data.counts) throw new Error(error?.message || 'Applicants could not be loaded. Please try again.');
  return data as ApplicantPage<T>;
}
export function mergeApplicants<T extends { id: string }>(current: T[], next: T[]): T[] { return [...new Map([...current, ...next].map(row => [row.id, row])).values()]; }
export async function saveApplicationStatus<T extends { id: string; status: string; updated_at?: string | null }>(client: Client, application: T, status: string): Promise<T> {
 const { data, error } = await client.rpc('studio_update_application', { p_application: application.id, p_status: status, p_expected_status: application.status, p_expected_updated_at: application.updated_at ?? null });
 if (error || !data) throw new Error(error?.message || 'Application could not be updated. Refresh and try again.');
 return { ...application, ...data };
}
export async function saveInterview<T extends { id: string; status: string; updated_at?: string | null }>(client: Client, application: T, at: string | null, location: string | null): Promise<T> {
 if (at !== null && (!Number.isFinite(Date.parse(at)) || Date.parse(at) <= Date.now())) throw new Error('Choose a future interview time.');
 const { data, error } = await client.rpc('studio_schedule_interview', { p_application: application.id, p_at: at, p_location: location?.trim() || null, p_expected_updated_at: application.updated_at ?? null, p_expected_status: application.status });
 if (error || !data) throw new Error(error?.message || 'Interview could not be saved. Refresh and try again.');
 return { ...application, ...data };
}
