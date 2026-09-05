// src/services/callService.ts
/**
 * Daily.co media. Supabase signaling via call_sessions + call_participants.
 * Supports 1-on-1 and group calls.
 * Call event messages handled by backend RPC record_call_event.
 */
import { supabase } from './supabase';

export type CallStatus = 'ringing' | 'active' | 'declined' | 'ended' | 'missed';

export type CallRecord = {
  id: string; caller_id: string; receiver_id: string | null;
  channel_id: string; conversation_id: string | null;
  status: CallStatus; is_video: boolean; is_group_call: boolean;
  started_at: string | null; ended_at: string | null;
  duration_secs: number | null; created_at: string;
};

export type DailyTokenResult = { roomName: string; roomUrl: string; token: string };

type CallSessionRow = {
  id: string; initiator_id: string; receiver_id: string | null;
  conversation_id: string | null; agora_channel: string;
  call_type: string | null; status: CallStatus; is_video: boolean | null;
  is_group_call: boolean | null;
  started_at: string | null; ended_at: string | null;
  duration_sec: number | null; created_at: string;
};

function toRecord(row: CallSessionRow | null | undefined): CallRecord | null {
  if (!row) return null;
  return {
    id: row.id, caller_id: row.initiator_id, receiver_id: row.receiver_id ?? null,
    channel_id: row.agora_channel, conversation_id: row.conversation_id ?? null,
    status: row.status, is_video: !!row.is_video, is_group_call: !!row.is_group_call,
    started_at: row.started_at ?? null, ended_at: row.ended_at ?? null,
    duration_secs: row.duration_sec ?? null, created_at: row.created_at,
  };
}

