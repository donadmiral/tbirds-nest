/**
 * IncomingCallListener
 * Mounts at app root, subscribes to incoming call_sessions for the logged-in user.
 * When a ringing row appears, pushes IncomingCallScreen so users see rings regardless
 * of which screen they're currently on.
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

  useEffect(() => {
    if (!userId) return;

    const handleIncoming = async (call: CallRecord) => {
      if (!call.caller_id) return;
      if (activeCallIdRef.current === call.id) return;
      activeCallIdRef.current = call.id;

      // Look up caller profile for avatar/name
      const { data: caller } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url')
        .eq('id', call.caller_id)
        .single();

      nav.navigate('IncomingCall', {
        callId: call.id,
        channelId: call.channel_id,
        callerName: caller?.full_name || 'Unknown',
        callerAvatar: caller?.avatar_url || null,
        callerUsername: caller?.username || null,
        otherUser: caller || { id: call.caller_id, full_name: 'Unknown', avatar_url: null },
        isVideo: call.is_video,
      });

      // Clear the ref when call status changes
      const statusSub = callService.subscribeToCallStatus(call.id, (status) => {
        if (status === 'ended' || status === 'declined' || status === 'missed' || status === 'accepted') {
          activeCallIdRef.current = null;
          statusSub.unsubscribe();
        }
      });
    };

    const sub = callService.subscribeToIncomingCalls(userId, handleIncoming);

    return () => {
      sub.unsubscribe();
      activeCallIdRef.current = null;
    };
  }, [userId, nav]);

  return null;
}