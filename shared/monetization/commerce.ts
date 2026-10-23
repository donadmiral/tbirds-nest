import { validMinor } from './domain';
import { withFinanceDeadline } from './client';

export type CreatorProduct = { id: string; kind: 'subscription' | 'tip' | 'gift'; title: string; amount_minor: string; active: boolean; period_days: number | null };
export type CreatorCommerce = {
  user_id: string;
  capabilities: { environment: 'test' | 'live'; provider: 'intobank'; purchases_enabled: boolean; recurring_enabled: false; currency: 'USD'; reason: string };
  refund_balance_minor: string;
  products: CreatorProduct[];
  purchases: { id: string; title: string; kind: CreatorProduct['kind']; amount_minor: string; refunded_minor: string; state: string; created_at: string }[];
  subscriptions: { creator_id: string; starts_at: string; ends_at: string; auto_renew: false }[];
};
type Rpc = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };
const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const date = (x: unknown) => typeof x === 'string' && Number.isFinite(Date.parse(x));
const kinds = ['subscription', 'tip', 'gift'];
const title = (x: unknown) => typeof x === 'string' && !!x.trim() && x.length <= 120;
export function parseCreatorCommerce(value: unknown, owner: string): CreatorCommerce {
  const v = value as CreatorCommerce | null;
  if (!v || v.user_id !== owner || !uuid(v.user_id) || !validMinor(v.refund_balance_minor) ||
    !v.capabilities || !['test', 'live'].includes(v.capabilities.environment) || v.capabilities.provider !== 'intobank' || v.capabilities.currency !== 'USD' ||
    typeof v.capabilities.purchases_enabled !== 'boolean' || v.capabilities.recurring_enabled !== false ||
    typeof v.capabilities.reason !== 'string' || (v.capabilities.purchases_enabled && v.capabilities.environment !== 'test') ||
    !Array.isArray(v.products) || v.products.length > 100 || !v.products.every(p => uuid(p.id) && kinds.includes(p.kind) && title(p.title) && validMinor(p.amount_minor, true) &&
      typeof p.active === 'boolean' && (p.kind === 'subscription' ? Number.isInteger(p.period_days) && p.period_days! >= 1 && p.period_days! <= 366 : p.period_days === null)) ||
    !Array.isArray(v.purchases) || v.purchases.length > 50 || !v.purchases.every(p => uuid(p.id) && kinds.includes(p.kind) && title(p.title) && validMinor(p.amount_minor, true) &&
      validMinor(p.refunded_minor) && BigInt(p.refunded_minor) <= BigInt(p.amount_minor) && ['pending', 'paid', 'partially_refunded', 'refunded', 'cancelled'].includes(p.state) && date(p.created_at)) ||
    !Array.isArray(v.subscriptions) || !v.subscriptions.every(s => uuid(s.creator_id) && date(s.starts_at) && date(s.ends_at) && Date.parse(s.ends_at) > Date.parse(s.starts_at) && s.auto_renew === false)) {
    throw new Error('Your creator products and purchases could not be confirmed. Refresh to try again.');
  }
  if (new Set(v.products.map(p => p.id)).size !== v.products.length || new Set(v.purchases.map(p => p.id)).size !== v.purchases.length) throw new Error('Duplicate creator records could not be confirmed.');
  return v;
}
export async function readCreatorCommerce(client: Rpc, owner: string): Promise<CreatorCommerce> {
  const { data, error } = await withFinanceDeadline(client.rpc('creator_commerce_snapshot', { p_expected_user: owner }), 'Creator products took too long to load. Refresh to try again.');
  if (error) throw new Error('Creator products and purchases are unavailable. Refresh to try again.');
  return parseCreatorCommerce(data, owner);
}
export async function saveCreatorProduct(client: Rpc, owner: string, product: CreatorProduct): Promise<string> {
  if (!uuid(owner) || !uuid(product.id) || !kinds.includes(product.kind) || !title(product.title) || !validMinor(product.amount_minor, true) || BigInt(product.amount_minor) > BigInt(1000000) ||
    typeof product.active !== 'boolean' || (product.kind === 'subscription' ? !Number.isInteger(product.period_days) || product.period_days! < 1 || product.period_days! > 366 : product.period_days !== null)) throw new Error('Check the product name, price and access period.');
  const { data, error } = await withFinanceDeadline(client.rpc('creator_save_product', { p_expected_user: owner, p_id: product.id, p_kind: product.kind, p_title: product.title.trim(), p_amount_minor: product.amount_minor, p_period_days: product.period_days, p_active: product.active }), 'Your product change is unconfirmed. Refresh before retrying.');
  if (error || data !== product.id) throw new Error('Your product change could not be confirmed. Refresh before retrying.');
  return data;
}