export const callService = {
  async initiateCall(params: {
    callerId: string; receiverId: string; channelId: string;
    isVideo?: boolean; conversationId?: string | null;
  }): Promise<CallRecord | null> {
    let conversationId = params.conversationId ?? null;
    if (!conversationId) {
      const a = [params.callerId, params.receiverId].sort();
      const { data } = await supabase.from('conversations').select('id').eq('type', 'direct')
        .or(`and(user_1.eq.${a[0]},user_2.eq.${a[1]}),and(user_1.eq.${a[1]},user_2.eq.${a[0]})`).maybeSingle();
      conversationId = data?.id ?? null;
    }
    const { data, error } = await supabase.from('call_sessions').insert({
      initiator_id: params.callerId, receiver_id: params.receiverId,
      agora_channel: params.channelId, conversation_id: conversationId,
      call_type: params.isVideo ? 'video' : 'voice', status: 'ringing',
      is_video: params.isVideo ?? false, is_group_call: false,
    }).select().single();
    if (error) { console.log('[SVC_INITIATE_ERR]', error.message); return null; }
    // Wake the other phone: Apple VoIP push on iPhone, high-priority push on
    // Android. Fire and forget; the in-app listener still covers open apps.
    supabase.functions.invoke('send-voip-push', { body: { callId: (data as any).id } }).catch(() => {});
    return toRecord(data as CallSessionRow);
  },

  /**
   * DEPRECATED — legacy per-member-row group calls. The live system is
   * start_group_call/join_group_call/leave_group_call/decline_group_call
   * (one shared session + call_participants). Do not call this.
   * Initiate a group call.
   * Creates a call_session with is_group_call=true, receiver_id=null.
   * Inserts a call_participants row for each group member (except caller).
   * The caller is also added as a participant with status='joined'.
   */
  async initiateGroupCall(params: {
    callerId: string; conversationId: string; channelId: string; isVideo?: boolean;
  }): Promise<CallRecord | null> {
    // 1. Get all group members
    const { data: members } = await supabase.from('conversation_members')
      .select('user_id')
      .eq('conversation_id', params.conversationId);

    if (!members || members.length === 0) {
      console.log('[SVC_GROUP_INITIATE_ERR] No members found');
      return null;
    }

    // 2. Insert one call_sessions row per member (excluding caller).
    //    All share the same channel_id so everyone joins the same Daily room.
    //    The existing subscribeToIncomingCalls picks these up via receiver_id.
    const otherMembers = members.filter((m: any) => m.user_id !== params.callerId);

    // Insert caller's own row first (receiver_id = null, status = active)
    const { data: callerSession, error: callerErr } = await supabase.from('call_sessions').insert({
      initiator_id: params.callerId, receiver_id: null,
      agora_channel: params.channelId, conversation_id: params.conversationId,
      call_type: params.isVideo ? 'video' : 'voice', status: 'active',
      is_video: params.isVideo ?? false, is_group_call: true,
      started_at: new Date().toISOString(),
    }).select().single();

    if (callerErr || !callerSession) {
      console.log('[SVC_GROUP_INITIATE_ERR]', callerErr?.message);
      return null;
    }

    // Insert one row per other member with receiver_id set and status = ringing
    if (otherMembers.length > 0) {
      const rows = otherMembers.map((m: any) => ({
        initiator_id: params.callerId,
        receiver_id: m.user_id,
        agora_channel: params.channelId,
        conversation_id: params.conversationId,
        call_type: params.isVideo ? 'video' : 'voice',
        status: 'ringing',
        is_video: params.isVideo ?? false,
        is_group_call: true,
      }));

      const { error: memberErr } = await supabase.from('call_sessions').insert(rows);
      if (memberErr) {
        console.log('[SVC_GROUP_MEMBERS_ERR]', memberErr.message);
      }
    }

    console.log('[SVC_GROUP_INITIATE] Created call for', otherMembers.length, 'members, channel:', params.channelId);
    return toRecord(callerSession as CallSessionRow);
  },

  /**
   * Join an existing group call.
   * Accepts the receiver's own call_sessions row (sets status to active).
   */
  async joinGroupCall(callId: string, userId: string): Promise<boolean> {
    if (!callId || !userId) return false;

    // Accept this user's call_sessions row
    const { error } = await supabase.from('call_sessions')
      .update({ status: 'active', started_at: new Date().toISOString() })
      .eq('id', callId)
      .eq('receiver_id', userId);

    if (error) {
      console.log('[SVC_JOIN_GROUP_ERR]', error.message);
      return false;
    }

    return true;
  },

  /**
   * Leave a group call. Ends only this user's call_sessions row.
   * Other participants' rows stay alive.
   */
  async leaveGroupCall(callId: string, userId: string): Promise<void> {
    if (!callId || !userId) return;

    // Get this call's channel_id so we can find the user's row
    const { data: call } = await supabase.from('call_sessions')
      .select('agora_channel').eq('id', callId).maybeSingle();

    if (!call?.agora_channel) return;

    // End all rows for this user on this channel
    await supabase.from('call_sessions')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('agora_channel', call.agora_channel)
      .eq('is_group_call', true)
      .or(`receiver_id.eq.${userId},and(initiator_id.eq.${userId},receiver_id.is.null)`);
  },

  /**
   * Decline a group call invite. Ends this user's call_sessions row as declined.
   */
  async declineGroupCall(callId: string, userId: string): Promise<void> {
    if (!callId || !userId) return;
    await supabase.from('call_sessions')
      .update({ status: 'declined', ended_at: new Date().toISOString() })
      .eq('id', callId)
      .eq('receiver_id', userId);
  },

  /**
   * Check and end group call. With per-user rows, each user's row is ended
   * individually via leaveGroupCall. This is kept for backward compatibility.
   */
  async checkAndEndGroupCall(callId: string): Promise<void> {
    // No-op: each user's row is ended individually via leaveGroupCall
  },

  async acceptCall(callId: string): Promise<boolean> {
    if (!callId) return false;
    const { data, error } = await supabase.from('call_sessions')
      .update({ status: 'active', started_at: new Date().toISOString() }).eq('id', callId).select('id');
    if (error) { console.log('[SVC_ACCEPT_ERR]', error.message); return false; }
    return ((data as any[]) || []).length > 0;
  },

  async declineCall(callId: string): Promise<boolean> {
    if (!callId) return false;
    const { data, error } = await supabase.from('call_sessions')
      .update({ status: 'declined', ended_at: new Date().toISOString() }).eq('id', callId).select('id');
    if (error) return false;
    return ((data as any[]) || []).length > 0;
  },

  async endCall(callId: string, durationSecs: number): Promise<boolean> {
    if (!callId) return false;
    const dur = Math.max(0, Math.floor(durationSecs || 0));
    const { data, error } = await supabase.from('call_sessions')
      .update({ status: 'ended', ended_at: new Date().toISOString(), duration_sec: dur }).eq('id', callId).select('id');
    if (error) return false;
    return ((data as any[]) || []).length > 0;
  },

  async markMissed(callId: string): Promise<boolean> {
    if (!callId) return false;
    const { data, error } = await supabase.from('call_sessions')
      .update({ status: 'missed', ended_at: new Date().toISOString() }).eq('id', callId).select('id');
    if (error) return false;
    return ((data as any[]) || []).length > 0;
  },

  async getCall(callId: string): Promise<CallRecord | null> {
    if (!callId) return null;
    const { data } = await supabase.from('call_sessions').select('*').eq('id', callId).maybeSingle();
    return toRecord(data as CallSessionRow | null);
  },

  async listRecentCalls(userId: string, limit: number = 50): Promise<CallRecord[]> {
    const { data, error } = await supabase.from('call_sessions').select('*')
      .or(`initiator_id.eq.${userId},receiver_id.eq.${userId}`)
      .order('created_at', { ascending: false }).limit(limit);
    if (error) return [];
    return ((data || []) as CallSessionRow[]).map(r => toRecord(r)!).filter(Boolean);
  },

  async recordCallEvent(callId: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('record_call_event', { p_call_id: callId });
      if (error) {
        console.log('[CALL_EVENT_RPC_ERR]', error.message, error.code);
      } else {
        console.log('[CALL_EVENT] RPC success for', callId.slice(0, 8));
      }
    } catch (e: any) {
      console.log('[CALL_EVENT_RPC_ERR]', e?.message);
    }
  },

  subscribeToIncomingCalls(userId: string, onIncoming: (call: CallRecord) => void) {
    return supabase.channel(`incoming_calls_${userId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'call_sessions', filter: `receiver_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as CallSessionRow;
          if (row.status === 'ringing') { const rec = toRecord(row); if (rec) onIncoming(rec); }
        }).subscribe();
  },

  subscribeToCallStatus(callId: string, onStatusChange: (status: CallStatus) => void) {
    const uid = `${callId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return supabase.channel(`call_status_${uid}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `id=eq.${callId}` },
        (payload) => { onStatusChange((payload.new as CallSessionRow).status); }
      ).subscribe();
  },

  async getDailyToken(params: {
    callSessionId?: string; roomName?: string; isOwner?: boolean; kind?: 'call' | 'meeting';
  }): Promise<DailyTokenResult> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) throw new Error('Not authenticated');
    const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/daily-get-token`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ callSessionId: params.callSessionId, roomName: params.roomName, isOwner: params.isOwner ?? false, kind: params.kind ?? 'call' }),
    });
    const responseText = await res.text();
    if (!res.ok) throw new Error(`Edge Function ${res.status}: ${responseText}`);
    const data = JSON.parse(responseText);
    if (!data?.token || !data?.roomUrl) throw new Error('Invalid token response');
    return data as DailyTokenResult;
  },

  formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },
};