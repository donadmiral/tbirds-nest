import { navigationScope, subscribeNavigationScope } from '../lib/navigationCache';
import { useAuthStore } from '../stores/authStore';
import type { Listing } from './marketService';
import { supabase } from './supabase';

export const MARKET_PAGE_SIZE = 30;
const SELLER = 'seller:profiles!marketplace_listings_seller_id_fkey(id, full_name, username, avatar_url, is_verified)';
type Pin = (query: any) => any;

/** Reading stays in the signed-in person's context, including when the author actor changes. */
function transport(scope: string | null, signal: AbortSignal) {
  const session = useAuthStore.getState().session;
  if (!scope || navigationScope() !== scope || !session?.user.id || !session.access_token) throw new Error('Sign in to load this directory.');
  const ownerId = session.user.id, token = session.access_token;
  const check = () => {
    if (signal.aborted || navigationScope() !== scope) throw new Error('The account changed or the request was cancelled.');
  };
  const pin: Pin = query => { check(); return query.setHeader('Authorization', `Bearer ${token}`).abortSignal(signal); };
  return { ownerId, pin, check };
}

function rows(result: any, field = 'id'): any[] {
  if (result.error) throw result.error;
  if (!Array.isArray(result.data) || result.data.some((row: any) => !row || typeof row[field] !== 'string')) throw new Error('The directory response could not be verified.');
  return result.data;
}

export type MarketSelection = {
  tab: 'browse' | 'saved' | 'selling'; search: string; category: string | null; homeCity: string | null;
  filters: { minPrice: string; maxPrice: string; condition: string | null; city: string; sort: 'recent' | 'price_low' | 'price_high' };
};
export type MarketDirectoryView = { rows: Listing[]; savedIds: string[]; offset: number; hasMore: boolean; top: number; ready: boolean };
export type MarketDirectoryPage = { rows: Listing[]; savedIds: string[] | null; nextOffset: number; hasMore: boolean; retained: Listing[] };
export const emptyMarketDirectory = (): MarketDirectoryView => ({ rows: [], savedIds: [], offset: 0, hasMore: false, top: 0, ready: false });
export function marketDirectoryKey(selection: MarketSelection) {
  return 'market:view:' + JSON.stringify([selection.tab, selection.search.trim(), selection.category, selection.homeCity,
    selection.filters.minPrice, selection.filters.maxPrice, selection.filters.condition, selection.filters.city.trim(), selection.filters.sort]);
}
function ranked(selection: MarketSelection) {
  const f = selection.filters;
  return !f.minPrice && !f.maxPrice && !f.condition && !f.city.trim() && f.sort === 'recent';
}
function filters(query: any, selection: MarketSelection) {
  const f = selection.filters;
  let q = query.eq('status', 'available').is('hidden_at', null);
  if (selection.category && selection.category !== 'All') q = q.eq('category', selection.category);
  if (f.minPrice) q = q.gte('price', Number(f.minPrice));
  if (f.maxPrice) q = q.lte('price', Number(f.maxPrice));
  if (f.condition) q = q.eq('condition', f.condition);
  if (f.city.trim()) q = q.ilike('location_city', '%' + f.city.trim() + '%');
  return q;
}
function searchMatches(row: Listing, selection: MarketSelection) {
  // Match the existing SQL ILIKE wildcards without interpolating a PostgREST OR expression.
  const pattern = selection.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  const match = new RegExp(pattern, 'iu');
  return match.test(row.title) || (ranked(selection) && match.test(row.description || ''));
}

