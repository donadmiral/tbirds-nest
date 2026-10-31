/** Incoming calls are resolved under the initiating account before any native or in-app action. */
import { consumeInitialCallNotification, listenForegroundCallActions, dismissIncomingCall } from '../services/androidCallNotification';
import { declineIncomingCall, readIncomingCall, withIncomingCallSession, type IncomingCallPayload, type IncomingCallSession } from '../services/incomingCallAccess';
import { navigationScope, navigationRevision, subscribeNavigationScope } from '../lib/navigationCache';
import { themedSheet } from '../theme/useTheme';
import React, { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { useNavigation } from '@react-navigation/native';
import { nativeCallService } from '../services/nativeCallService';
import { useAuthStore } from '../stores/authStore';
import { callService, type CallRecord } from '../services/callService';
import { supabase } from '../services/supabase';
import { Alert, AppState, View, Text, TouchableOpacity, Image, Vibration, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from './SafeArea';
import { useCallContext } from '../contexts/CallContext';
import { audioService } from '../services/audioService';
import { setActiveCallNavId, clearCallNavGuard, isCallNavActive } from '../services/notificationBootstrap';

type CallBanner = { callId: string; scope: string; name: string; avatar: string | null; isGroup: boolean; isVideo: boolean };

export default function IncomingCallListener() {
  const nav = useNavigation<any>();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;
  const authRevision = useSyncExternalStore(subscribeNavigationScope, navigationRevision, navigationRevision);
  const insets = useSafeAreaInsets();
  const { callState, activeCall, startCall, endCall } = useCallContext();
  const currentCallRef = useRef(activeCall), callStateRef = useRef(callState);
  useEffect(() => { currentCallRef.current = activeCall; callStateRef.current = callState; }, [activeCall, callState]);
  const activeCallIdRef = useRef<string | null>(null);
  const openingCallIdRef = useRef<string | null>(null);
  const endedCallIdsRef = useRef(new Set<string>());
  const handledCallIdsRef = useRef<Set<string>>(new Set());
  const [banner, setBanner] = useState<CallBanner | null>(null);
  const bannerRef = useRef<CallBanner | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    handledCallIdsRef.current.clear();
    endedCallIdsRef.current.clear(); openingCallIdRef.current = null;
    const pending = controllers.current;
    return () => { for (const controller of pending) controller.abort(); pending.clear(); };
  }, [authRevision]);

  const clearBanner = useCallback(() => {
    bannerRef.current = null; setBanner(null);
    if (callStateRef.current === 'idle') void audioService.stopAll().catch(() => {});
    try { Vibration.cancel(); } catch {}
  }, []);
  const clearRinging = useCallback((callId?: string) => {
    const current = activeCallIdRef.current;
    if (callId && current !== callId) return;
    activeCallIdRef.current = null;
    if (current && isCallNavActive(current)) clearCallNavGuard();
    clearBanner();
  }, [clearBanner]);
  const remember = useCallback((id: string) => {
    handledCallIdsRef.current.add(id);
    while (handledCallIdsRef.current.size > 128) handledCallIdsRef.current.delete(handledCallIdsRef.current.values().next().value!);
  }, []);
  const withOwner = useCallback(async (payload: Partial<IncomingCallPayload>, work: (session: IncomingCallSession) => Promise<void>) => {
    if (!userId || !alive.current || authRevision !== navigationRevision()) return;
    if (payload.recipientId && payload.recipientId !== userId) return;
    const scope = navigationScope(), controller = new AbortController();
    controllers.current.add(controller);
    try {
      await withIncomingCallSession({ ...payload, recipientId: userId }, async session => {
        const current = () => alive.current && session.current() && navigationScope() === scope
          && useAuthStore.getState().session?.user.id === userId;
        const ensure = () => { session.ensure(); if (!current()) throw new Error('The incoming call account changed.'); };
        ensure(); await work({ ...session, current, ensure });
      }, 15000, controller.signal);
    } finally { controllers.current.delete(controller); }
  }, [userId, authRevision]);

  const openIncoming = useCallback(async (payload: IncomingCallPayload, answer: boolean) => {
    if (endedCallIdsRef.current.has(payload.callId.toLowerCase())) return;
    await withOwner(payload, async session => {
      if (callStateRef.current !== 'idle' || endedCallIdsRef.current.has(payload.callId.toLowerCase())) return;
      const result = await readIncomingCall(payload, session);
      session.ensure();
      if (callStateRef.current !== 'idle' || endedCallIdsRef.current.has(payload.callId.toLowerCase())) return;
      if (!result) { clearRinging(payload.callId); void dismissIncomingCall(payload.callId); nativeCallService.endNativeCall(payload.callId); return; }
      const { call, payload: display } = result;
      if (isCallNavActive() && !(activeCallIdRef.current === call.id && isCallNavActive(call.id))) return;
      setActiveCallNavId(call.id);
      activeCallIdRef.current = null;
      let opened = false;
      try {
        remember(call.id); clearBanner();
        const params = { callId: call.id, channelId: call.channel_id, callerName: display.callerName,
          callerAvatar: display.callerAvatar ?? null,
          otherUser: { id: call.caller_id, full_name: display.callerName, avatar_url: display.callerAvatar ?? null },
          isVideo: call.is_video, isGroupCall: call.is_group_call, conversationId: call.conversation_id };
        if (answer) {
          openingCallIdRef.current = call.id;
          startCall({ callId: call.id, channelId: call.channel_id, otherUserId: call.caller_id,
            otherUserName: display.callerName, otherUserAvatar: display.callerAvatar ?? null,
            isVideo: call.is_video, isIncoming: true, isGroupCall: call.is_group_call,
            conversationId: call.conversation_id });
          nav.navigate('Call', { ...params, fromContext: true, isIncoming: true });
        } else nav.navigate('IncomingCall', params);
        opened = true; void dismissIncomingCall(call.id);
      } finally {
        if (!opened) {
          if (openingCallIdRef.current === call.id) openingCallIdRef.current = null;
          if (isCallNavActive(call.id)) clearCallNavGuard();
        }
      }
    });
  }, [withOwner, remember, clearBanner, clearRinging, startCall, nav]);

  const decline = useCallback(async (payload: IncomingCallPayload) => {
    await withOwner(payload, async session => {
      const done = await declineIncomingCall({ ...payload, recipientId: session.userId }, session.request.signal);
      session.ensure();
      if (!done) throw new Error('The call could not be declined. Please retry.');
      clearRinging(payload.callId);
      await dismissIncomingCall(payload.callId);
    });
  }, [withOwner, clearRinging]);

  useEffect(() => {
    if (!userId) return;
    let disposed = false, sawLive = false;
    const off = listenForegroundCallActions((payload, action) => {
      sawLive = true;
      if (disposed) return;
      void (action === 'decline' ? decline(payload) : openIncoming(payload, action === 'answer')).catch(() => {});
    });
    void consumeInitialCallNotification().then(initial => {
      if (initial && !disposed && !sawLive) return openIncoming(initial.payload, initial.answer);
    }).catch(() => {});
    return () => { disposed = true; off(); };
  }, [userId, openIncoming, decline]);

  useEffect(() => {
    if (!userId) return;
    let disposed = false;
    const scope = navigationScope();
    const current = () => !disposed && alive.current && scope === navigationScope() && useAuthStore.getState().session?.user.id === userId;
    const offNative = nativeCallService.listen({
      onAnswer: async uuid => { if (current()) await openIncoming({ callId: uuid, callerName: 'Call', recipientId: userId }, true).catch(() => {}); },
      onEnd: uuid => {
        if (!current()) return;
        const id = uuid.toLowerCase();
        endedCallIdsRef.current.add(id);
        while (endedCallIdsRef.current.size > 128) endedCallIdsRef.current.delete(endedCallIdsRef.current.values().next().value!);
        if (openingCallIdRef.current === id || (currentCallRef.current?.callId?.toLowerCase() === id && callStateRef.current !== 'idle')) {
          openingCallIdRef.current = null; endCall(); return;
        }
        void decline({ callId: uuid, callerName: 'Call', recipientId: userId }).catch(() => {});
      },
    });
    // PushKit has already reported the mandatory native call before JavaScript runs.
    const offVoip = nativeCallService.listenForVoipPushes((id, recipientId) => { if (current() && (!recipientId || recipientId === userId)) remember(id); });
    return () => { disposed = true; offNative(); offVoip(); };
  }, [userId, authRevision, openIncoming, decline, endCall, remember]);

  useEffect(() => {
    if (!userId) return;
    let disposed = false, recovering = false, recoveringGroups = false;
    const scope = navigationScope();
    const current = () => !disposed && scope === navigationScope() && useAuthStore.getState().session?.user.id === userId;
    const mayReceive = () => current() && callStateRef.current === 'idle';
    const statusSubscriptions = new Set<ReturnType<typeof supabase.channel>>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const waitForNative = (session: IncomingCallSession) => new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); timers.delete(timer); session.request.signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, 1500); timers.add(timer);
      session.request.signal.addEventListener('abort', finish, { once: true });
      if (session.request.signal.aborted) finish();
    });
    const handleIncoming = async (candidate: CallRecord) => {
      if (!candidate.caller_id || !mayReceive() || handledCallIdsRef.current.has(candidate.id) || activeCallIdRef.current) return;
      await withOwner({ callId: candidate.id }, async session => {
        if (Platform.OS === 'ios' && nativeCallService.available()) await waitForNative(session);
        session.ensure();
        if (!mayReceive() || handledCallIdsRef.current.has(candidate.id) || activeCallIdRef.current || isCallNavActive()) return;
        const payload = { callId: candidate.id, callerName: 'Call', recipientId: userId };
        const result = await readIncomingCall(payload, session);
        session.ensure();
        if (!result || !mayReceive() || handledCallIdsRef.current.has(candidate.id) || activeCallIdRef.current || isCallNavActive()) return;
        const { call, payload: display } = result;
        activeCallIdRef.current = call.id; setActiveCallNavId(call.id); remember(call.id);
        const next: CallBanner = { callId: call.id, scope: scope!, name: display.callerName,
          avatar: display.callerAvatar ?? null, isGroup: call.is_group_call, isVideo: call.is_video };
        bannerRef.current = next; setBanner(next);
        try { Vibration.vibrate([0, 400, 800], true); } catch {}
        const remaining = Math.max(1, Math.min(45000, (display.expiresAt ?? Date.now() + 45000) - Date.now()));
        const timer = setTimeout(() => { timers.delete(timer); if (current()) clearRinging(call.id); }, remaining);
        timers.add(timer);
        const statusSub = supabase.channel(`call_status_${call.id}_listener_${Date.now()}`)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `id=eq.${call.id}` }, event => {
            if (!current()) return;
            const status = event.new.status;
            if (['ended', 'declined', 'missed'].includes(status) || (status === 'active' && !call.is_group_call)) {
              clearRinging(call.id);
              if (status !== 'active') nativeCallService.endNativeCall(call.id);
              statusSub.unsubscribe(); statusSubscriptions.delete(statusSub);
            }
          }).subscribe();
        statusSubscriptions.add(statusSub);
      });
    };
    const receive = (call: CallRecord) => { void handleIncoming(call).catch(() => {}); };
    const recoverIncoming = async () => {
      if (!mayReceive() || recovering) return;
      recovering = true;
      try { await withOwner({}, async session => {
        const calls = await callService.listRingingCalls(userId, session.request);
        session.ensure(); if (mayReceive()) calls.forEach(receive);
      }); } catch {} finally { recovering = false; }
    };
    const recoverGroupInvites = async () => {
      if (!mayReceive() || recoveringGroups) return;
      recoveringGroups = true;
      try { await withOwner({}, async session => {
        const { data, error } = await supabase.from('call_participants').select('call_session_id')
          .eq('user_id', userId).eq('status', 'invited').gt('created_at', new Date(Date.now() - 45000).toISOString())
          .order('created_at', { ascending: false }).limit(20)
          .setHeader('Authorization', `Bearer ${session.request.accessToken}`).abortSignal(session.request.signal);
        session.ensure(); if (error) throw error;
        for (const row of data || []) {
          if (!mayReceive()) return;
          if (handledCallIdsRef.current.has(row.call_session_id)) continue;
          const call = await callService.getCall(row.call_session_id, session.request);
          session.ensure(); if (call) receive(call);
        }
      }); } catch {} finally { recoveringGroups = false; }
    };
    const directSub = callService.subscribeToIncomingCalls(userId, receive, () => { void recoverIncoming(); });
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active') { void recoverIncoming(); void recoverGroupInvites(); }
    });
    const inviteSub = supabase.channel(`gcall_invites_${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${userId}` }, event => {
        const message = event.new;
        if (!current() || !message.id || message.sender_id === userId) return;
        void withOwner({}, async session => {
          const { error } = await supabase.from('messages').update({ delivered_at: new Date().toISOString() })
            .eq('id', message.id).eq('receiver_id', userId).is('delivered_at', null)
            .setHeader('Authorization', `Bearer ${session.request.accessToken}`).abortSignal(session.request.signal);
          session.ensure(); if (error) throw error;
        }).catch(() => {});
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_participants', filter: `user_id=eq.${userId}` }, event => {
        if (!current() || event.new.status !== 'invited') return;
        void withOwner({ callId: event.new.call_session_id }, async session => {
          const call = await callService.getCall(event.new.call_session_id, session.request);
          session.ensure(); if (call && mayReceive()) receive(call);
        }).catch(() => {});
      }).subscribe(status => { if (status === 'SUBSCRIBED') void recoverGroupInvites(); });
    void recoverIncoming(); void recoverGroupInvites();
    return () => {
      disposed = true; foreground.remove(); directSub.unsubscribe(); supabase.removeChannel(inviteSub);
      for (const sub of statusSubscriptions) sub.unsubscribe();
      for (const timer of timers) clearTimeout(timer);
      clearRinging();
    };
  }, [userId, authRevision, withOwner, remember, clearRinging]);

  const bannerAction = (answer: boolean) => {
    if (!banner || banner.scope !== navigationScope()) return;
    void openIncoming({ callId: banner.callId, callerName: banner.name, recipientId: userId! }, answer)
      .catch(() => { if (alive.current && bannerRef.current?.callId === banner.callId) Alert.alert('Call unavailable', 'This call could not open. Please try again.'); });
  };
  const declineBanner = () => {
    if (!banner || banner.scope !== navigationScope()) return;
    void decline({ callId: banner.callId, callerName: banner.name, recipientId: userId! })
      .catch(() => { if (alive.current && bannerRef.current?.callId === banner.callId) Alert.alert('Could not decline', 'Check your connection and try again.'); });
  };
  if (!banner || banner.scope !== navigationScope()) return null;
  return (
    <TouchableOpacity
      style={[st.wrap, { top: insets.top + 6 }]}
      activeOpacity={0.92}
      accessibilityRole="button"
      accessibilityLabel={`Open incoming ${banner.isVideo ? 'video' : 'voice'} call from ${banner.name}`}
      onPress={() => bannerAction(false)}
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
        accessibilityRole="button"
        accessibilityLabel="Decline incoming call"
        onPress={declineBanner}
      >
        <Feather name="phone-off" size={16} color="#FFF" />
      </TouchableOpacity>
      <TouchableOpacity
        style={[st.circle, st.accept]}
        activeOpacity={0.8}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel="Answer incoming call"
        onPress={() => bannerAction(true)}
      >
        <Feather name={banner.isVideo ? 'video' : 'phone'} size={16} color="#FFF" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const st = themedSheet((t) => ({
  wrap: {
    position: 'absolute', left: 12, right: 12, zIndex: 9998,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.brand.base, borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFb: { backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1 },
  name: { color: t.ink.inverse, fontSize: 15, fontWeight: '700' },
  sub: { color: t.ink.inverse, fontSize: 12, marginTop: 1 },
  circle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  decline: { backgroundColor: '#EF4444' },
  accept: { backgroundColor: '#10B981' },
}));
