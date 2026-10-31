// Mirrors ConversationsScreen assembly and the messages row shape.
import { signGroupAvatars } from "@/lib/chatMedia";
import { createClient } from "@/lib/supabase/client";
import { conversationUnreadCounts } from '../../shared/messageReceipts';

export type Conv = {
  id: string;
  is_group: boolean;
  other_id: string | null;
  title: string;
  username: string | null;
  avatar: string | null;
  last_message: string;
  last_message_time: string | null;
  unread: number;
  context: string;
  context_ref_id: string | null;
  group_type: string | null;
  group_ref_id: string | null;
  request_pending?: boolean;
};

export type Msg = {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string | null;
  text: string | null;
  media_url: string | null;
  media_type: string | null;
  reply_to_id: string | null;
  payment_id?: string | null;
  shared_post_id?: string | null;
  created_at: string;
  deleted_at?: string | null;
  edited_at?: string | null;
  read_at?: string | null;
  delivered_at?: string | null;
  forwarded_from_id?: string | null;
  view_limit?: number | null;
  is_system_message?: boolean;
  _reactions?: { user_id: string; emoji: string }[];
  _private_media_url?: string | null;
  _private_thumbnail_url?: string | null;
  _delivery?: 'pending' | 'rejected' | 'conflict';
};

export async function loadConversations(userId: string, context = 'personal', signal?: AbortSignal, accessToken?: string): Promise<Conv[]> {
  const supabase = createClient();
  const pin = <T extends { abortSignal(signal: AbortSignal): unknown; setHeader(name: string, value: string): unknown }>(query: T): T => {
    if (signal) query.abortSignal(signal);
    if (accessToken) query.setHeader('Authorization', `Bearer ${accessToken}`);
    return query;
  };
  const [dm, memberships, unread] = await Promise.all([
    pin(supabase.from('conversations').select('*').or('user_1.eq.' + userId + ',user_2.eq.' + userId)
      .eq('is_group', false).order('last_message_time', { ascending: false })),
    pin(supabase.from('conversation_members').select('conversation_id').eq('user_id', userId)),
    pin(supabase.rpc('get_unread_counts')),
  ]);
  if (dm.error || memberships.error || unread.error) throw new Error('Conversations could not be loaded.');
  if (signal?.aborted) throw new Error('The conversation read was cancelled.');
  const dmConvs = dm.data ?? [];
  const groupIds = (memberships.data ?? []).map(row => row.conversation_id);
  const keep = (c: Record<string, unknown>) => ((c.context as string) || 'personal') === context;
  const dmOtherIds = [...new Set((dmConvs as Record<string, unknown>[]).filter(keep)
    .map(c => c.user_1 === userId ? c.user_2 : c.user_1).filter(Boolean))] as string[];
  const [groupResult, profiles] = await Promise.all([
    groupIds.length ? pin(supabase.from('conversations').select('*').in('id', groupIds).eq('is_group', true).order('last_message_time', { ascending: false })) : { data: [], error: null },
    dmOtherIds.length ? pin(supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', dmOtherIds)) : { data: [], error: null },
  ]);
  if (groupResult.error || profiles.error) throw new Error('Conversation details could not be loaded.');
  if (signal?.aborted) throw new Error('The conversation read was cancelled.');
  const groupConvs = (groupResult.data ?? []) as Record<string, unknown>[];
  const profileMap = new Map<string, { full_name: string | null; username: string | null; avatar_url: string | null }>();
  (profiles.data ?? []).forEach(p => profileMap.set(p.id, p));
  const unreadMap = conversationUnreadCounts(unread.data);

  const dms: Conv[] = ((dmConvs ?? []) as Record<string, unknown>[]).filter(keep).map((c) => {
    const otherId = (c.user_1 === userId ? c.user_2 : c.user_1) as string | null;
    const p = otherId ? profileMap.get(otherId) : null;
    return {
      id: c.id as string,
      is_group: false,
      other_id: otherId,
      title: p?.full_name || "Member",
      username: p?.username ?? null,
      avatar: p?.avatar_url ?? null,
      last_message: (c.last_message as string) || "",
      last_message_time: (c.last_message_time as string) ?? null,
      unread: unreadMap[c.id as string] ?? 0,
      context: (c.context as string) || "personal",
      context_ref_id: (c.context_ref_id as string) ?? null,
      group_type: null,
      group_ref_id: null,
      request_pending: c.request_status === "pending" && !!c.request_sender_id && c.request_sender_id === otherId,
    };
  });
  const signedGroups = await signGroupAvatars(groupConvs as (Record<string, unknown> & { group_avatar_url?: string | null })[]);
  const groups: Conv[] = signedGroups.filter(keep).map((c) => ({
    id: c.id as string,
    is_group: true,
    other_id: null,
    title: (c.group_name as string) || "Group",
    username: null,
    avatar: (c.group_avatar_url as string) ?? null,
    last_message: (c.last_message as string) || "",
    last_message_time: (c.last_message_time as string) ?? null,
    unread: unreadMap[c.id as string] ?? 0,
    context: (c.context as string) || "personal",
    context_ref_id: (c.context_ref_id as string) ?? null,
    group_type: (c.group_type as string) ?? null,
    group_ref_id: (c.group_ref_id as string) ?? null,
  }));

  return [...dms, ...groups].sort((a, b) =>
    new Date(b.last_message_time ?? 0).getTime() - new Date(a.last_message_time ?? 0).getTime()
  );
}
