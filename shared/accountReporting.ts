export const ACCOUNT_REPORT_REASONS = [
  ['impersonation', 'Pretending to be someone else'], ['scam', 'Scam or fraud'],
  ['harassment', 'Harassment or bullying'], ['spam', 'Spam'],
  ['inappropriate', 'Inappropriate content'], ['other', 'Something else'],
] as const;

type ReporterClient = { from(table: string): { insert(value: Record<string, unknown>): PromiseLike<{error: {code?: string; message?: string} | null}> } };

export async function reportAccount(client: ReporterClient, reporterId: string, reportedId: string, reason: string, details = '') {
  if (!reporterId || !reportedId || reporterId === reportedId) throw new Error('Choose another account to report.');
  if (!ACCOUNT_REPORT_REASONS.some(([value]) => value === reason)) throw new Error('Choose a report reason.');
  if (details.trim().length > 2000) throw new Error('Keep the report details under 2,000 characters.');
  const { error } = await client.from('user_reports').insert({reporter_id:reporterId, reported_id:reportedId, reason, details:details.trim() || null});
  if (error?.code === '23505') return 'You already have an open report for this account.';
  if (error) throw new Error('Your report was not sent. Please try again.');
  return 'Report sent to the safety team. You can also block this account.';
}
