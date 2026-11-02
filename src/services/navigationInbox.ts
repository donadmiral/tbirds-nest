import { conversationUnreadCounts } from '../../shared/messageReceipts';
import { navigationCache, navigationScope } from '../lib/navigationCache';
import { useAuthStore } from '../stores/authStore';
import { supabase } from './supabase';
import { isChatMediaUrl, signGroupAvatars } from './chatMediaService';
import { readInboxPage, type InboxReadOptions, type ReaderScope } from '../../shared/pagedReaders';
import { appendInboxWindow, readInboxIds, refreshInboxWindow, type InboxPaging, type InboxWindow } from '../../shared/inboxWindow';

export type Conversation = {
  id: string;
  other_user_id: string;
  other_name: string;
  other_username: string | null;
  other_avatar: string | null;
  last_message: string;
  last_message_time: string | null;
  unread_count: number;
  is_group: boolean;
  group_emoji?: string | null;
  group_avatar_url?: string | null;
  group_type?: string | null;
  group_ref_id?: string | null;
  request_pending?: boolean;
  is_pinned: boolean;
  is_muted: boolean;
  is_archived: boolean;
  context?: string;
  manually_unread?: boolean;
  other_is_verified?: boolean;
  other_verified_tier?: string | null;
  last_sender_id?: string | null;
  last_sender_name?: string | null;
};
export type InboxPreview = { id: string; last_message?: string | null; last_message_time?: string | null;
  last_sender_id?: string | null; last_sender_name?: string | null };
function previewStamp(value?: string | null) {
  // Postgres JSON and Realtime may spell the same UTC instant differently.
  // Retain all six fractional digits; millisecond truncation can confuse two
  // different senders in a busy conversation.
  const match = value?.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(?:Z|\+00(?::?00)?)$/);
  return match ? `${match[1]}.${(match[2] ?? '').padEnd(6, '0')}` : value ?? '';
}
export function preserveNavigationInboxPreviews(rows: Conversation[], previous: Conversation[], hints: Map<string, InboxPreview>) {
  const old = new Map(previous.map(row => [row.id, row]));
  return rows.map(row => {
    const candidate = [hints.get(row.id), old.get(row.id)].find(value => value
      && (value.last_sender_id !== undefined || value.last_sender_name !== undefined)
      && (value.last_message || '') === row.last_message
      && previewStamp(value.last_message_time) === previewStamp(row.last_message_time));
    return candidate ? { ...row, last_sender_id: candidate.last_sender_id, last_sender_name: candidate.last_sender_name } : row;
  });
}

type InboxAvatar = { id: string; url: string | null };
const avatarListeners = new Set<(scope: string, avatars: InboxAvatar[]) => void>();
const avatarJobs = new WeakSet<Promise<unknown>>();
let avatarVersion = 0;
let avatarScope: string | null = null;
const avatarVersions = new Map<string, number>();
type GroupAvatar = { id: string; group_avatar_url: string | null };

export function nativeInboxOptions(search = '', filter: 'all' | 'groups' | 'unread' = 'all', archived = false): InboxReadOptions {
  return { context: 'personal', order: 'pinned', folder: archived ? 'archived' : 'active', groups: true,
    deleted: false, search, searchMode: 'native', filter, excludeCommunity: true, excludeRequests: true };
}
export function matchesNativeInbox(row: Conversation, options: InboxReadOptions): boolean {
  if ((row.context || 'personal') !== 'personal') return false;
  if (options.folder === 'archived') return row.is_archived;
  if (row.is_archived || row.group_type === 'community' || row.request_pending) return false;
  return (!(options.search ?? '') || row.other_name.toLowerCase().includes(options.search!.toLowerCase()))
    && (options.filter === 'groups' ? row.is_group : options.filter === 'unread' ? row.unread_count > 0 : true);
}
export const compareNativeInbox = (a: Conversation, b: Conversation) =>
  Number(b.is_pinned) - Number(a.is_pinned)
    || new Date(b.last_message_time ?? 0).getTime() - new Date(a.last_message_time ?? 0).getTime()
    || b.id.localeCompare(a.id);

