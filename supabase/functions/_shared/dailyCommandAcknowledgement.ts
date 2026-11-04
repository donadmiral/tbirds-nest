// Daily acknowledges command delivery as status:'sent'. Older responses used sent.
// Neither form confirms media delivery. Only verified provider events set LIVE.
export function dailyCommandAccepted(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const acknowledgement = value as Record<string, unknown>;
  if (acknowledgement.error) return false;
  if (acknowledgement.status !== undefined && acknowledgement.status !== 'sent') return false;
  if (acknowledgement.sent !== undefined && acknowledgement.sent !== true && acknowledgement.sent !== 'true') return false;
  return acknowledgement.status === 'sent' || acknowledgement.sent === true || acknowledgement.sent === 'true';
}
