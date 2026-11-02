import { createKeyedBatchReader } from '../../shared/keyedBatchReader';
import type { PostMediaEditRecipe } from '../components/VideoPlayer';
import { createClient } from './supabase/client';
import { getNavigationStore } from './navigationCache';
import { hydratePostMedia } from './contentMedia';

type Profile = { full_name?: string | null; username?: string | null; avatar_url?: string | null; is_verified?: boolean | null; verified_tier?: string | null };
export type PostCollaborator = { user_id: string; profile?: Profile | Profile[] | null };
export type PostMediaTag = { media_id: string; user_id: string; nx: number; ny: number; profile?: Profile | Profile[] | null };
type MediaEdit = { id: string; post_id: string; edit: PostMediaEditRecipe | null };
type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

// A batch can contain several posts with many tags/collaborators. Page the
// result too, so the Data API's row cap never silently removes later posts.
async function pages<T>(query: (from: number, to: number) => PromiseLike<QueryResult<T>>, signal: AbortSignal) {
  const rows: T[] = [];
  for (let offset = 0; offset < 10_000; offset += 500) {
    if (signal.aborted) throw new Error('Metadata request cancelled.');
    const result = await query(offset, offset + 499);
    if (result.error) throw new Error(result.error.message);
    rows.push(...result.data ?? []);
    if ((result.data?.length ?? 0) < 500) return rows;
  }
  throw new Error('Metadata response exceeds the supported batch size.');
}

function createReaders() {
  const client = createClient(), session = getNavigationStore();
  const collaborators = createKeyedBatchReader<PostCollaborator[]>(async (ids, signal) => {
    const rows = await pages<PostCollaborator & { post_id: string }>((from, to) => client.from('post_collaborators')
      .select('post_id, user_id, profile:profiles!post_collaborators_user_id_fkey(username, full_name, is_verified, verified_tier)')
      .in('post_id', ids).eq('status', 'accepted').order('post_id').order('user_id').range(from, to).abortSignal(signal), signal);
    const result = new Map(ids.map(id => [id, [] as PostCollaborator[]]));
    rows.forEach(row => result.get(row.post_id)?.push(row));
    return result;
  });
  const edits = createKeyedBatchReader<PostMediaEditRecipe | null>(async (keys, signal) => {
    const requested = new Set(keys);
    const ids = [...new Set(keys.map(key => key.split('/')[1]))];
    const { data, error } = await client.from('post_media').select('id, post_id, edit').in('id', ids).abortSignal(signal);
    if (error) throw new Error(error.message);
    const grouped = new Map<string, { post_id: string; post_media: MediaEdit[] }>();
    for (const row of (data ?? []) as MediaEdit[]) {
      if (!requested.has(row.post_id + '/' + row.id)) continue;
      if (!grouped.has(row.post_id)) grouped.set(row.post_id, { post_id: row.post_id, post_media: [] });
      grouped.get(row.post_id)!.post_media.push(row);
    }
    // Authorize private cover/soundtrack URLs for the whole batch together.
    if (signal.aborted) throw new Error('Metadata request cancelled.');
    const granted = grouped.size ? await hydratePostMedia([...grouped.values()], client, signal) : [];
    if (signal.aborted) throw new Error('Metadata request cancelled.');
    const result = new Map<string, PostMediaEditRecipe | null>(keys.map(key => [key, null]));
    granted.forEach(post => post.post_media.forEach(row => result.set(post.post_id + '/' + row.id, row.edit ?? null)));
    return result;
  });
  const tags = createKeyedBatchReader<PostMediaTag[]>(async (ids, signal) => {
    const rows = await pages<PostMediaTag>((from, to) => client.from('post_media_tags')
      .select('media_id, user_id, nx, ny, profile:profiles!post_media_tags_user_id_fkey(full_name, username, avatar_url, verified_tier)')
      .in('media_id', ids).order('media_id').order('user_id').range(from, to).abortSignal(signal), signal);
    const result = new Map(ids.map(id => [id, [] as PostMediaTag[]]));
    rows.forEach(row => result.get(row.media_id)?.push(row));
    return result;
  });
  const polls = createKeyedBatchReader<boolean>(async (ids, signal) => {
    const { data, error } = await client.from('post_polls').select('post_id').in('post_id', ids).abortSignal(signal);
    if (error) throw new Error(error.message);
    const found = new Set((data ?? []).map(row => String(row.post_id)));
    return new Map(ids.map(id => [id, found.has(id)]));
  });
  const readers = [collaborators, edits, tags, polls];
  const listeners = new Set<() => void>();
  let scope = '';
  const sync = () => {
    const next = session.getSnapshot();
    const identity = `${next.revision}:${next.scope ?? 'anonymous'}`;
    if (scope === identity) return;
    scope = identity;
    readers.forEach(reader => reader.setScope(scope));
    listeners.forEach(listener => listener());
  };
  sync();
  session.subscribe(sync);
  return { collaborators, edits, tags, polls,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

let browserReaders: ReturnType<typeof createReaders> | null = null;
function readers() {
  if (typeof window === 'undefined') throw new Error('Post metadata is read in the browser.');
  return browserReaders ??= createReaders();
}

export const readPostCollaborators = (postId: string) => readers().collaborators.read(postId);
export const readPostPollFlag = (postId: string) => readers().polls.read(postId);
export const subscribePostMetadataSession = (listener: () => void) => readers().subscribe(listener);
export async function readPostMediaEdits(postId: string, ids: string[]) {
  const values = await Promise.all(ids.map(id => readers().edits.read(postId + '/' + id)));
  return Object.fromEntries(ids.map((id, index) => [id, values[index]]));
}
export async function readPostMediaTags(ids: string[]) {
  const values = await Promise.all(ids.map(id => readers().tags.read(id)));
  return values.flat();
}