function rememberAvatarVersion(scope: string, rows: { id: string }[], version: number) {
  if (avatarScope !== scope) { avatarScope = scope; avatarVersions.clear(); }
  for (const row of rows) avatarVersions.set(row.id, Math.max(version, avatarVersions.get(row.id) ?? 0));
}
function enrichAvatars(work: Promise<unknown>, scope: string, groups: () => GroupAvatar[], version: () => number) {
  if (avatarJobs.has(work)) return;
  avatarJobs.add(work);
  void work.then(async () => {
    if (navigationScope() !== scope) return;
    const pending = groups().filter(row => avatarVersions.get(row.id) === version());
    if (!pending.length) return;
    const signed = await signGroupAvatars(pending);
    if (navigationScope() !== scope) return;
    const avatars = signed.filter(row => avatarVersions.get(row.id) === version())
      .map(row => ({ id: row.id, url: row.group_avatar_url || null }));
    if (!avatars.length) return;
    const cached = navigationCache.read<Conversation[]>(scope, 'inbox:personal');
    if (cached) navigationCache.save(scope, 'inbox:personal', applyNavigationInboxAvatars(cached, avatars));
    avatarListeners.forEach(listener => listener(scope, avatars));
  }).catch(() => { /* Initials remain usable when a private photo cannot load. */ });
}

type InboxWire = { id: string; is_group: boolean; other_id: string | null; title: string; username: string | null;
  avatar: string | null; last_message: string; last_message_time: string | null; unread: number; context: string;
  group_emoji?: string | null; group_type?: string | null; group_ref_id?: string | null; request_pending?: boolean;
  is_pinned: boolean; is_muted: boolean; is_archived: boolean; manually_unread?: boolean;
  other_is_verified?: boolean; other_verified_tier?: string | null };
function nativePageReader(readerScope: ReaderScope, scope: string, version: number, groups: Map<string, GroupAvatar>) {
  return async (options: InboxReadOptions) => {
    const page = await readInboxPage<InboxWire>(supabase, readerScope, options);
    if (!page) return null;
    rememberAvatarVersion(scope, page.items, version);
    const items: Conversation[] = page.items.map(row => {
      const privatePhoto = row.is_group && isChatMediaUrl(row.avatar);
      if (privatePhoto) groups.set(row.id, { id: row.id, group_avatar_url: row.avatar });
      const avatar = privatePhoto ? null : row.avatar;
      return { ...row, other_user_id: row.other_id || '', other_name: row.title, other_username: row.username,
        other_avatar: avatar, group_avatar_url: row.is_group ? avatar : null, unread_count: row.unread };
    });
    return { ...page, items };
  };
}

function nativeReaderScope(userId: string, signal?: AbortSignal, current?: () => boolean) {
  const scope = navigationScope(), session = useAuthStore.getState().session;
  if (!scope || session?.user.id !== userId) throw new Error('Sign in to load conversations.');
  return { scope, reader: { viewer: userId, token: session.access_token, signal,
    current: () => navigationScope() === scope && current?.() !== false } satisfies ReaderScope };
}

export function readNavigationInboxWindow(userId: string, options: InboxReadOptions,
  previous: InboxWindow<Conversation> | null = null, continuation = false, signal?: AbortSignal, current?: () => boolean): Promise<InboxWindow<Conversation>> {
  const { scope, reader } = nativeReaderScope(userId, signal, current), version = ++avatarVersion;
  const groups = new Map<string, GroupAvatar>(), read = nativePageReader(reader, scope, version, groups);
  const work = (async () => {
    const result = continuation && previous
      ? await appendInboxWindow(read, options, previous, row => matchesNativeInbox(row, options), compareNativeInbox)
      : await refreshInboxWindow(read, options, previous, row => matchesNativeInbox(row, options), compareNativeInbox);
    if (result) return result;
    const items = await refreshNavigationInbox(userId);
    if (signal?.aborted || !reader.current()) throw new Error('The conversation reader changed.');
    return { items, paging: null, checkedIds: [...new Set([...items.map(row => row.id), ...(previous?.items.map(row => row.id) ?? [])])] };
  })();
  enrichAvatars(work, scope, () => [...groups.values()], () => version);
  return work;
}