/** One deadline covers every stage. Retained pages are rechecked in bounded RLS-filtered batches. */
export async function readMarketDirectory(scope: string | null, selection: MarketSelection, offset: number, retainedIds: string[], includeSaved: boolean, signal: AbortSignal): Promise<MarketDirectoryPage> {
  return directoryRequest(scope, signal, async signal => {
  const { pin, check, ownerId } = transport(scope, signal);
  const saved = includeSaved ? Promise.resolve(pin(supabase.from('saved_listings').select('listing_id').eq('user_id', ownerId))).then(result => rows(result, 'listing_id').map(row => row.listing_id)) : Promise.resolve(null);
  const listings = (async () => {
    if (selection.tab === 'saved') {
      const result = await pin(supabase.from('saved_listings').select(`listing_id, listing:marketplace_listings(*, ${SELLER})`).eq('user_id', ownerId).order('created_at', { ascending: false }));
      return { rows: rows(result, 'listing_id').map(row => row.listing).filter((row: Listing | null) => row?.id && row.status !== 'removed'), nextOffset: 0, hasMore: false, retained: [] };
    }
    if (selection.tab === 'selling') {
      const result = await pin(supabase.from('marketplace_listings').select(`*, ${SELLER}`).eq('seller_id', ownerId).neq('status', 'removed').order('created_at', { ascending: false }));
      return { rows: rows(result), nextOffset: 0, hasMore: false, retained: [] };
    }
    let fresh: Listing[], consumed: number, hasMore: boolean;
    const visible = new Map<string, Listing>();
    if (ranked(selection)) {
      const result = await pin(supabase.rpc('get_market_feed', { p_category: selection.category && selection.category !== 'All' ? selection.category : null,
        p_search: selection.search.trim() || null, p_city: selection.homeCity?.trim() || null, p_limit: MARKET_PAGE_SIZE + 1, p_offset: offset }));
      const rankedRows = rows(result), ids = rankedRows.slice(0, MARKET_PAGE_SIZE).map(row => row.id);
      consumed = Math.min(MARKET_PAGE_SIZE, rankedRows.length); hasMore = rankedRows.length > MARKET_PAGE_SIZE;
      const hydrateIds = [...new Set([...ids, ...retainedIds])];
      // Two requests at a time; the outer navigation deadline aborts all stages and stops further batches.
      for (let i = 0; i < hydrateIds.length; i += 200) {
        check();
        const batches = [hydrateIds.slice(i, i + 100), hydrateIds.slice(i + 100, i + 200)].filter(batch => batch.length);
        const results = await Promise.all(batches.map(batch => pin(filters(supabase.from('marketplace_listings').select(`*, ${SELLER}`).in('id', batch), selection))));
        check();
        results.forEach(result => rows(result).forEach((row: Listing) => { if (searchMatches(row, selection)) visible.set(row.id, row); }));
      }
      fresh = ids.map(id => visible.get(id)).filter((row): row is Listing => !!row);
    } else {
      let query = filters(supabase.from('marketplace_listings').select(`*, ${SELLER}`), selection);
      if (selection.search.trim()) query = query.ilike('title', '%' + selection.search.trim() + '%');
      if (selection.filters.sort === 'price_low') query = query.order('price', { ascending: true });
      if (selection.filters.sort === 'price_high') query = query.order('price', { ascending: false });
      const result = await pin(query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + MARKET_PAGE_SIZE));
      const page = rows(result); fresh = page.slice(0, MARKET_PAGE_SIZE); consumed = fresh.length; hasMore = page.length > MARKET_PAGE_SIZE;
      for (let i = 0; i < retainedIds.length; i += 200) {
        check();
        const batches = [retainedIds.slice(i, i + 100), retainedIds.slice(i + 100, i + 200)].filter(batch => batch.length);
        const results = await Promise.all(batches.map(batch => pin(filters(supabase.from('marketplace_listings').select(`*, ${SELLER}`).in('id', batch), selection))));
        check();
        results.forEach(result => rows(result).forEach((row: Listing) => { if (searchMatches(row, selection)) visible.set(row.id, row); }));
      }
      fresh.forEach(row => visible.set(row.id, row));
    }
    return { rows: fresh, nextOffset: offset + consumed, hasMore, retained: retainedIds.map(id => visible.get(id)).filter((row): row is Listing => !!row) };
  })();
  const [page, savedIds] = await Promise.all([listings, saved]);
  check(); return { ...page, savedIds };
  });
}

