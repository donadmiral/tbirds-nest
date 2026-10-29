export type MarketplaceRecommendation = {
  id: string;
  title: string;
  price: number | string;
  currency: string;
  image_url: string;
  location_city: string | null;
  seller_id: string;
  seller_name: string;
  seller_verified: boolean;
  rating: number | string | null;
  review_count: number;
  completed_sales: number;
};

/** Marketplace cards belong in their own shelf, including restored feed pages. */
export function isMarketplacePost(row: { products?: unknown }): boolean {
  return Array.isArray(row.products) && row.products.some(product =>
    product && typeof product === 'object' &&
    (typeof product.listing_id === 'string' && product.listing_id.length > 0 ||
      typeof product.link_url === 'string' && /^\/market\/[0-9a-f-]+(?:[?#]|$)/i.test(product.link_url)));
}

export const MARKETPLACE_SHELF_AFTER = 6;

export function marketplacePrice(item: Pick<MarketplaceRecommendation, 'price' | 'currency'>): string {
  const value = Number(item.price);
  if (!Number.isFinite(value) || value < 0) return 'View price';
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: item.currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${item.currency} ${value.toFixed(2)}`; }
}

export function marketplaceReputation(item: Pick<MarketplaceRecommendation, 'rating' | 'review_count' | 'seller_verified'>): string {
  const count = Number(item.review_count);
  const rating = Number(item.rating);
  if (count > 0 && Number.isFinite(rating) && rating >= 1 && rating <= 5) return `${rating.toFixed(1)} (${count})`;
  return item.seller_verified ? 'Verified seller' : 'New seller';
}

type Result = { data: unknown; error: { message: string } | null };
type Query = PromiseLike<Result> & { abortSignal?: (signal: AbortSignal) => Query };
export async function readMarketplaceRecommendations(client: { rpc: (name: string, args: Record<string, unknown>) => Query }, signal: AbortSignal): Promise<MarketplaceRecommendation[]> {
  let query = client.rpc('home_marketplace_recommendations', { p_limit: 8 });
  if (query.abortSignal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw new Error('Marketplace suggestions could not load.');
  if (!Array.isArray(data)) throw new Error('Marketplace suggestions are unavailable.');
  return data.filter((item): item is MarketplaceRecommendation => !!item && typeof item === 'object' &&
    typeof item.id === 'string' && typeof item.title === 'string' && typeof item.image_url === 'string' &&
    /^https:\/\//i.test(item.image_url) && Number.isFinite(Number(item.price)) && Number(item.price) >= 0).slice(0, 8);
}
