import { CONTENT_UUID, hydrateContentMedia } from '../../shared/contentMedia';
import { navigationScope, subscribeNavigationScope } from '../lib/navigationCache';
import { useAuthStore } from '../stores/authStore';
import { supabase, SUPABASE_URL } from './supabase';

export type ProfilePostCursor = { createdAt: string; id: string };
export type ProfileContentReader = {
  read: <T>(query: any) => Promise<T>;
  posts: (configure: (query: any) => any) => Promise<any[]>;
  retained: (ids: string[]) => Promise<any[]>;
  sign: <T>(rows: T[]) => Promise<T[]>;
  check: () => void;
};

/** A complete profile read is pinned to one session, including later media batches. */
export async function profileContentRead<T>(ownerId: string, scope: string | null, parent: AbortSignal, work: (reader: ProfileContentReader) => Promise<T>): Promise<T> {
  const session = useAuthStore.getState().session;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const unsubscribe = subscribeNavigationScope(() => { if (navigationScope() !== scope) cancel(); });
  parent.addEventListener('abort', cancel, { once: true });
  const check = () => {
    if (!scope || !session?.access_token || session.user.id !== ownerId || controller.signal.aborted || navigationScope() !== scope) {
      throw new Error('Your account changed or the profile request was cancelled.');
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted: (() => void) | undefined;
  try {
    if (parent.aborted) cancel();
    check();
    const token = session!.access_token;
    const read = async <R,>(query: any): Promise<R> => {
      check();
      const result = await query.setHeader('Authorization', `Bearer ${token}`).abortSignal(controller.signal);
      check();
      if (result.error) throw result.error;
      return result.data as R;
    };
    const posts = async (configure: (query: any) => any): Promise<any[]> => {
      let result: any[];
      try { result = await read(configure(supabase.from('posts').select('*, post_media(id, url, media_type, width, height, sort_order, edit)'))); }
      catch (error: any) {
        if (!['PGRST200', 'PGRST204', '42703', '42P01'].includes(error?.code)) throw error;
        result = await read(configure(supabase.from('posts').select('*')));
      }
      if (!Array.isArray(result) || result.some(row => !row || typeof row.id !== 'string')) throw new Error('The profile posts could not be verified. Please retry.');
      return result;
    };
    const reader: ProfileContentReader = {
      read, posts, check,
      async retained(ids) {
        if (ids.some(id => typeof id !== 'string' || !id || id.length > 120)) throw new Error('The retained profile posts could not be verified. Please retry.');
        const unique = [...new Set(ids)], rows: any[] = [];
        for (let index = 0; index < unique.length; index += 200) {
          check();
          const batches = [unique.slice(index, index + 100), unique.slice(index + 100, index + 200)].filter(batch => batch.length);
          const values = await Promise.all(batches.map(batch => posts(query => query.in('id', batch))));
          check(); rows.push(...values.flat().filter(row => !row.archived_at));
        }
        return rows;
      },
      async sign(rows) {
        check();
        const signed = await hydrateContentMedia({
          auth: {
            async getSession() { check(); return { data: { session: session! }, error: null }; },
            async getUser() { check(); const result = await supabase.auth.getUser(token); check(); return result; },
          },
          functions: {
            async invoke(name, options) {
              check();
              const result = await supabase.functions.invoke(name, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` }, signal: controller.signal });
              check(); return result;
            },
          },
        }, SUPABASE_URL, rows, 'post');
        check(); return signed;
      },
    };
    const cancelled = new Promise<never>((_, reject) => {
      aborted = () => reject(new Error('The profile request was cancelled.'));
      controller.signal.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(() => { reject(new Error('Profile content took too long to load. Please retry.')); cancel(); }, 25_000);
    });
    const result = await Promise.race([Promise.resolve().then(() => { check(); return work(reader); }), cancelled]);
    check(); return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (aborted) controller.signal.removeEventListener('abort', aborted);
    parent.removeEventListener('abort', cancel);
    unsubscribe(); cancel();
  }
}

/** Pagination follows scanned own rows, independently of collaborators and pin order. */
export function profilePostCursor(rows: any[]): ProfilePostCursor | null {
  if (rows.length < 50) return null;
  const last = rows[rows.length - 1];
  if (!CONTENT_UUID.test(last?.id || '') || typeof last?.created_at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(last.created_at)
    || !Number.isFinite(Date.parse(last.created_at))) {
    throw new Error('The next profile page could not be verified. Please retry.');
  }
  return { id: last.id, createdAt: last.created_at };
}

/** Keep a visible page anchored while replacing only currently authorized rows. */
export function mergeProfilePosts(previous: any[], fresh: any[], retained: any[], preserveOrder: boolean): any[] {
  if (!previous.length) return fresh;
  const allowed = new Map(retained.map(row => [row.id, row]));
  fresh.forEach(row => { if (allowed.has(row.id)) allowed.set(row.id, row); });
  const known = previous.map(row => allowed.get(row.id)).filter(Boolean);
  if (!known.length) return fresh;
  return preserveOrder ? known : [...new Map([...fresh, ...known].map(row => [row.id, row])).values()];
}