export function mergeMarketDirectory(previous: MarketDirectoryView, page: MarketDirectoryPage, append: boolean, preserve: boolean): MarketDirectoryView {
  const savedIds = page.savedIds ?? previous.savedIds;
  if (append) return { ...previous, rows: [...new Map([...previous.rows, ...page.rows].map(row => [row.id, row])).values()], savedIds, offset: page.nextOffset, hasMore: page.hasMore, ready: true };
  if (preserve && previous.ready && (previous.top > 0 || previous.offset > MARKET_PAGE_SIZE)) {
    const retained = new Map(page.retained.map(row => [row.id, row]));
    page.rows.forEach(row => { if (retained.has(row.id)) retained.set(row.id, row); });
    const known = previous.rows.map(row => retained.get(row.id)).filter((row): row is Listing => !!row);
    if (!known.length) return { rows: page.rows, savedIds, offset: page.nextOffset, hasMore: page.hasMore, top: 0, ready: true };
    const next = previous.top > 0 ? known : [...new Map([...page.rows, ...known].map(row => [row.id, row])).values()];
    return { rows: next, savedIds, offset: Math.max(previous.offset, page.nextOffset), hasMore: previous.hasMore, top: known.length ? previous.top : 0, ready: true };
  }
  return { rows: page.rows, savedIds, offset: page.nextOffset, hasMore: page.hasMore, top: previous.top, ready: true };
}

export type ChannelDirectoryTab = 'channels' | 'communities';
export type ChannelDirectoryView = { rows: any[]; top: number; ready: boolean };
export const emptyChannelDirectory = (): ChannelDirectoryView => ({ rows: [], top: 0, ready: false });
export const channelDirectoryKey = (tab: ChannelDirectoryTab, query: string) => 'channels:view:' + JSON.stringify([tab, query.trim()]);
export async function readChannelDirectory(scope: string | null, tab: ChannelDirectoryTab, query: string, signal: AbortSignal): Promise<any[]> {
  return directoryRequest(scope, signal, async signal => {
  const { pin, check } = transport(scope, signal);
  if (tab === 'channels') { const result = await pin(supabase.rpc('get_channels', { p_query: query.trim() || null, p_limit: 40 })); check(); return rows(result); }
  const [directory, invitations] = await Promise.all([
    pin(supabase.rpc('get_communities', { p_query: query.trim() || null, p_limit: 40 })), pin(supabase.rpc('get_my_community_invites')),
  ]);
  check();
  const inviteRows = rows(invitations), invited = new Set(inviteRows.map(row => row.id));
  const base = rows(directory).map(row => ({ ...row, has_invite: invited.has(row.id) }));
  const baseIds = new Set(base.map(row => row.id));
  const extra = inviteRows.filter(row => !baseIds.has(row.id)).map(row => ({ id: row.id, name: row.name, icon_url: row.icon_url, cover_color: row.cover_color,
    member_count: row.member_count, join_mode: 'invite', is_member: false, has_pending: false, has_invite: true,
    description: 'Invited by ' + (row.invited_by_name || row.invited_by_username || 'a moderator') }));
  return [...extra, ...base].sort((a, b) => Number(b.has_invite) - Number(a.has_invite));
  });
}

/** A single deadline includes every secondary request; cancellation prevents further dispatch. */
async function directoryRequest<T>(scope: string | null, parent: AbortSignal | undefined, work: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  const unsubscribe = subscribeNavigationScope(() => { if (navigationScope() !== scope) controller.abort(); });
  const cancel = () => controller.abort();
  parent?.addEventListener('abort', cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
  try {
    if (parent?.aborted) controller.abort();
    const { check } = transport(scope, controller.signal); check();
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('The account changed or the request was cancelled.'));
      controller.signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => { reject(new Error('The change could not be confirmed. Refresh before retrying.')); controller.abort(); }, 12_000);
    });
    const result = await Promise.race([Promise.resolve().then(() => { check(); return work(controller.signal); }), cancelled]);
    check(); return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) controller.signal.removeEventListener('abort', abort);
    parent?.removeEventListener('abort', cancel);
    controller.abort();
    unsubscribe();
  }
}

/** Mutations are never cached, and their transport uses the same owner/session boundary as reads. */
export async function mutateDirectory<T>(scope: string | null, work: (pin: Pin, ownerId: string) => PromiseLike<{ data: T; error: any }>): Promise<T> {
  return directoryRequest(scope, undefined, async signal => {
    const { pin, check, ownerId } = transport(scope, signal);
    const result = await work(pin, ownerId); check();
    if (result.error) throw result.error;
    return result.data;
  });
}
