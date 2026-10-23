/** Public creator-finance data. Monetary values remain decimal strings. */
export const PRIMARY_PAYOUT_PROVIDER = 'intobank';
export const BALANCE_BUCKETS = ['pending', 'available', 'reserved', 'paid', 'withheld', 'reversed'] as const;
export type BalanceBucket = typeof BALANCE_BUCKETS[number];
export type EnrollmentStatus = 'not_enrolled' | 'interested' | 'applied' | 'approved' | 'rejected' | 'suspended';
export type PayoutStatus = 'requested' | 'submitted' | 'unknown' | 'completed' | 'rejected';
export type PayoutAccountStatus = 'not_configured' | 'pending' | 'ready' | 'restricted';
export type CreatorSnapshot = {
  environment?: 'test' | 'live';
  user_id: string; as_of: string;
  program: { enrollment_open: boolean; terms_version: string | null; terms_url: string | null };
  provider: { id: string; name: string; payouts_enabled: boolean; currencies: string[] };
  enrollment: { status: EnrollmentStatus; reason: string | null };
  payout_account: { status: PayoutAccountStatus; verified_at: string | null };
  balances: { currency: string; bucket: BalanceBucket; amount_minor: string }[];
  recent_earnings: { id: string; created_at: string; currency: string; amount_minor: string; from: string; to: BalanceBucket }[];
  recent_payouts: { id: string; created_at: string; currency: string; amount_minor: string; status: PayoutStatus; provider_id: string; provider_reference: string | null }[];
};
const ENROLLMENTS = ['not_enrolled', 'interested', 'applied', 'approved', 'rejected', 'suspended'];
const PAYOUTS = ['requested', 'submitted', 'unknown', 'completed', 'rejected'];
const MAX_MINOR = '9223372036854775807';
export function validMinor(value: unknown, positive = false): value is string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) return false;
  return (!positive || value !== '0') && (value.length < MAX_MINOR.length || (value.length === MAX_MINOR.length && value <= MAX_MINOR));
}
/** USD is the only currently supported conversion contract. Never use floats. */
export function usdToMinor(input: string): string {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(input.trim());
  if (!match) throw new Error('Enter a USD amount with no more than two decimal places.');
  const value = (match[1] + (match[2] || '').padEnd(2, '0')).replace(/^0+(?=\d)/, '');
  if (!validMinor(value, true)) throw new Error('Enter a positive amount within the supported range.');
  return value;
}
export function formatMinor(value: string, currency: string): string {
  if (!validMinor(value)) throw new Error('Invalid monetary value');
  if (currency !== 'USD') return `${value} minor units (${currency})`;
  const padded = value.padStart(3, '0');
  return `USD ${padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${padded.slice(-2)}`;
}
export function parseCreatorSnapshot(value: unknown, userId: string): CreatorSnapshot {
  const v = value as CreatorSnapshot | null;
  const textOrNull = (x: unknown) => x === null || typeof x === 'string';
  const date = (x: unknown) => typeof x === 'string' && Number.isFinite(Date.parse(x));
  const money = (x: { currency: unknown; amount_minor: unknown }, positive = false) => typeof x?.currency === 'string' && /^[A-Z]{3}$/.test(x.currency) && validMinor(x?.amount_minor, positive);
  const termsUrl = (x: unknown) => {
    if (typeof x !== 'string' || x.length > 2048) return false;
    try { const url = new URL(x); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; }
    catch { return false; }
  };
  if (!v || v.user_id !== userId || (v.environment !== undefined && !['test','live'].includes(v.environment)) || !date(v.as_of) || typeof v.program?.enrollment_open !== 'boolean' ||
    !textOrNull(v.program?.terms_version) || !textOrNull(v.program?.terms_url) ||
    (v.program?.terms_url !== null && !termsUrl(v.program.terms_url)) ||
    (v.program.enrollment_open && (!v.program.terms_version?.trim() || !termsUrl(v.program.terms_url))) ||
    typeof v.provider?.id !== 'string' || !v.provider.id.trim() || typeof v.provider?.name !== 'string' || !v.provider.name.trim() ||
    typeof v.provider?.payouts_enabled !== 'boolean' || !Array.isArray(v.provider?.currencies) ||
    !v.provider.currencies.every(c => typeof c === 'string' && /^[A-Z]{3}$/.test(c)) ||
    !ENROLLMENTS.includes(v.enrollment?.status) || !textOrNull(v.enrollment?.reason) ||
    !['not_configured', 'pending', 'ready', 'restricted'].includes(v.payout_account?.status) ||
    !(v.payout_account.verified_at === null || date(v.payout_account.verified_at)) ||
    (v.payout_account.status === 'ready' && !date(v.payout_account.verified_at)) ||
    !Array.isArray(v.balances) || !v.balances.every(b => money(b) && BALANCE_BUCKETS.includes(b.bucket)) ||
    !Array.isArray(v.recent_earnings) || !v.recent_earnings.every(e => money(e, true) && typeof e.id === 'string' && !!e.id && date(e.created_at) && ['funding', ...BALANCE_BUCKETS].includes(e.from as BalanceBucket) && BALANCE_BUCKETS.includes(e.to)) ||
    !Array.isArray(v.recent_payouts) || !v.recent_payouts.every(p => money(p, true) && typeof p.id === 'string' && !!p.id && date(p.created_at) && PAYOUTS.includes(p.status) && typeof p.provider_id === 'string' && textOrNull(p.provider_reference))) {
    throw new Error('Your monetization status could not be confirmed. Please refresh.');
  }
  const keys = v.balances.map(b => `${b.currency}:${b.bucket}`);
  if (new Set(keys).size !== keys.length) throw new Error('Your earnings totals could not be confirmed. Please refresh.');
  return v;
}
export const ENROLLMENT_LABELS: Record<EnrollmentStatus, string> = {
  not_enrolled: 'Not enrolled', interested: 'Interest registered', applied: 'Application in review',
  approved: 'Approved', rejected: 'Application not approved', suspended: 'Monetization paused',
};
export const BALANCE_LABELS: Record<BalanceBucket, string> = {
  pending: 'Pending', available: 'Available', reserved: 'Payout in progress', paid: 'Paid', withheld: 'On hold', reversed: 'Reversed',
};
export const PAYOUT_LABELS: Record<PayoutStatus, string> = {
  requested: 'Requested', submitted: 'Submitted to provider', unknown: 'Awaiting provider confirmation', completed: 'Paid', rejected: 'Not sent',
};
export function earningActivityLabel(from: string, to: BalanceBucket): string {
  if (from === 'funding' && to === 'pending') return 'Earnings recorded';
  if (from === 'reserved' && to === 'available') return 'Payout funds returned';
  return ({ pending: 'Earnings pending', available: 'Earnings released', reserved: 'Payout requested', paid: 'Payout completed', withheld: 'Earnings placed on hold', reversed: 'Earnings reversed' })[to];
}
export function payoutBlockReason(snapshot: CreatorSnapshot): string | null {
  if (!snapshot.provider.payouts_enabled) return `${snapshot.provider.name} creator payouts are not available yet.`;
  if (snapshot.enrollment.status !== 'approved') return 'Creator approval is required before requesting a payout.';
  if (snapshot.payout_account.status !== 'ready') return 'Your payout account has not been approved for creator payments.';
  if (!snapshot.provider.currencies.includes('USD')) return 'USD creator payouts are not available.';
  return null;
}
