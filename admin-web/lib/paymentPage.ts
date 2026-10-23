export type PaymentSearch = Record<string, string | string[] | undefined>;
export const PAYMENT_STATUSES = ['all', 'completed', 'failed', 'in_flight', 'pending', 'processing', 'refunded', 'cancelled', 'marketplace', 'direct'] as const;
export function paymentSearch(params: PaymentSearch) {
  const one = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const status = PAYMENT_STATUSES.includes(one('status') as typeof PAYMENT_STATUSES[number]) ? one('status') : 'all';
  const q = one('q').trim().slice(0, 100);
  const before = one('before'), id = one('id');
  const validCursor = /^\d{4}-\d\d-\d\dT/.test(before) && Number.isFinite(Date.parse(before)) && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
  return { status, q, before: validCursor ? new Date(before).toISOString() : null, id: validCursor ? id : null };
}
export function paymentHref(status: string, q: string, cursor?: { created_at: string; id: string } | null) {
  const params = new URLSearchParams({ status, ...(q ? { q } : {}), ...(cursor ? { before: cursor.created_at, id: cursor.id } : {}) });
  return '/payments?' + params.toString();
}
export function paymentDecimal(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error('Invalid payment amount');
  const digits = (match[3] ?? '').padEnd(2, '0');
  if (digits.slice(2).replace(/0/g, '')) throw new Error('Unsupported payment precision');
  return match[1] + match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + digits.slice(0, 2);
}
export function paymentVolumes(rows: { currency: string; amount: string; average?: string }[], average = false) {
  return rows.length ? rows.map(row => row.currency + ' ' + paymentDecimal(average ? row.average ?? '0' : row.amount)).join(' · ') : 'No completed transfers';
}