export function readNavigationInboxIds(userId: string, options: InboxReadOptions, ids: string[], signal?: AbortSignal, current?: () => boolean) {
  const { scope, reader } = nativeReaderScope(userId, signal, current), version = ++avatarVersion;
  const groups = new Map<string, GroupAvatar>();
  const work = readInboxIds(nativePageReader(reader, scope, version, groups), options, ids);
  enrichAvatars(work, scope, () => [...groups.values()], () => version);
  return work;
}

export function subscribeNavigationInboxAvatars(listener: (scope: string, avatars: InboxAvatar[]) => void) {
  avatarListeners.add(listener);
  return () => { avatarListeners.delete(listener); };
}

/** Avatar grants may finish after realtime has updated previews or unread
 * counts. Patch only the photos so that enrichment cannot roll back those rows. */
export function applyNavigationInboxAvatars(rows: Conversation[], avatars: InboxAvatar[]): Conversation[] {
  const urls = new Map(avatars.map(value => [value.id, value.url]));
  return rows.map(row => row.is_group && urls.has(row.id)
    ? { ...row, other_avatar: urls.get(row.id)!, group_avatar_url: urls.get(row.id)! }
    : row);
}

/** The same bounded read serves tab intent, initial rendering and background refresh. */
export function refreshNavigationInbox(userId: string): Promise<Conversation[]> {
  const scope = navigationScope();
  const session = useAuthStore.getState().session;
  if (!scope || session?.user.id !== userId) return Promise.reject(new Error('Sign in to load conversations.'));
  const accessToken = session.access_token;
  let groupsToSign: { id: string; group_avatar_url: string | null }[] = [], version = 0;
  const work = navigationCache.load(scope, 'inbox:personal', async signal => {
    version = ++avatarVersion;
    const pin = (query: any) => query.setHeader('Authorization', `Bearer ${accessToken}`).abortSignal(signal);
    const current = () => {
      if (signal.aborted || navigationScope() !== scope) throw new Error('The account changed.');
    };
    const collected = new Map<string, GroupAvatar>();
    const previous = navigationCache.read<Conversation[]>(scope, 'inbox:personal');
    const paging = navigationCache.read<InboxPaging>(scope, 'inbox:personal:paging');
    const paged = await refreshInboxWindow(nativePageReader({ viewer: userId, token: accessToken, signal,
      current: () => !signal.aborted && navigationScope() === scope }, scope, version, collected), nativeInboxOptions(),
      previous ? { items: previous, paging } : null, row => matchesNativeInbox(row, nativeInboxOptions()), compareNativeInbox);
    if (paged) {
      current(); groupsToSign = [...collected.values()];
      navigationCache.save(scope, 'inbox:personal:paging', paged.paging);
      return paged.items;
    }
    const direct = async () => {
      const dm = await pin(supabase.from('conversations').select('*').or(`user_1.eq.${userId},user_2.eq.${userId}`).eq('is_group', false).order('last_message_time', { ascending: false }));
      if (dm.error) throw new Error('Conversations could not be refreshed. Please try again.');
      current();
      const rows = dm.data ?? [];
      const ids = [...new Set(rows.map((row: any) => row.user_1 === userId ? row.user_2 : row.user_1).filter(Boolean))];
      const profiles = ids.length ? await pin(supabase.from('profiles').select('id, full_name, username, avatar_url, is_verified, verified_tier').in('id', ids)) : { data: [], error: null };
      if (profiles.error) throw new Error('Conversation details could not be refreshed. Please try again.');
      current();
      return { rows, profiles: profiles.data ?? [] };
    };
    const group = async () => {
      const members = await pin(supabase.from('conversation_members').select('conversation_id').eq('user_id', userId));
      if (members.error) throw new Error('Conversations could not be refreshed. Please try again.');
      current();
      const ids = [...new Set((members.data ?? []).map((row: any) => row.conversation_id))];
      const groups = ids.length ? await pin(supabase.from('conversations').select('*').in('id', ids).eq('is_group', true).order('last_message_time', { ascending: false })) : { data: [], error: null };
      if (groups.error) throw new Error('Conversation details could not be refreshed. Please try again.');
      current();
      return groups.data ?? [];
    };
    // Each detail query starts as soon as its own identifiers arrive. A slow
    // unread count or settings read no longer delays profile/group retrieval.
    const [dm, groups, settings, unread] = await Promise.all([
      direct(), group(),
      pin(supabase.from('conversation_settings').select('conversation_id, is_pinned, is_muted, is_archived, is_deleted, manually_unread').eq('user_id', userId)),
      pin(supabase.rpc('get_unread_counts')),
    ]);
    if (settings.error || unread.error) throw new Error('Conversations could not be refreshed. Please try again.');
    current();
    groupsToSign = groups.filter((row: any) => isChatMediaUrl(row.group_avatar_url));
    const allConvs = [...dm.rows, ...groups.map((row: any) => ({ ...row,
      ...(isChatMediaUrl(row.group_avatar_url) ? { group_avatar_url: null } : {}),
    }))];
    const settingsMap: Record<string, any> = {}, profileMap: Record<string, any> = {};
    (settings.data ?? []).forEach((row: any) => { settingsMap[row.conversation_id] = row; });
    dm.profiles.forEach((row: any) => { profileMap[row.id] = row; });
    const unreadMap = conversationUnreadCounts(unread.data);
      const list: Conversation[] = allConvs
        .filter((c: any) => !(settingsMap[c.id]?.is_deleted))
        .map((c: any) => {
          const s = settingsMap[c.id] || {};
          if (c.is_group) {
            return {
              id: c.id, other_user_id: '',
              other_name: c.group_name || 'Group',
              other_username: null, other_avatar: c.group_avatar_url || null,
              last_message: c.last_message || '', last_message_time: c.last_message_time,
              unread_count: unreadMap[c.id] || 0,
              context: c.context || 'personal', is_group: true, group_emoji: c.group_emoji || '💬',
              group_avatar_url: c.group_avatar_url,
              group_type: c.group_type || null, group_ref_id: c.group_ref_id || null,
              is_pinned: !!s.is_pinned, is_muted: !!s.is_muted, is_archived: !!s.is_archived, manually_unread: !!(s as any).manually_unread,
            };
          }
          const otherId = c.user_1 === userId ? c.user_2 : c.user_1;
          const p = profileMap[otherId] || {};
          return {
            id: c.id, other_user_id: otherId,
            other_name: p.full_name || 'Member',
            other_is_verified: !!(p as any).is_verified, other_verified_tier: (p as any).verified_tier ?? null,
            other_username: p.username || null, other_avatar: p.avatar_url || null,
            last_message: c.last_message || '', last_message_time: c.last_message_time,
            unread_count: unreadMap[c.id] || 0,
            context: c.context || 'personal', is_group: false, group_emoji: null, group_avatar_url: null,
            request_pending: c.request_status === 'pending' && !!c.request_sender_id && c.request_sender_id === otherId,
            is_pinned: !!s.is_pinned, is_muted: !!s.is_muted, is_archived: !!s.is_archived, manually_unread: !!(s as any).manually_unread,
          };
        });

      list.sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
        const ta = a.last_message_time ? new Date(a.last_message_time).getTime() : 0;
        const tb = b.last_message_time ? new Date(b.last_message_time).getTime() : 0;
        return tb - ta;
      });

    rememberAvatarVersion(scope, list, version);
    navigationCache.save(scope, 'inbox:personal:paging', null);
    return list;
  });
  // Membership-authorized conversation text is ready now. Private group photos
  // keep their existing grant check and fill in separately, without gating DMs.
  enrichAvatars(work, scope, () => groupsToSign, () => version);
  return work;
}
