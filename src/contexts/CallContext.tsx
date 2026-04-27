/**
 * CallContext.tsx
 *
 * endCall guarded by single ref. Runs exactly once.
 * After DB status update, calls callService.recordCallEvent(callId)
 * which invokes the backend RPC. No frontend message insertion.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import Daily, {
  DailyCall, DailyEvent, DailyEventObjectParticipant, DailyParticipant,
} from '@daily-co/react-native-daily-js';
import { Audio } from 'expo-av';
import { callService, CallStatus } from '../services/callService';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';

let outgoingRingAsset: any = null;
try { outgoingRingAsset = require('../assets/sounds/outgoing-ring.mp3'); } catch {}

export type CallState = 'idle' | 'initiating' | 'ringing' | 'connecting' | 'active' | 'ending';

export type ActiveCallInfo = {
  callId: string | null;
  channelId: string;
  otherUserId: string;
  otherUserName: string;
  otherUserAvatar: string | null;
  isVideo: boolean;
  isIncoming: boolean;
};

type CallContextType = {
  callState: CallState;
  activeCall: ActiveCallInfo | null;
  elapsed: number;
  muted: boolean;
  videoOff: boolean;
  held: boolean;
  connected: boolean;
  dailyReady: boolean;
  errorMsg: string | null;
  localParticipant: DailyParticipant | null;
  remoteParticipant: DailyParticipant | null;
  wasEverActive: boolean;
  startCall: (p: ActiveCallInfo) => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleHold: () => void;
  flipCamera: () => Promise<void>;
  clearCallState: () => void;
};

const CallContext = createContext<CallContextType>({
  callState: 'idle', activeCall: null, elapsed: 0,
  muted: false, videoOff: false, held: false,
  connected: false, dailyReady: false, errorMsg: null,
  localParticipant: null, remoteParticipant: null, wasEverActive: false,
  startCall: () => {}, endCall: () => {}, clearCallState: () => {},
  toggleMute: () => {}, toggleVideo: () => {}, toggleHold: () => {},
  flipCamera: async () => {},
});

export function useCallContext() { return useContext(CallContext); }

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuthStore();
  const myId = profile?.id ?? null;

  const [callState, setCallState] = useState<CallState>('idle');
  const [activeCall, setActiveCall] = useState<ActiveCallInfo | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [held, setHeld] = useState(false);
  const [connected, setConnected] = useState(false);
  const [dailyReady, setDailyReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [localParticipant, setLocalParticipant] = useState<DailyParticipant | null>(null);
  const [remoteParticipant, setRemoteParticipant] = useState<DailyParticipant | null>(null);
  const [wasEverActive, setWasEverActive] = useState(false);

  const callObjRef = useRef<DailyCall | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStartMsRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const endedRef = useRef(false);
  const outgoingSoundRef = useRef<Audio.Sound | null>(null);
  const statusSubRef = useRef<any>(null);
  const callIdRef = useRef<string | null>(null);
  const activeCallRef = useRef<ActiveCallInfo | null>(null);
  const myIdRef = useRef<string | null>(null);

  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => { myIdRef.current = myId; }, [myId]);

  const stopOutgoingRing = useCallback(() => {
    if (outgoingSoundRef.current) {
      outgoingSoundRef.current.stopAsync().catch(() => {});
      outgoingSoundRef.current.unloadAsync().catch(() => {});
      outgoingSoundRef.current = null;
    }
  }, []);

  const startOutgoingRing = useCallback(async () => {
    if (!outgoingRingAsset) return;
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, staysActiveInBackground: false, shouldDuckAndroid: true });
      const { sound } = await Audio.Sound.createAsync(outgoingRingAsset, { isLooping: true, shouldPlay: true, volume: 0.7 });
      outgoingSoundRef.current = sound;
    } catch {}
  }, []);

  const clearCallState = useCallback(() => {
    endedRef.current = false;
    setCallState('idle');
    setActiveCall(null);
    setWasEverActive(false);
    setElapsed(0); setMuted(false); setVideoOff(false); setHeld(false);
    setConnected(false); setDailyReady(false); setErrorMsg(null);
    setLocalParticipant(null); setRemoteParticipant(null);
    callIdRef.current = null; callStartMsRef.current = null; elapsedRef.current = 0;
  }, []);

  const refreshParticipants = useCallback((call: DailyCall) => {
    try {
      const ps = call.participants();
      setLocalParticipant(ps.local ?? null);
      let remote: DailyParticipant | null = null;
      for (const key of Object.keys(ps)) { if (key !== 'local') { remote = (ps as any)[key]; break; } }
      setRemoteParticipant(remote);
    } catch {}
  }, []);

  const endCall = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;

    setCallState('ending');
    stopOutgoingRing();

    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    if (statusSubRef.current) {
      try { statusSubRef.current.unsubscribe(); } catch {}
      statusSubRef.current = null;
    }

    const call = callObjRef.current;
    const cid = callIdRef.current;
    const wallStart = callStartMsRef.current;
    const elapsedSecs = elapsedRef.current;

    callObjRef.current = null;

    const cleanup = async () => {
      // 1. Leave and destroy Daily
      if (call) {
        try { await call.leave(); } catch {}
        try { call.destroy(); } catch {}
      }

      // 2. Update DB status, then call RPC
      if (cid) {
        try {
          const wall = wallStart ? Math.floor((Date.now() - wallStart) / 1000) : 0;
          const duration = Math.max(elapsedSecs, wall);

          // Read current DB status. If already declined, do not overwrite.
          const currentRecord = await callService.getCall(cid);
          const dbStatus = currentRecord?.status;

          if (dbStatus === 'declined') {
            // Already set by the receiver. Leave it.
            console.log('[CALL_END] Status already declined, skipping DB update');
          } else if (duration > 0) {
            await callService.endCall(cid, duration);
          } else {
            await callService.markMissed(cid);
          }

          // 3. Call backend RPC to insert call event message.
          //    The RPC reads the final DB state, so it always gets
          //    the correct status (ended/missed/declined).
          //    Deduplication is handled server-side.
          await callService.recordCallEvent(cid);

        } catch (e: any) { console.log('[CALL_END_DB_ERR]', e?.message); }
      }

      // 4. Reset UI state
      setCallState('idle');
      setActiveCall(null); setElapsed(0);
      setMuted(false); setVideoOff(false); setHeld(false);
      setConnected(false); setDailyReady(false); setErrorMsg(null);
      setLocalParticipant(null); setRemoteParticipant(null);
      callIdRef.current = null; callStartMsRef.current = null; elapsedRef.current = 0;
      // endedRef stays true. wasEverActive stays true.
      // CallScreen uses wasEverActive to detect end and goBack.
      // clearCallState resets both after navigation completes.
    };

    cleanup();
  }, [stopOutgoingRing]);

  const startCall = useCallback((params: ActiveCallInfo) => {
    if (endedRef.current) return;
    if (callState !== 'idle') return;

    endedRef.current = false;
    setCallState('initiating');
    setWasEverActive(true);
    setActiveCall(params);
    setVideoOff(!params.isVideo);
    setMuted(false); setHeld(false); setConnected(false);
    setDailyReady(false); setErrorMsg(null); setElapsed(0);

    doStartCall(params);
  }, [callState]);

  const doStartCall = async (params: ActiveCallInfo) => {
    try {
      if (Platform.OS === 'android') {
        const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
        if (params.isVideo) perms.push(PermissionsAndroid.PERMISSIONS.CAMERA);
        await PermissionsAndroid.requestMultiple(perms);
      }

      let callId = params.callId;

      if (!callId && !params.isIncoming && myIdRef.current) {
        const mid = myIdRef.current;
        const sinceIso = new Date(Date.now() - 15000).toISOString();
        for (let attempt = 0; attempt < 6; attempt++) {
          const { data } = await supabase.from('call_sessions').select('id')
            .eq('initiator_id', mid).eq('agora_channel', params.channelId)
            .eq('receiver_id', params.otherUserId).eq('status', 'ringing')
            .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (data?.id) { callId = data.id; break; }
          await new Promise(r => setTimeout(r, 400));
        }
        if (!callId) {
          const rec = await callService.initiateCall({
            callerId: mid, receiverId: params.otherUserId,
            channelId: params.channelId, isVideo: params.isVideo,
          });
          callId = rec?.id ?? null;
        }
      }

      if (!callId) { setErrorMsg('Could not establish call'); setCallState('idle'); endedRef.current = false; return; }
      if (endedRef.current) return;

      callIdRef.current = callId;
      setActiveCall(prev => prev ? { ...prev, callId } : prev);

      if (!params.isIncoming) { setCallState('ringing'); await startOutgoingRing(); }
      else { setCallState('connecting'); }

      const subUid = `${callId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      statusSubRef.current = supabase.channel(`call_status_${subUid}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `id=eq.${callId}` },
          (payload) => {
            const st = (payload.new as any).status;
            if (st === 'declined' || st === 'missed' || st === 'ended') {
              stopOutgoingRing();
              endCall();
            }
          })
        .subscribe();

      const { roomUrl, token } = await callService.getDailyToken({
        callSessionId: callId, isOwner: !params.isIncoming, kind: 'call',
      });
      if (endedRef.current) return;

      const call = Daily.createCallObject({
        audioSource: true, videoSource: params.isVideo,
        startVideoOff: false, startAudioOff: false,
      } as any);
      callObjRef.current = call;

      call.on('joined-meeting' as DailyEvent, () => {
        setDailyReady(true);
        if (params.isVideo) { try { call.setLocalVideo(true); } catch {} }
        try { call.setLocalAudio(true); } catch {}
        refreshParticipants(call);
        if (params.isIncoming) {
          setConnected(true); setCallState('active');
          if (!timerRef.current) {
            callStartMsRef.current = Date.now(); elapsedRef.current = 0; setElapsed(0);
            timerRef.current = setInterval(() => { elapsedRef.current += 1; setElapsed(elapsedRef.current); }, 1000);
          }
        }
      });

      call.on('participant-joined' as DailyEvent, (ev: DailyEventObjectParticipant | any) => {
        refreshParticipants(call);
        if (ev?.participant?.local) return;
        setConnected(true); setCallState('active');
        stopOutgoingRing();
        if (!timerRef.current) {
          callStartMsRef.current = Date.now(); elapsedRef.current = 0; setElapsed(0);
          timerRef.current = setInterval(() => { elapsedRef.current += 1; setElapsed(elapsedRef.current); }, 1000);
        }
        if (callIdRef.current && !params.isIncoming) callService.acceptCall(callIdRef.current);
      });

      call.on('participant-updated' as DailyEvent, () => refreshParticipants(call));

      call.on('participant-left' as DailyEvent, (ev: DailyEventObjectParticipant | any) => {
        if (ev?.participant?.local) return;
        endCall();
      });

      call.on('track-started' as DailyEvent, () => refreshParticipants(call));
      call.on('track-stopped' as DailyEvent, () => refreshParticipants(call));
      call.on('error' as DailyEvent, (ev: any) => { setErrorMsg(ev?.errorMsg || ev?.error?.message || 'Call error'); });

      await call.join({ url: roomUrl, token, userName: profile?.full_name || 'User' });
    } catch (e: any) {
      if (!endedRef.current) { setErrorMsg(e?.message || 'Could not connect'); }
    }
  };

  const toggleMute = useCallback(() => {
    const call = callObjRef.current; if (!call) return;
    setMuted(prev => { call.setLocalAudio(prev); return !prev; });
  }, []);

  const toggleVideo = useCallback(() => {
    const call = callObjRef.current; if (!call) return;
    setVideoOff(prev => { call.setLocalVideo(prev); return !prev; });
  }, []);

  const toggleHold = useCallback(() => {
    const call = callObjRef.current; if (!call) return;
    setHeld(prev => {
      call.setLocalAudio(prev);
      if (activeCallRef.current?.isVideo) call.setLocalVideo(prev);
      return !prev;
    });
  }, []);

  const flipCamera = useCallback(async () => {
    const call = callObjRef.current; if (!call) return;
    try { await call.cycleCamera(); } catch {}
  }, []);

  return (
    <CallContext.Provider value={{
      callState, activeCall, elapsed, muted, videoOff, held,
      connected, dailyReady, errorMsg, localParticipant, remoteParticipant,
      wasEverActive, startCall, endCall, clearCallState,
      toggleMute, toggleVideo, toggleHold, flipCamera,
    }}>
      {children}
    </CallContext.Provider>
  );
}