// Mirrors src/services/callService.ts contracts. Room name IS the session id.
import { createClient } from "@/lib/supabase/client";

export type CallSession = {
  id: string;
  initiator_id: string;
  receiver_id: string | null;
  conversation_id: string | null;
  call_type: string;
  is_video: boolean;
  is_group_call: boolean;
  status: string;
  expires_at?: string | null;
  created_at: string;
};

export async function startOneToOneCall(receiverId: string, conversationId: string | null, isVideo: boolean): Promise<CallSession | null> {
  const supabase = createClient();
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) return null;
  const { data, error } = await supabase.from("call_sessions").insert({
    initiator_id: uid, receiver_id: receiverId,
    agora_channel: null, conversation_id: conversationId,
    call_type: isVideo ? "video" : "voice", status: "ringing",
    is_video: isVideo, is_group_call: false,
  }).select().single();
  if (error || !data) return null;
  // Stamp the channel with the session id so phone receivers land in the same room (the 0062 lesson).
  await supabase.from("call_sessions").update({ agora_channel: data.id }).eq("id", data.id);
  return data as CallSession;
}

export async function getDailyRoom(callSessionId: string): Promise<{ roomUrl: string; token: string } | null> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("daily-get-token", { body: { callSessionId } });
  if (error || !data?.token || !data?.roomUrl) return null;
  return { roomUrl: data.roomUrl, token: data.token };
}

export async function setCallStatus(id: string, status: string): Promise<void> {
  const supabase = createClient();
  await supabase.from("call_sessions").update({ status }).eq("id", id);
}

export async function endCall(id: string): Promise<void> {
  const supabase = createClient();
  await supabase.from("call_sessions").update({ status: "ended" }).eq("id", id);
  try { await supabase.rpc("record_call_event", { p_call_id: id }); } catch { /* record best-effort */ }
}

export function requestWebCall(detail: { receiverId: string; conversationId: string | null; isVideo: boolean; name: string }): void {
  window.dispatchEvent(new CustomEvent("pc-start-call", { detail }));
}
// Group calls: one shared session, participants fan out, room = session id.
export async function startGroupCall(conversationId: string, isVideo: boolean): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("start_group_call", { p_conversation_id: conversationId, p_is_video: isVideo });
  if (error || !data) return null;
  return String(data);
}

export async function joinGroupCall(sessionId: string): Promise<void> {
  const supabase = createClient();
  await supabase.rpc("join_group_call", { p_session_id: sessionId });
}

export async function leaveGroupCall(sessionId: string): Promise<void> {
  const supabase = createClient();
  await supabase.rpc("leave_group_call", { p_session_id: sessionId });
}

export async function declineGroupCall(sessionId: string): Promise<void> {
  const supabase = createClient();
  await supabase.rpc("decline_group_call", { p_session_id: sessionId });
}

export type LiveGroupCall = { id: string; is_video: boolean; joinedNames: string[] };

// ChatScreen's exact banner truth: sweep first, staleness by expires_at with the
// 90s created_at fallback, and an active call with zero joined is a zombie.
export async function checkLiveGroupCall(conversationId: string): Promise<LiveGroupCall | null> {
  const supabase = createClient();
  try { await supabase.rpc("sweep_dead_calls"); } catch { /* best effort */ }
  const { data } = await supabase
    .from("call_sessions")
    .select("id, is_video, status, created_at, expires_at")
    .eq("is_group_call", true)
    .eq("conversation_id", conversationId)
    .in("status", ["ringing", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const stale = data.status === "ringing" && (data.expires_at
    ? Date.now() > new Date(data.expires_at).getTime()
    : Date.now() - new Date(data.created_at ?? 0).getTime() > 90000);
  if (stale) return null;
  const { data: parts } = await supabase
    .from("call_participants")
    .select("user_id")
    .eq("call_session_id", data.id)
    .eq("status", "joined");
  const ids = (parts ?? []).map((p) => p.user_id as string);
  if (data.status === "active" && ids.length === 0) return null;
  let joinedNames: string[] = [];
  if (ids.length > 0) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    joinedNames = (profs ?? []).map((p) => String(p.full_name || "").split(" ")[0]).filter(Boolean);
  }
  return { id: data.id, is_video: !!data.is_video, joinedNames };
}

export function requestGroupJoin(detail: { sessionId: string; isVideo: boolean }): void {
  window.dispatchEvent(new CustomEvent("pc-join-group-call", { detail }));
}