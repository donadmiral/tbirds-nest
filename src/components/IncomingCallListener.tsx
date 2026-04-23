/**
 * IncomingCallListener
 * Mounts at app root, subscribes to incoming call_sessions for the logged-in user.
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
    if (!userId) {
      console.log('[INCOMING_LISTENER] no userId, skipping');
      return;
    }
    console.log('[INCOMING_LISTENER_MOUNTED] userId:', userId);

    const handleIncoming = async (call: CallRecord) => {
      console.log('[INCOMING_LISTENER_EVENT] received call:', call.id);
      if (!call.caller_id) return;
      if (activeCallIdRef.current === call.id) return;
      activeCallIdRef.current = call.id;

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

      const statusSub = callService.subscribeToCallStatus(call.id, (status) => {
        if (status === 'ended' || status === 'declined' || status === 'missed' || status === 'active') {
          activeCallIdRef.current = null;
          statusSub.unsubscribe();
        }
      });
    };

    const sub = callService.subscribeToIncomingCalls(userId, handleIncoming);

    return () => {
      console.log('[INCOMING_LISTENER_UNMOUNT]');
      sub.unsubscribe();
      activeCallIdRef.current = null;
    };
  }, [userId, nav]);

  return null;
}