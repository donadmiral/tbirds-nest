import { supabase } from './supabase';

export type ListingCurrency = 'USD' | 'ZWG';
export type ListingStatus = 'available' | 'sold' | 'removed';

export type Listing = {
  id: string;
  seller_id: string;
  title: string;
  description: string | null;
  price: number;
  currency: ListingCurrency;
  category: string;
  condition: string | null;
  location_city: string | null;
  images: string[];
  status: ListingStatus;
  created_at: string;
  seller?: {
    id: string;
    full_name: string;
    username: string | null;
    avatar_url: string | null;
    is_verified: boolean;
  } | null;
};

export const MARKET_CATEGORIES = [
  'Electronics', 'Vehicles', 'Property', 'Fashion', 'Home',
  'Agriculture', 'Services', 'Jobs Gear', 'Beauty', 'Other',
] as const;

export const MARKET_CONDITIONS = ['New', 'Like New', 'Good', 'Fair'] as const;

const SELLER_SELECT = 'seller:profiles!marketplace_listings_seller_id_fkey(id, full_name, username, avatar_url, is_verified)';

export const marketService = {
  async listListings(opts?: {
    search?: string;
    category?: string | null;
    limit?: number;
    before?: string | null;
  }): Promise<Listing[]> {
    let q = supabase
      .from('marketplace_listings')
      .select(`*, ${SELLER_SELECT}`)
      .eq('status', 'available')
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 30);

    if (opts?.category) q = q.eq('category', opts.category);
    if (opts?.search && opts.search.trim().length > 0) {
      q = q.ilike('title', `%${opts.search.trim()}%`);
    }
    if (opts?.before) q = q.lt('created_at', opts.before);

    const { data, error } = await q;
    if (error) {
      console.log('[marketService.listListings]', error.message);
      return [];
    }
    return (data as any[]) ?? [];
  },

  async getListing(id: string): Promise<Listing | null> {
    const { data, error } = await supabase
      .from('marketplace_listings')
      .select(`*, ${SELLER_SELECT}`)
      .eq('id', id)
      .single();
    if (error) {
      console.log('[marketService.getListing]', error.message);
      return null;
    }
    return data as any;
  },

  async myListings(userId: string): Promise<Listing[]> {
    const { data, error } = await supabase
      .from('marketplace_listings')
      .select(`*, ${SELLER_SELECT}`)
      .eq('seller_id', userId)
      .neq('status', 'removed')
      .order('created_at', { ascending: false });
    if (error) {
      console.log('[marketService.myListings]', error.message);
      return [];
    }
    return (data as any[]) ?? [];
  },

  async createListing(input: {
    seller_id: string;
    title: string;
    description: string;
    price: number;
    currency: ListingCurrency;
    category: string;
    condition: string | null;
    location_city: string;
    images: string[];
  }): Promise<Listing> {
    const { data, error } = await supabase
      .from('marketplace_listings')
      .insert({
        seller_id: input.seller_id,
        title: input.title,
        description: input.description || null,
        price: input.price,
        currency: input.currency,
        category: input.category,
        condition: input.condition,
        location_city: input.location_city || null,
        images: input.images,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as any;
  },

  async setStatus(id: string, status: ListingStatus): Promise<void> {
    const { error } = await supabase
      .from('marketplace_listings')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
};