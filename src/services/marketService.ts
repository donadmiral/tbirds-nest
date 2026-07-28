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
async getMarketFeed(opts: { search?: string | null; category?: string | null; city?: string | null; limit?: number }): Promise<Listing[]> {
    const { data: ranked, error } = await supabase.rpc('get_market_feed', {
      p_category: opts.category || null,
      p_search: opts.search?.trim() || null,
      p_city: opts.city?.trim() || null,
      p_limit: opts.limit ?? 30,
      p_offset: 0,
    });
    if (error || !ranked?.length) return [];
    const ids = (ranked as any[]).map(r => r.id);
    const { data: rows } = await supabase
      .from('marketplace_listings')
      .select(`*, ${SELLER_SELECT}`)
      .in('id', ids);
    const byId: Record<string, any> = {};
    (rows || []).forEach((r: any) => { byId[r.id] = r; });
    return ids.map(id => byId[id]).filter(Boolean) as Listing[];
  },

  async listListings(opts?: {
    search?: string;
    category?: string | null;
    limit?: number;
    before?: string | null;
    minPrice?: number | null;
    maxPrice?: number | null;
    condition?: string | null;
    city?: string | null;
    sort?: 'recent' | 'price_low' | 'price_high';
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
    if (opts?.minPrice != null) q = q.gte('price', opts.minPrice);
    if (opts?.maxPrice != null) q = q.lte('price', opts.maxPrice);
    if (opts?.condition) q = q.eq('condition', opts.condition);
    if (opts?.city && opts.city.trim().length > 0) q = q.ilike('location_city', '%' + opts.city.trim() + '%');
    if (opts?.sort === 'price_low') q = q.order('price', { ascending: true });
    else if (opts?.sort === 'price_high') q = q.order('price', { ascending: false });

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

  async getSavedIds(): Promise<Set<string>> {
    const { data: me } = await supabase.auth.getUser();
    if (!me?.user) return new Set();
    const { data } = await supabase.from('saved_listings').select('listing_id').eq('user_id', me.user.id);
    return new Set((data || []).map((r: any) => r.listing_id));
  },

  async getSavedListings(): Promise<Listing[]> {
    const { data: me } = await supabase.auth.getUser();
    if (!me?.user) return [];
    const { data, error } = await supabase
      .from('saved_listings')
      .select(`listing:marketplace_listings(*, ${SELLER_SELECT})`)
      .eq('user_id', me.user.id)
      .order('created_at', { ascending: false });
    if (error) { console.log('[marketService.getSavedListings]', error.message); return []; }
    return (data || []).map((r: any) => r.listing).filter(Boolean);
  },

  async toggleSaved(listingId: string, on: boolean): Promise<void> {
    const { data: me } = await supabase.auth.getUser();
    if (!me?.user) return;
    if (on) await supabase.from('saved_listings').upsert({ user_id: me.user.id, listing_id: listingId });
    else await supabase.from('saved_listings').delete().eq('user_id', me.user.id).eq('listing_id', listingId);
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