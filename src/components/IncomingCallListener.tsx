/**
 * IncomingCallListener.tsx — FINAL FIX
 * Guards against ghost re-calls by:
 * 1. Double-checking call status before navigating
 * 2. Tracking handled call IDs to prevent re-trigger
 * 3. Ignoring any call that is not status='ringing'
 */
import { useEffect, useRef } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../stores/authStore';
import { callService, CallRecord } from '../services/callService';
import { supabase } from '../services/supabase';

export default function IncomingCallListener() {
  const nav = useNavigation<any>();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;
  const activeCallIdRef = useRef<string | null>(null);
  // Track all call IDs we've already handled to prevent ghost re-triggers
  const handledCallIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;

    const handleIncoming = async (call: CallRecord) => {
      if (!call.caller_id) return;
      // Skip if we already handled this call (prevents ghost re-call)
      if (handledCallIdsRef.current.has(call.id)) return;
      if (activeCallIdRef.current === call.id) return;

      // CRITICAL: Only process calls with status 'ringing'
      if (call.status !== 'ringing') return;

      // Double-check fresh status from DB
      const fresh = await callService.getCall(call.id);
      if (!fresh || fresh.status !== 'ringing') {
        handledCallIdsRef.current.add(call.id);
        return;
      }

      activeCallIdRef.current = call.id;
      handledCallIdsRef.current.add(call.id);

      const { data: caller } = await supabase
        .from('profiles').select('id, full_name, username, avatar_url')
        .eq('id', call.caller_id).single();

      // Re-verify after profile fetch
      const recheck = await callService.getCall(call.id);
      if (!recheck || recheck.status !== 'ringing') {
        activeCallIdRef.current = null;
        return;
      }

      nav.navigate('IncomingCall', {
        callId: call.id, channelId: call.channel_id,
        callerName: caller?.full_name || 'Unknown',
        callerAvatar: caller?.avatar_url || null,
        callerUsername: caller?.username || null,
        otherUser: caller || { id: call.caller_id, full_name: 'Unknown', avatar_url: null },
        isVideo: call.is_video,
      });

      // Subscribe to status to clear active ref
      const subUid = `${call.id}_listener_${Date.now()}`;
      const statusSub = supabase.channel(`call_status_${subUid}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `id=eq.${call.id}` },
          (payload) => {
            const st = (payload.new as any).status;
            if (st === 'ended' || st === 'declined' || st === 'missed' || st === 'active') {
              activeCallIdRef.current = null;
              statusSub.unsubscribe();
            }
          })
        .subscribe();
    };

    const sub = callService.subscribeToIncomingCalls(userId, handleIncoming);
    return () => { sub.unsubscribe(); activeCallIdRef.current = null; };
  }, [userId, nav]);

  return null;
}