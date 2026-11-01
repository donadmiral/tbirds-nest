/** Synthetic service adapter only. No credentials or hosted requests. */
import { replaceContentMedia, contentMediaUrls, contentObject } from '../../../shared/contentMedia';
import { reuseFeedMediaGrants } from '../../../shared/feedMediaReuse';
const listeners = new Set<(event: string, session: typeof sessionState) => void>();
let sessionState = { user: { id: 'fixture-a' }, access_token: 'fixture-a:1' };
let authorResolvers: Array<() => void> = [];
let grantResolvers: Array<() => void> = [];
let slowAuthor = true, slowGrant = true;
export const original = (name: string) => location.origin + '/storage/v1/object/public/post-media/' + name;
export const granted = (name: string, token = 'a') => location.origin + '/functions/v1/media-content/post-media/' + name + '?token=' + token.repeat(64);
const sourceRow = (id: string) => ({ id, user_id: 'author-' + id, content: 'Authorized source ' + id, body: null,
  created_at: '2026-11-01T12:00:00Z', post_media: [{ url: original(id + '.mp4'), media_type: 'video/mp4', sort_order: 0, edit: { coverUrl: original(id + '.svg') } }] });
const client = {
  auth: {
    getSession: async () => ({ data: { session: sessionState }, error: null }),
    onAuthStateChange(fn: (event: string, session: typeof sessionState) => void) { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
  },
  from(table: string) {
    let id = '';
    const query = { select() { return query; }, eq(_key: string, value: string) { id = value; return query; },
      maybeSingle: async () => {
        if (table === 'profiles' && slowAuthor) await new Promise<void>(resolve => authorResolvers.push(resolve));
        return { data: table === 'posts' ? sourceRow(id) : { full_name: 'Author ' + id, username: id }, error: null };
      } };
    return query;
  },
  rpc: async () => ({ data: null, error: null }),
};
export const createClient = () => client;
export const withoutPrivateMedia = <T,>(rows: T[]) => replaceContentMedia(rows, location.origin, new Map());
export async function hydratePostMedia<T>(rows: T[]): Promise<T[]> {
  if (slowGrant) await new Promise<void>(resolve => grantResolvers.push(resolve));
  const grants = new Map(contentMediaUrls(rows, location.origin).map(url => {
    const object = contentObject(url, location.origin)!;
    return [object.key, granted(object.path, 'b')];
  }));
  return replaceContentMedia(rows, location.origin, grants);
}
export function retainFeedMedia(current: any[], incoming: any[], previous: string | null, next: string | null) {
  const adapt = (row: any) => ({ ...row, id: row.post_id, user_id: row.author_id });
  return reuseFeedMediaGrants(current.map(adapt), incoming.map(adapt), location.origin, previous, next);
}
export const service = {
  grant() { slowGrant = false; grantResolvers.splice(0).forEach(fn => fn()); },
  authors() { slowAuthor = false; authorResolvers.splice(0).forEach(fn => fn()); },
  hold() { slowGrant = true; slowAuthor = true; },
  session(owner: string, generation: number) { sessionState = { user: { id: owner }, access_token: owner + ':' + generation }; listeners.forEach(fn => fn('SIGNED_IN', sessionState)); },
};
