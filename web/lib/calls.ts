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