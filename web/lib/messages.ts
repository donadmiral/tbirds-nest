// Mirrors ConversationsScreen assembly and the messages row shape.
import { createClient } from "@/lib/supabase/client";

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
  created_at: string;
  deleted_at?: string | null;
};

export async function loadConversations(userId: string, context: string = "personal"): Promise<Conv[]> {
  const supabase = createClient();
  const { data: dmConvs } = await supabase
    .from("conversations")
    .select("*")
    .or("user_1.eq." + userId + ",user_2.eq." + userId)
    .eq("is_group", false)
    .order("last_message_time", { ascending: false });

  const { data: memberRows } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId);
  const groupIds = (memberRows ?? []).map((r) => r.conversation_id);
  let groupConvs: Record<string, unknown>[] = [];
  if (groupIds.length > 0) {
    const { data: gc } = await supabase
      .from("conversations")
      .select("*")
      .in("id", groupIds)
      .eq("is_group", true)
      .order("last_message_time", { ascending: false });
    groupConvs = (gc ?? []) as Record<string, unknown>[];
  }

  const dmOtherIds = ((dmConvs ?? []) as Record<string, unknown>[])
    .map((c) => (c.user_1 === userId ? c.user_2 : c.user_1))
    .filter(Boolean) as string[];
  const profileMap = new Map<string, { full_name: string | null; username: string | null; avatar_url: string | null }>();
  if (dmOtherIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, username, avatar_url")
      .in("id", dmOtherIds);
    (profs ?? []).forEach((p) => profileMap.set(p.id, p));
  }

  const unreadMap: Record<string, number> = {};
  try {
    const { data: unreadData } = await supabase.rpc("get_unread_counts");
    ((unreadData ?? []) as { conversation_id: string; unread_count: number }[]).forEach((u) => {
      unreadMap[u.conversation_id] = Number(u.unread_count) || 0;
    });
  } catch { /* non-fatal */ }

  const keep = (c: Record<string, unknown>) => ((c.context as string) || "personal") === context;
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
    };
  });
  const groups: Conv[] = groupConvs.filter(keep).map((c) => ({
    id: c.id as string,
    is_group: true,
    other_id: null,
    title: (c.group_name as string) || "Group",
    username: null,
    avatar: (c.group_avatar_url as string) ?? null,
    last_message: (c.last_message as string) || "",
    last_message_time: (c.last_message_time as string) ?? null,
    unread: unreadMap[c.id as string] ?? 0,
  }));

  return [...dms, ...groups].sort((a, b) =>
    new Date(b.last_message_time ?? 0).getTime() - new Date(a.last_message_time ?? 0).getTime()
  );
}