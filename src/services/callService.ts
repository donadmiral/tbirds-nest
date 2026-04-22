/**
 * callService.ts
 *
 * Backed by public.call_sessions (Phase 9).
 *
 * Uses Daily.co for media. Supabase signals via call_sessions.
 * getDailyToken() hits the daily-get-token Edge Function to create/join rooms.
 */

import { supabase } from './supabase';

export type CallStatus = 'ringing' | 'accepted' | 'declined' | 'ended' | 'missed';

export type CallRecord = {
  id: string;
  caller_id: string;
  receiver_id: string | null;
  channel_id: string;
  conversation_id: string | null;
  status: CallStatus;
  is_video: boolean;
  started_at: string | null;
  ended_at: string | null;
  duration_secs: number | null;
  created_at: string;
};

export type DailyTokenResult = {
  roomName: string;
  roomUrl: string;
  token: string;
};

type CallSessionRow = {
  id: string;
  initiator_id: string;
  receiver_id: string | null;
  conversation_id: string | null;
  agora_channel: string;
  call_type: string | null;
  status: CallStatus;
  is_video: boolean | null;
  started_at: string | null;
  ended_at: string | null;
  duration_sec: number | null;
  created_at: string;
};

function toRecord(row: CallSessionRow | null | undefined): CallRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    caller_id: row.initiator_id,
    receiver_id: row.receiver_id ?? null,
    channel_id: row.agora_channel,
    conversation_id: row.conversation_id ?? null,
    status: row.status,
    is_video: !!row.is_video,
    started_at: row.started_at ?? null,
    ended_at: row.ended_at ?? null,
    duration_secs: row.duration_sec ?? null,
    created_at: row.created_at,
  };
}

async function resolveDmConversationId(userA: string, userB: string): Promise<string | null> {
  const a = [userA, userB].sort();
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('type', 'direct')
    .or(`and(user_1.eq.${a[0]},user_2.eq.${a[1]}),and(user_1.eq.${a[1]},user_2.eq.${a[0]})`)
    .maybeSingle();
  return data?.id ?? null;
}

export const callService = {

  async initiateCall(params: {
    callerId: string;
    receiverId: string;
    channelId: string;
    isVideo?: boolean;
    conversationId?: string | null;
  }): Promise<CallRecord | null> {
    const conversationId =
      params.conversationId ??
      (await resolveDmConversationId(params.callerId, params.receiverId));

    console.log('[SVC_INITIATE]', {
      caller: params.callerId, receiver: params.receiverId,
      channel: params.channelId, conversationId, isVideo: !!params.isVideo,
    });

    const { data, error } = await supabase
      .from('call_sessions')
      .insert({
        initiator_id:    params.callerId,
        receiver_id:     params.receiverId,
        agora_channel:   params.channelId,
        conversation_id: conversationId,
        call_type:       params.isVideo ? 'video' : 'voice',
        status:          'ringing',
        is_video:        params.isVideo ?? false,
      })
      .select()
      .single();

    if (error) { console.log('[SVC_INITIATE_ERR]', error.message); return null; }
    console.log('[SVC_INITIATE_OK]', { id: data?.id });
    return toRecord(data as CallSessionRow);
  },

  async acceptCall(callId: string): Promise<boolean> {
    if (!callId) { console.log('[SVC_ACCEPT_SKIP] no callId'); return false; }
    const { data, error } = await supabase
      .from('call_sessions')
      .update({ status: 'accepted', started_at: new Date().toISOString() })
      .eq('id', callId)
      .select('id, status, started_at');
    if (error) { console.log('[SVC_ACCEPT_ERR]', error.message); return false; }
    const rows = (data as any[]) || [];
    console.log('[SVC_ACCEPT_OK]', { rowCount: rows.length });
    return rows.length > 0;
  },

  async declineCall(callId: string): Promise<boolean> {
    if (!callId) return false;
    const { data, error } = await supabase
      .from('call_sessions')
      .update({ status: 'declined', ended_at: new Date().toISOString() })
      .eq('id', callId)
      .select('id');
    if (error) { console.log('[SVC_DECLINE_ERR]', error.message); return false; }
    return (data as any[] || []).length > 0;
  },

  async endCall(callId: string, durationSecs: number): Promise<boolean> {
    if (!callId) return false;
    const dur = Math.max(0, Math.floor(durationSecs || 0));
    const { data, error } = await supabase
      .from('call_sessions')
      .update({
        status: 'ended',
        ended_at: new Date().toISOString(),
        duration_sec: dur,
      })
      .eq('id', callId)
      .select('id, status, ended_at, duration_sec');
    if (error) { console.log('[SVC_END_ERR]', error.message); return false; }
    const rows = (data as any[]) || [];
    console.log('[SVC_END_OK]', { rowCount: rows.length });
    return rows.length > 0;
  },

  async markMissed(callId: string): Promise<boolean> {
    if (!callId) return false;
    const { data, error } = await supabase
      .from('call_sessions')
      .update({ status: 'missed', ended_at: new Date().toISOString() })
      .eq('id', callId)
      .select('id');
    if (error) { console.log('[SVC_MISSED_ERR]', error.message); return false; }
    return (data as any[] || []).length > 0;
  },

  async getCall(callId: string): Promise<CallRecord | null> {
    if (!callId) return null;
    const { data } = await supabase
      .from('call_sessions')
      .select('*')
      .eq('id', callId)
      .maybeSingle();
    return toRecord(data as CallSessionRow | null);
  },

  async listRecentCalls(userId: string, limit: number = 50): Promise<CallRecord[]> {
    const { data, error } = await supabase
      .from('call_sessions')
      .select('*')
      .or(`initiator_id.eq.${userId},receiver_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) { console.log('[SVC_LIST_ERR]', error.message); return []; }
    return ((data || []) as CallSessionRow[]).map(r => toRecord(r)!).filter(Boolean);
  },

  subscribeToIncomingCalls(userId: string, onIncoming: (call: CallRecord) => void) {
    return supabase
      .channel(`incoming_calls_${userId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'call_sessions', filter: `receiver_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as CallSessionRow;
          if (row.status === 'ringing') {
            const rec = toRecord(row);
            if (rec) onIncoming(rec);
          }
        }
      )
      .subscribe();
  },

  subscribeToCallStatus(callId: string, onStatusChange: (status: CallStatus) => void) {
    return supabase
      .channel(`call_status_${callId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `id=eq.${callId}` },
        (payload) => {
          const row = payload.new as CallSessionRow;
          onStatusChange(row.status);
        }
      )
      .subscribe();
  },

  /**
   * Fetch a Daily room URL + meeting token from the Supabase Edge Function.
   * For 1-to-1 calls, pass callSessionId (server resolves room name).
   * For multi-party meetings, pass roomName + kind='meeting'.
   */
  async getDailyToken(params: {
    callSessionId?: string;
    roomName?: string;
    isOwner?: boolean;
    kind?: 'call' | 'meeting';
  }): Promise<DailyTokenResult> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const { data, error } = await supabase.functions.invoke('daily-get-token', {
      body: {
        callSessionId: params.callSessionId,
        roomName: params.roomName,
        isOwner: params.isOwner ?? false,
        kind: params.kind ?? 'call',
      },
    });

    if (error) throw new Error(error.message || 'Could not get Daily token');
    if (!data?.token || !data?.roomUrl) throw new Error('Invalid token response');

    return data as DailyTokenResult;
  },

  formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60), s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },
};