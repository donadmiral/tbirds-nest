/**
 * IncomingCallListener.tsx
 * Listens for incoming calls via call_sessions with receiver_id = me.
 * Works for both 1-on-1 and group calls (group calls insert one
 * call_sessions row per member with receiver_id set).
 *
 * Guards against ghost re-calls by tracking handled call IDs.
 * Syncs with shared call navigation guard to prevent duplicate
 * navigation when push tap handler also fires.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../stores/authStore';
import { callService, CallRecord } from '../services/callService';
import { supabase } from '../services/supabase';
import { View, Text, TouchableOpacity, Image, Vibration, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { audioService } from '../services/audioService';
import { setActiveCallNavId, clearCallNavGuard, isCallNavActive } from '../services/notificationBootstrap';

export default function IncomingCallListener() {
  const nav = useNavigation<any>();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;
  const activeCallIdRef = useRef<string | null>(null);
  const [banner, setBanner] = useState<{ call: any; name: string; avatar: string | null; isGroup: boolean } | null>(null);
  const bannerRef = useRef<any>(null);
  useEffect(() => { bannerRef.current = banner; }, [banner]);
  const clearBanner = useCallback(() => {
    setBanner(null);
    try { audioService.stopAll(); } catch {}
    try { Vibration.cancel(); } catch {}
  }, []);
  const handledCallIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;

    console.log('[CALL_LISTENER] Setting up subscription for user:', userId);

    const handleIncoming = async (call: CallRecord) => {
      console.log('[CALL_LISTENER] Incoming call:', call.id, 'isGroup:', call.is_group_call, 'status:', call.status);

      if (!call.caller_id) return;
      if (handledCallIdsRef.current.has(call.id)) return;
      if (activeCallIdRef.current === call.id) return;
      if (call.status !== 'ringing') return;

      // If push tap handler already handling this call, skip
      if (isCallNavActive(call.id)) {
        handledCallIdsRef.current.add(call.id);
        return;
      }

      const fresh = await callService.getCall(call.id);
      if (!fresh || fresh.status !== 'ringing') {
        handledCallIdsRef.current.add(call.id);
        return;
      }

      // Check again after fetch (push tap could have claimed it)
      if (isCallNavActive(call.id)) {
        handledCallIdsRef.current.add(call.id);
        return;
      }

      activeCallIdRef.current = call.id;
      handledCallIdsRef.current.add(call.id);

      // Set shared guard so push tap handler knows we are handling this call
      setActiveCallNavId(call.id);

      // Get caller profile
      const { data: caller } = await supabase
        .from('profiles').select('id, full_name, username, avatar_url')
        .eq('id', call.caller_id).single();

      const recheck = await callService.getCall(call.id);
      if (!recheck || recheck.status !== 'ringing') {
        activeCallIdRef.current = null;
        clearCallNavGuard();
        return;
      }

      // For group calls, get group name from conversation
      let groupName = 'Group Call';
      let groupEmoji = '\u{1F4AC}';
      if (call.is_group_call && call.conversation_id) {
        const { data: conv } = await supabase
          .from('conversations')
          .select('group_name, group_emoji')
          .eq('id', call.conversation_id)
          .maybeSingle();
        if (conv?.group_name) groupName = conv.group_name;
        if (conv?.group_emoji) groupEmoji = conv.group_emoji;
      }

      console.log('[CALL_LISTENER] Navigating to IncomingCall, isGroup:', call.is_group_call, 'group:', groupName);

      nav.navigate('IncomingCall', {
        callId: call.id,
        channelId: call.channel_id,
        callerName: caller?.full_name || 'Unknown',
        callerAvatar: caller?.avatar_url || null,
        callerUsername: caller?.username || null,
        otherUser: caller || { id: call.caller_id, full_name: 'Unknown', avatar_url: null },
        isVideo: call.is_video,
        isGroupCall: call.is_group_call,
        groupName: call.is_group_call ? groupName : undefined,
        groupEmoji: call.is_group_call ? groupEmoji : undefined,
        conversationId: call.conversation_id,
      });

      const subUid = `${call.id}_listener_${Date.now()}`;
      const statusSub = supabase.channel(`call_status_${subUid}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `id=eq.${call.id}` },
          (payload) => {
            const st = (payload.new as any).status;
            if (st === 'ended' || st === 'declined' || st === 'missed' || (st === 'active' && !call.is_group_call)) {
              activeCallIdRef.current = null;
              clearCallNavGuard();
              statusSub.unsubscribe();
            }
          })
        .subscribe();
    };

    // Single subscription handles both 1-on-1 and group calls
    const invitePoll = setInterval(async () => {
      try {
        const { data: invites } = await supabase.from('call_participants')
          .select('call_session_id, status, created_at')
          .eq('user_id', userId).eq('status', 'invited')
          .gt('created_at', new Date(Date.now() - 60000).toISOString());
        for (const inv of (invites || [])) {
          if (handledCallIdsRef.current.has(inv.call_session_id)) continue;
          const call = await callService.getCall(inv.call_session_id);
          if (call && (call.status === 'ringing' || call.status === 'active')) {
            handleIncoming({ ...call, status: 'ringing' } as any);
          }
        }
      } catch {}
    }, 8000);
    const directSub = callService.subscribeToIncomingCalls(userId, handleIncoming);

    const inviteSub = supabase.channel(`gcall_invites_${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_participants', filter: `user_id=eq.${userId}` }, async (p) => {
        const row = p.new as any;
        if (row?.status !== 'invited') return;
        const call = await callService.getCall(row.call_session_id);
        if (call && (call.status === 'ringing' || call.status === 'active')) handleIncoming({ ...call, status: 'ringing' } as any);
      })
      .subscribe();

    return () => {
      console.log('[CALL_LISTENER] Cleaning up subscription');
      clearInterval(invitePoll);
      directSub.unsubscribe();
      supabase.removeChannel(inviteSub);
      activeCallIdRef.current = null;
      clearCallNavGuard();
    };
  }, [userId, nav]);

  return null;
}