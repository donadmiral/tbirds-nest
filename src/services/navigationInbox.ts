import { conversationUnreadCounts } from '../../shared/messageReceipts';
import { navigationCache, navigationScope } from '../lib/navigationCache';
import { useAuthStore } from '../stores/authStore';
import { supabase } from './supabase';
import { signGroupAvatars } from './chatMediaService';

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

/** The same bounded read serves tab intent, initial rendering and background refresh. */
export function refreshNavigationInbox(userId: string): Promise<Conversation[]> {
  const scope = navigationScope();
  const session = useAuthStore.getState().session;
  if (!scope || session?.user.id !== userId) return Promise.reject(new Error('Sign in to load conversations.'));
  const accessToken = session.access_token;
  return navigationCache.load(scope, 'inbox:personal', async signal => {
    const pin = (query: any) => query.setHeader('Authorization', `Bearer ${accessToken}`).abortSignal(signal);
    const [dm, members, settings, unread] = await Promise.all([
      pin(supabase.from('conversations').select('*').or(`user_1.eq.${userId},user_2.eq.${userId}`).eq('is_group', false).order('last_message_time', { ascending: false })),
      pin(supabase.from('conversation_members').select('conversation_id').eq('user_id', userId)),
      pin(supabase.from('conversation_settings').select('conversation_id, is_pinned, is_muted, is_archived, is_deleted, manually_unread').eq('user_id', userId)),
      pin(supabase.rpc('get_unread_counts')),
    ]);
    if ([dm, members, settings, unread].some(result => result.error)) throw new Error('Conversations could not be refreshed. Please try again.');
    if (signal.aborted || navigationScope() !== scope) throw new Error('The account changed.');
    const dmConvs = dm.data ?? [];
    const groupIds = (members.data ?? []).map((row: any) => row.conversation_id);
    const dmOtherIds = [...new Set(dmConvs.map((row: any) => row.user_1 === userId ? row.user_2 : row.user_1).filter(Boolean))];
    const [groups, profiles] = await Promise.all([
      groupIds.length ? pin(supabase.from('conversations').select('*').in('id', groupIds).eq('is_group', true).order('last_message_time', { ascending: false })) : { data: [], error: null },
      dmOtherIds.length ? pin(supabase.from('profiles').select('id, full_name, username, avatar_url, is_verified, verified_tier').in('id', dmOtherIds)) : { data: [], error: null },
    ]);
    if (groups.error || profiles.error) throw new Error('Conversation details could not be refreshed. Please try again.');
    if (signal.aborted || navigationScope() !== scope) throw new Error('The account changed.');
    const allConvs = [...dmConvs, ...await signGroupAvatars(groups.data ?? [])];
    const settingsMap: Record<string, any> = {}, profileMap: Record<string, any> = {};
    (settings.data ?? []).forEach((row: any) => { settingsMap[row.conversation_id] = row; });
    (profiles.data ?? []).forEach((row: any) => { profileMap[row.id] = row; });
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
}
