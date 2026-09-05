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
import { nativeCallService } from '../services/nativeCallService';
import { useAuthStore } from '../stores/authStore';
import { callService, CallRecord } from '../services/callService';
import { supabase } from '../services/supabase';
import { View, Text, TouchableOpacity, Image, Vibration, StyleSheet, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallContext } from '../contexts/CallContext';
import { audioService } from '../services/audioService';
import { setActiveCallNavId, clearCallNavGuard, isCallNavActive } from '../services/notificationBootstrap';

export default function IncomingCallListener() {
  const nav = useNavigation<any>();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;
  const insets = useSafeAreaInsets();
  const { callState, startCall, endCall } = useCallContext();
  const callStateRef = useRef(callState);
  useEffect(() => { callStateRef.current = callState; }, [callState]);

  // Dormant until the CallKit build: the OS lock-screen answer/decline route.
  // BUILD DAY: polish caller display names here; today this never runs.
  useEffect(() => {
    if (!userId) return;
    nativeCallService.setup({
      onAnswer: async (uuid) => {
        try {
          const call: any = await callService.getCall(uuid);
          if (!call) return;
          handledCallIdsRef.current.add(uuid);
          clearCallNavGuard();
          // The real name and face, the same lookup the in-app banner does.
          let name = call.is_group_call ? 'Group call' : 'Call';
          let avatar: string | null = null;
          try {
            if (call.is_group_call && call.conversation_id) {
              const { data: conv } = await supabase.from('conversations').select('group_name').eq('id', call.conversation_id).maybeSingle();
              if (conv?.group_name) name = conv.group_name;
            } else if (call.caller_id) {
              const { data: p } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', call.caller_id).maybeSingle();
              if (p?.full_name) name = p.full_name;
              avatar = p?.avatar_url ?? null;
            }
          } catch {}
          startCall({
            callId: uuid,
            channelId: call.channel_id || call.agora_channel || '',
            otherUserId: call.caller_id || '',
            otherUserName: name,
            otherUserAvatar: avatar,
            isVideo: !!call.is_video,
            isIncoming: true,
            isGroupCall: !!call.is_group_call,
            conversationId: call.conversation_id ?? null,
          });
          nav.navigate('Call', {
            callId: uuid,
            channelId: call.channel_id || call.agora_channel || '',
            callerName: name,
            callerAvatar: avatar,
            otherUser: { id: call.caller_id, full_name: name, avatar_url: avatar },
            isIncoming: true,
            isVideo: !!call.is_video,
            fromContext: true,
            isGroupCall: !!call.is_group_call,
            conversationId: call.conversation_id,
          });
        } catch (e: any) { console.log('[NativeCalls] answer route failed:', e?.message); }
      },
      onEnd: (uuid) => {
        try {
          // The OS end button ends the real call when one is running, and
          // declines a ringing one.
          if (callStateRef.current !== 'idle') { endCall(); return; }
          supabase.rpc('decline_group_call', { p_session_id: uuid }).then(() => {}, () => {});
          callService.declineCall(uuid).catch(() => {});
        } catch {}
      },
    });

    // A VoIP push arriving is what rings a locked or killed iPhone. Reporting
    // it to CallKit is mandatory, so this is registered right beside setup.
    nativeCallService.listenForVoipPushes((callId) => {
      handledCallIdsRef.current.add(callId);
    });
  }, [userId, nav, startCall, endCall]);
  const activeCallIdRef = useRef<string | null>(null);
  const [banner, setBanner] = useState<{ callId: string; navParams: any; name: string; avatar: string | null; isGroup: boolean; isVideo: boolean } | null>(null);
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
      if (callStateRef.current !== 'idle') { handledCallIdsRef.current.add(call.id); return; } // busy: call waiting is a Phase B item
      // On iPhones with CallKit the VoIP push rings this call natively. Give
      // it a moment and only fall back to the in-app banner if no push came.
      if (Platform.OS === 'ios' && nativeCallService.available()) {
        await new Promise(r => setTimeout(r, 1500));
        if (handledCallIdsRef.current.has(call.id)) return;
      }

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
      if ((fresh as any).expires_at && Date.now() > new Date((fresh as any).expires_at).getTime()) {
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

      const navParams = {
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
      };
      setBanner({
        callId: call.id, navParams,
        name: call.is_group_call ? groupName : (caller?.full_name || 'Unknown'),
        avatar: call.is_group_call ? null : (caller?.avatar_url || null),
        isGroup: call.is_group_call, isVideo: call.is_video,
      });
      try { Vibration.vibrate([0, 400, 800], true); } catch {}
      setTimeout(() => {
        if (bannerRef.current?.callId === call.id) {
          clearBanner();
          activeCallIdRef.current = null;
          clearCallNavGuard();
        }
      }, 45000);

      const subUid = `${call.id}_listener_${Date.now()}`;
      const statusSub = supabase.channel(`call_status_${subUid}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `id=eq.${call.id}` },
          (payload) => {
            const st = (payload.new as any).status;
            if (st === 'ended' || st === 'declined' || st === 'missed' || (st === 'active' && !call.is_group_call)) {
              if (bannerRef.current?.callId === call.id) clearBanner();
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

  if (!banner) return null;
  return (
    <TouchableOpacity
      style={[st.wrap, { top: insets.top + 6 }]}
      activeOpacity={0.92}
      onPress={() => {
        const b = banner; if (!b) return;
        setBanner(null);
        try { Vibration.cancel(); } catch {}
        nav.navigate('IncomingCall', b.navParams);
      }}
    >
      {banner.avatar
        ? <Image source={{ uri: banner.avatar }} style={st.avatar} />
        : <View style={[st.avatar, st.avatarFb]}><Feather name={banner.isGroup ? 'users' : 'user'} size={18} color="#FFF" /></View>}
      <View style={st.mid}>
        <Text style={st.name} numberOfLines={1}>{banner.name}</Text>
        <Text style={st.sub}>Incoming {banner.isVideo ? 'video' : 'voice'} call</Text>
      </View>
      <TouchableOpacity
        style={[st.circle, st.decline]}
        activeOpacity={0.8}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        onPress={() => {
          const b = banner; if (!b) return;
          clearBanner();
          if (b.isGroup) { supabase.rpc('decline_group_call', { p_session_id: b.callId }).then(() => {}, () => {}); }
          else { callService.declineCall(b.callId).catch(() => {}); }
          activeCallIdRef.current = null;
          clearCallNavGuard();
        }}
      >
        <Feather name="phone-off" size={16} color="#FFF" />
      </TouchableOpacity>
      <TouchableOpacity
        style={[st.circle, st.accept]}
        activeOpacity={0.8}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        onPress={() => {
          const b = banner; if (!b) return;
          clearBanner();
          clearCallNavGuard();
          startCall({
            callId: b.navParams.callId, channelId: b.navParams.channelId,
            otherUserId: b.navParams.otherUser?.id || '',
            otherUserName: b.isGroup ? (b.navParams.groupName || 'Group Call') : b.name,
            otherUserAvatar: b.isGroup ? null : b.avatar,
            isVideo: b.isVideo, isIncoming: true, isGroupCall: b.isGroup,
            conversationId: b.navParams.conversationId ?? null,
          });
          nav.navigate('Call', {
            callId: b.navParams.callId, channelId: b.navParams.channelId,
            callerName: b.isGroup ? (b.navParams.groupName || 'Group Call') : b.name,
            callerAvatar: b.isGroup ? null : b.avatar,
            otherUser: b.navParams.otherUser,
            isIncoming: true, isVideo: b.isVideo, fromContext: true,
            isGroupCall: b.isGroup,
            groupName: b.isGroup ? b.navParams.groupName : undefined,
            conversationId: b.navParams.conversationId,
          });
        }}
      >
        <Feather name={banner.isVideo ? 'video' : 'phone'} size={16} color="#FFF" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  wrap: {
    position: 'absolute', left: 12, right: 12, zIndex: 9998,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#0B1E3D', borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFb: { backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1 },
  name: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  sub: { color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 1 },
  circle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  decline: { backgroundColor: '#EF4444' },
  accept: { backgroundColor: '#10B981' },
});