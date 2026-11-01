import { conversationUnreadCounts } from '../../shared/messageReceipts';
import { navigationCache, navigationScope } from '../lib/navigationCache';
import { useAuthStore } from '../stores/authStore';
import { supabase } from './supabase';
import { isChatMediaUrl, signGroupAvatars } from './chatMediaService';

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
};

type InboxAvatar = { id: string; url: string | null };
const avatarListeners = new Set<(scope: string, avatars: InboxAvatar[]) => void>();
const avatarJobs = new WeakSet<Promise<Conversation[]>>();
let avatarVersion = 0;

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

    return list;
  });
  // Membership-authorized conversation text is ready now. Private group photos
  // keep their existing grant check and fill in separately, without gating DMs.
  if (!avatarJobs.has(work)) {
    avatarJobs.add(work);
    void work.then(async () => {
      if (!groupsToSign.length || navigationScope() !== scope || version !== avatarVersion) return;
      const signed = await signGroupAvatars(groupsToSign);
      if (navigationScope() !== scope || version !== avatarVersion) return;
      const avatars = signed.map(row => ({ id: row.id, url: row.group_avatar_url || null }));
      const cached = navigationCache.read<Conversation[]>(scope, 'inbox:personal');
      if (cached) navigationCache.save(scope, 'inbox:personal', applyNavigationInboxAvatars(cached, avatars));
      avatarListeners.forEach(listener => listener(scope, avatars));
    }).catch(() => { /* The visible initials remain usable if a photo fails. */ });
  }
  return work;
}
