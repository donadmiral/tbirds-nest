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
    channel_id: row.is_group_call ? row.id : row.agora_channel, conversation_id: row.conversation_id ?? null,
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
    supabase.functions.invoke('send-voip-push', { body: { callId: (data as any).id } }).then((r: any) => console.log('[voip] ring', JSON.stringify(r?.data ?? null), r?.error ? String(r.error.message || r.error) : 'ok')).catch((e: any) => console.log('[voip] ring failed', e?.message));
    return toRecord(data as CallSessionRow);
  },

  /** One shared session and participant rows, matching web and ChatScreen. */
  async initiateGroupCall(params: {
    callerId: string; conversationId: string; channelId: string; isVideo?: boolean;
  }): Promise<CallRecord | null> {
    const { data: sessionId, error } = await supabase.rpc('start_group_call', {
      p_conversation_id: params.conversationId,
      p_is_video: params.isVideo ?? false,
    });
    if (error || typeof sessionId !== 'string' || !sessionId) return null;
    const { data, error: readError } = await supabase.from('call_sessions')
      .select('*').eq('id', sessionId).single();
    if (readError || !data) {
      // Do not leave the newly created caller membership behind on a failed read.
      await supabase.rpc('leave_group_call', { p_session_id: sessionId });
      return null;
    }
    supabase.functions.invoke('send-voip-push', { body: { callId: sessionId } }).catch(() => {});
    return toRecord(data as CallSessionRow);
  },

  /** The RPC checks current membership and joins only the authenticated user. */
  async joinGroupCall(callId: string, userId: string): Promise<boolean> {
    if (!callId || !userId) return false;
    const { error } = await supabase.rpc('join_group_call', { p_session_id: callId });
    return !error;
  },

  /** Leaving updates our participant row. The server ends an empty call. */
  async leaveGroupCall(callId: string, userId: string): Promise<void> {
    if (!callId || !userId) return;
    const { error } = await supabase.rpc('leave_group_call', { p_session_id: callId });
    if (error) throw error;
  },

  async declineGroupCall(callId: string, userId: string): Promise<void> {
    if (!callId || !userId) return;
    const { error } = await supabase.rpc('decline_group_call', { p_session_id: callId });
    if (error) throw error;
  },

  /** Compatibility hook. leave_group_call owns the empty-call check atomically. */
  async checkAndEndGroupCall(_callId: string): Promise<void> {},

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