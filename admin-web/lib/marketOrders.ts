export type MarketOrderSearch = Record<string, string | string[] | undefined>;
export const MARKET_ORDER_STATUSES = ['any', 'requested', 'awaiting_payment', 'paid', 'ready', 'in_transit', 'completed', 'cancelled', 'declined', 'return_requested', 'return_approved', 'returned', 'disputed'] as const;
export function marketOrderSearch(params: MarketOrderSearch) {
  const one = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const status = MARKET_ORDER_STATUSES.includes(one('status') as typeof MARKET_ORDER_STATUSES[number]) ? one('status') : 'any';
  const before = one('before'), id = one('id');
  const valid = /^\d{4}-\d\d-\d\dT/.test(before) && Number.isFinite(Date.parse(before)) && isOrderId(id);
  return { status, before: valid ? new Date(before).toISOString() : null, id: valid ? id : null };
}
export function isOrderId(id: string) { return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id); }
export function marketOrdersHref(status: string, cursor?: { created_at: string; id: string } | null) {
  return '/market/orders?' + new URLSearchParams({ status, ...(cursor ? { before: cursor.created_at, id: cursor.id } : {}) }).toString();
}
