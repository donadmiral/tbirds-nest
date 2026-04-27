// src/services/callService.ts
/**
 * Daily.co media. Supabase signaling via call_sessions.
 * Call event messages handled by backend RPC record_call_event.
 */
import { supabase } from './supabase';

export type CallStatus = 'ringing' | 'active' | 'declined' | 'ended' | 'missed';

export type CallRecord = {
  id: string; caller_id: string; receiver_id: string | null;
  channel_id: string; conversation_id: string | null;
  status: CallStatus; is_video: boolean;
  started_at: string | null; ended_at: string | null;
  duration_secs: number | null; created_at: string;
};

export type DailyTokenResult = { roomName: string; roomUrl: string; token: string };

type CallSessionRow = {
  id: string; initiator_id: string; receiver_id: string | null;
  conversation_id: string | null; agora_channel: string;
  call_type: string | null; status: CallStatus; is_video: boolean | null;
  started_at: string | null; ended_at: string | null;
  duration_sec: number | null; created_at: string;
};

function toRecord(row: CallSessionRow | null | undefined): CallRecord | null {
  if (!row) return null;
  return {
    id: row.id, caller_id: row.initiator_id, receiver_id: row.receiver_id ?? null,
    channel_id: row.agora_channel, conversation_id: row.conversation_id ?? null,
    status: row.status, is_video: !!row.is_video,
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
      call_type: params.isVideo ? 'video' : 'voice', status: 'ringing', is_video: params.isVideo ?? false,
    }).select().single();
    if (error) { console.log('[SVC_INITIATE_ERR]', error.message); return null; }
    return toRecord(data as CallSessionRow);
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

  /**
   * Record a call event message via backend RPC.
   * All logic (read call, resolve conversation, build text, deduplicate,
   * insert message, update conversation preview) runs server-side
   * as SECURITY DEFINER. Frontend just passes the call_id.
   */
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