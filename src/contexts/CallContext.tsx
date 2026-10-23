/**
 * CallContext.tsx
 *
 * Central call state machine. Single source of truth for all call state.
 *
 * States: IDLE → INITIATING → RINGING → CONNECTING → ACTIVE → ENDING → IDLE
 *                                                      ↕         ↕
 *                                               DEGRADED    RECONNECTING
 *         Any state → FAILED → IDLE
 *
 * DEGRADED: poor network, media still flowing but quality reduced.
 * RECONNECTING: network dropped, attempting recovery.
 *
 * Rules:
 *  - All transitions go through transitionTo()
 *  - No direct setState from UI
 *  - No boolean flags controlling logic — only state drives behavior
 *  - Audio managed exclusively via audioService
 *  - One subscription per call, always cleaned on ENDING/FAILED
 *  - 45s timeout in RINGING state
 *  - RECONNECTING on network drop, FAILED after 30s timeout
 *  - Action lock prevents rapid duplicate user actions
 *  - Timer uses wall-clock timestamps, not interval increments
 *
 * Supports 1-on-1 and group calls.
 * Does NOT change callService.ts or the DB model.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { Alert, AppState, Platform, PermissionsAndroid } from 'react-native';
import { Camera } from 'expo-camera';
import Daily, {
  DailyCall, DailyEvent, DailyEventObjectParticipant, DailyParticipant,
} from '@daily-co/react-native-daily-js';
import { callService, CallStatus } from '../services/callService';
import { audioService } from '../services/audioService';
import { nativeCallService } from '../services/nativeCallService';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { flushNativeCallCloses, queueNativeCallClose, settleCallOperation } from '../services/nativeCallRecovery';

// ── State Machine Types ─────────────────────────────────────────────────────

export type CallState =
  | 'idle'
  | 'initiating'
  | 'ringing'
  | 'connecting'
  | 'active'
  | 'degraded'
  | 'reconnecting'
  | 'ending'
  | 'failed';

export type ActiveCallInfo = {
  callId: string | null;
  channelId: string;
  otherUserId: string;
  otherUserName: string;
  otherUserAvatar: string | null;
  isVideo: boolean;
  isIncoming: boolean;
  isGroupCall: boolean;
  conversationId: string | null;
};

// ── Valid Transitions ───────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<CallState, CallState[]> = {
  idle:         ['initiating'],
  initiating:   ['ringing', 'connecting', 'ending', 'failed'],
  ringing:      ['connecting', 'active', 'ending', 'failed'],
  connecting:   ['active', 'ending', 'failed'],
  active:       ['degraded', 'reconnecting', 'ending'],
  degraded:     ['active', 'reconnecting', 'ending'],
  reconnecting: ['active', 'ending', 'failed'],
  ending:       ['idle'],
  failed:       ['idle'],
};

// ── Context Type ────────────────────────────────────────────────────────────

type CallContextType = {
  callState: CallState;
  activeCall: ActiveCallInfo | null;
  elapsed: number;
  muted: boolean;
  videoOff: boolean;
  held: boolean;
  speakerOn: boolean;
  networkQuality: 'excellent' | 'good' | 'low' | 'very-low' | null;
  connected: boolean;
  dailyReady: boolean;
  errorMsg: string | null;
  localParticipant: DailyParticipant | null;
  remoteParticipant: DailyParticipant | null;
  remoteParticipants: DailyParticipant[];
  wasEverActive: boolean;
  startCall: (p: ActiveCallInfo) => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  remoteHeld: boolean;
  toggleHold: () => void;
  toggleSpeaker: () => void;
  flipCamera: () => Promise<void>;
  clearCallState: () => void;
};

const CallContext = createContext<CallContextType>({
  callState: 'idle', activeCall: null, elapsed: 0,
  muted: false, videoOff: false, held: false, remoteHeld: false, speakerOn: false,
  networkQuality: null,
  connected: false, dailyReady: false, errorMsg: null,
  localParticipant: null, remoteParticipant: null, remoteParticipants: [],
  wasEverActive: false,
  startCall: () => {}, endCall: () => {}, clearCallState: () => {},
  toggleMute: () => {}, toggleVideo: () => {}, toggleHold: () => {},
  toggleSpeaker: () => {}, flipCamera: async () => {},
});

export function useCallContext() { return useContext(CallContext); }

// ── Provider ────────────────────────────────────────────────────────────────

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuthStore();
  const myId = profile?.id ?? null;

  // ── State ───────────────────────────────────────────────────────────────

  const [callState, setCallState] = useState<CallState>('idle');
  const [activeCall, setActiveCall] = useState<ActiveCallInfo | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [held, setHeld] = useState(false);
  const [remoteHeld, setRemoteHeld] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<'excellent' | 'good' | 'low' | 'very-low' | null>(null);
  const [connected, setConnected] = useState(false);
  const [dailyReady, setDailyReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [localParticipant, setLocalParticipant] = useState<DailyParticipant | null>(null);
  const [remoteParticipant, setRemoteParticipant] = useState<DailyParticipant | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<DailyParticipant[]>([]);
  const [wasEverActive, setWasEverActive] = useState(false);

  // ── Refs (stable across renders) ────────────────────────────────────────


  const callObjRef = useRef<DailyCall | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStartMsRef = useRef<number | null>(null);
  const stateRef = useRef<CallState>('idle');
  const activeCallRef = useRef<ActiveCallInfo | null>(null);
  const myIdRef = useRef<string | null>(null);
  const callIdRef = useRef<string | null>(null);
  const groupIdentityRef = useRef<string | undefined>(undefined);
  const hbRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusSubRef = useRef<any>(null);
  const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const degradedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endingRef = useRef(false);
  const actionLockRef = useRef(false);
  const attemptRef = useRef(0);
  const mediaIntentRef = useRef({ muted: false, videoOff: true, held: false, speaker: false });
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep refs in sync
  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);
  useEffect(() => { myIdRef.current = myId; }, [myId]);
  useEffect(() => { stateRef.current = callState; }, [callState]);

  // ── Transition Function ─────────────────────────────────────────────────
  // ALL state changes go through here. No exceptions.

  const transitionTo = useCallback((next: CallState, reason?: string) => {
    const current = stateRef.current;
    const allowed = VALID_TRANSITIONS[current];

    if (!allowed.includes(next)) {
      console.log('[CallState] BLOCKED:', current, '→', next, reason || '');
      return false;
    }

    console.log('[CallState]', current, '→', next, reason || '');
    stateRef.current = next;
    setCallState(next);
    return true;
  }, []);

  // ── Cleanup Helpers ─────────────────────────────────────────────────────

  const clearRingingTimeout = useCallback(() => {
    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const clearDegradedTimeout = useCallback(() => {
    if (degradedTimeoutRef.current) {
      clearTimeout(degradedTimeoutRef.current);
      degradedTimeoutRef.current = null;
    }
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanupSubscription = useCallback(() => {
    if (statusSubRef.current) {
      try { statusSubRef.current.unsubscribe(); } catch {}
      statusSubRef.current = null;
    }
  }, []);

  // ── Participant Handling ─────────────────────────────────────────────────
  // Sets remoteParticipant to the active speaker for group calls,
  // or the single remote for 1-on-1 calls.

  const refreshParticipants = useCallback((call: DailyCall) => {
    try {
      const ps = call.participants();
      setLocalParticipant(ps.local ?? null);
      const remotes: DailyParticipant[] = [];
      for (const key of Object.keys(ps)) {
        if (key !== 'local') remotes.push((ps as any)[key]);
      }
      setRemoteParticipants(remotes);

      if (remotes.length <= 1) {
        setRemoteParticipant(remotes[0] ?? null);
      } else {
        // Group call: prefer participant with playable audio (likely speaking)
        const withAudio = remotes.find(p => {
          const tracks = (p as any).tracks;
          return tracks?.audio?.state === 'playable';
        });
        setRemoteParticipant(withAudio ?? remotes[0] ?? null);
      }
    } catch {}
  }, []);

  // ── Timer (wall-clock based) ────────────────────────────────────────────
  // Uses Date.now() diff instead of incrementing a counter.
  // Immune to interval drift from JS event loop delays.

  const startTimer = useCallback(() => {
    if (timerRef.current) return;
    callStartMsRef.current = Date.now();
    setElapsed(0);

    timerRef.current = setInterval(() => {
      if (callStartMsRef.current) {
        const secs = Math.floor((Date.now() - callStartMsRef.current) / 1000);
        setElapsed(secs);
      }
    }, 1000);
  }, []);

  // ── Reset All State ─────────────────────────────────────────────────────

  const resetState = useCallback(() => {
    endingRef.current = false;
    actionLockRef.current = false;
    activeCallRef.current = null;
    setActiveCall(null);
    setElapsed(0);
    setMuted(false);
    setVideoOff(false);
    setHeld(false);
    setRemoteHeld(false);
    setSpeakerOn(false);
    setNetworkQuality(null);
    setConnected(false);
    setDailyReady(false);
    setErrorMsg(null);
    setLocalParticipant(null);
    setRemoteParticipant(null);
    setRemoteParticipants([]);
    callIdRef.current = null;
    groupIdentityRef.current = undefined;
    callStartMsRef.current = null;
  }, []);

  const clearCallState = useCallback(() => {
    // A delayed navigation cleanup from an old screen must not reset a new call.
    if (stateRef.current !== 'idle' && stateRef.current !== 'failed') return;
    resetState();
    setWasEverActive(false);
    stateRef.current = 'idle';
    setCallState('idle');
  }, [resetState]);

  // ── End Call ────────────────────────────────────────────────────────────
  // Runs exactly once per call via endingRef guard.
  // Cleanup is fully awaited with a catch guard so we always reach idle.

  const endCall = useCallback(() => {
    if (endingRef.current) return;
    endingRef.current = true;
    const endingAttempt = ++attemptRef.current;

    const didTransition = transitionTo('ending', 'endCall');
    if (!didTransition && stateRef.current !== 'ending') {
      console.log('[CallState] forcing ending from', stateRef.current);
      stateRef.current = 'ending';
      setCallState('ending');
    }

    // Stop all audio immediately
    void audioService.stopAll().catch(() => {});

    // Clear all timers and subscriptions synchronously
    clearRingingTimeout();
    clearReconnectTimeout();
    clearDegradedTimeout();
    clearTimer();
    cleanupSubscription();
    if (hbRef.current) { clearInterval(hbRef.current); hbRef.current = null; }
    if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }

    // Capture refs before nulling
    const call = callObjRef.current;
    const cid = callIdRef.current;
    const wallStart = callStartMsRef.current;
    const currentActiveCall = activeCallRef.current;
    const currentMyId = myIdRef.current;
    const providerIdentity = groupIdentityRef.current;

    callObjRef.current = null;

    const cleanup = async () => {
      // Drop the OS-side call first, or iOS keeps its call alive after ours ends.
      if (cid) nativeCallService.endNativeCall(String(cid).toLowerCase()); else nativeCallService.endAllNativeCalls();
      // Persist the intent independently of media cleanup. A dropped network must
      // neither strand the call screen nor leave a server call active forever.
      if (cid && currentMyId) {
        void queueNativeCallClose(currentMyId, {
          callId: cid, group: !!currentActiveCall?.isGroupCall, providerIdentity,
          duration: wallStart ? Math.max(0, Math.floor((Date.now() - wallStart) / 1000)) : 0,
        }).catch(() => {}).then(() => flushNativeCallCloses(currentMyId)).catch(() => {});
      }
      if (call) {
        try { await settleCallOperation(call.leave(), 2500); } catch {}
        try { await settleCallOperation(Promise.resolve(call.destroy()), 2500); } catch {}
      }
      try { await settleCallOperation(audioService.resetSession(), 2500); } catch {}
      if (attemptRef.current !== endingAttempt) return;

      // 4. Reset state and transition to idle
      resetState();
      stateRef.current = 'idle';
      setCallState('idle');
    };

    cleanup().catch((e) => {
      console.log('[CallEnd] cleanup failed:', e);
      if (attemptRef.current !== endingAttempt) return;
      resetState();
      stateRef.current = 'idle';
      setCallState('idle');
    });
  }, [transitionTo, clearRingingTimeout, clearReconnectTimeout, clearDegradedTimeout, clearTimer, cleanupSubscription, resetState]);

  // ── Start Call ──────────────────────────────────────────────────────────

  const startCall = useCallback((params: ActiveCallInfo) => {
    if (stateRef.current !== 'idle') {
      console.log('[CallState] startCall blocked, state:', stateRef.current);
      return;
    }

    if (!myIdRef.current) return;
    endingRef.current = false;
    actionLockRef.current = false;
    const attempt = ++attemptRef.current;
    activeCallRef.current = params;
    callIdRef.current = params.callId;
    groupIdentityRef.current = undefined;
    mediaIntentRef.current = { muted: false, videoOff: !params.isVideo, held: false, speaker: params.isVideo };
    transitionTo('initiating', params.isIncoming ? 'incoming' : 'outgoing');
    setWasEverActive(true);
    setActiveCall(params);
    setVideoOff(!params.isVideo);
    setMuted(false);
    setHeld(false);
    setRemoteHeld(false);
    setSpeakerOn(params.isVideo); // Video calls default to speaker, voice to earpiece
    setNetworkQuality(null);
    setConnected(false);
    setDailyReady(false);
    setErrorMsg(null);
    setElapsed(0);

    void doStartCall(params, attempt, myIdRef.current);
  }, [transitionTo]);

  // ── Internal: Execute Call Setup ────────────────────────────────────────

  const doStartCall = async (params: ActiveCallInfo, attempt: number, actor: string) => {
    let resolvedCallId = params.callId;
    let providerIdentity: string | undefined;
    const isCurrent = () => attemptRef.current === attempt && myIdRef.current === actor && !endingRef.current;
    const abandon = () => {
      if (resolvedCallId) void queueNativeCallClose(actor, { callId: resolvedCallId, group: params.isGroupCall, providerIdentity, duration: 0 })
        .catch(() => {}).then(() => flushNativeCallCloses(actor)).catch(() => {});
    };
    try {
      // Ask before ringing the other person or accepting their invitation.
      if (Platform.OS === 'android') {
        const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
        if (params.isVideo) perms.push(PermissionsAndroid.PERMISSIONS.CAMERA);
        const result = await PermissionsAndroid.requestMultiple(perms);
        if (!isCurrent()) return;
        if (perms.some(permission => result[permission] !== PermissionsAndroid.RESULTS.GRANTED)) {
          throw new Error(params.isVideo ? 'Allow microphone and camera access in Settings to make a video call.' : 'Allow microphone access in Settings to make a call.');
        }
      } else if (Platform.OS === 'ios') {
        const mic = await Camera.requestMicrophonePermissionsAsync();
        if (!isCurrent()) return;
        if (!mic.granted) throw new Error('Allow microphone access in Settings to make a call.');
        if (params.isVideo) {
          const camera = await Camera.requestCameraPermissionsAsync();
          if (!isCurrent()) return;
          if (!camera.granted) throw new Error('Allow camera access in Settings to make a video call.');
        }
      }

      if (!isCurrent()) return;
      // 2. Resolve callId
      let callId = params.callId;

      if (!callId && !params.isIncoming && myIdRef.current) {
        const mid = myIdRef.current;

        if (params.isGroupCall && params.conversationId) {
          const rec = await callService.initiateGroupCall({
            callerId: mid,
            conversationId: params.conversationId,
            channelId: params.channelId,
            isVideo: params.isVideo,
          });
          callId = rec?.id ?? null;
          providerIdentity = rec?.provider_identity;
          if (isCurrent()) groupIdentityRef.current = providerIdentity;
        } else {
          const rec = await callService.initiateCall({
            callerId: mid,
            receiverId: params.otherUserId,
            conversationId: params.conversationId,
            channelId: params.channelId,
            isVideo: params.isVideo,
          });
          callId = rec?.id ?? null;
        }
      }

      resolvedCallId = callId;
      if (!isCurrent()) { abandon(); return; }

      // For incoming group calls, join as participant
      if (params.isGroupCall && params.isIncoming && callId && myIdRef.current) {
        providerIdentity = await callService.joinGroupCallMembership(callId, actor) ?? undefined;
        if (!providerIdentity) throw new Error('Could not join this group call.');
        if (isCurrent()) groupIdentityRef.current = providerIdentity;
      }

      if (params.isGroupCall && !providerIdentity) throw new Error('Could not verify this call membership. Please try again.');

      // For incoming 1-on-1 calls, accept (update DB status)
      if (!params.isGroupCall && params.isIncoming && callId) {
        const accepted = await callService.acceptCall(callId);
        if (!accepted) throw new Error('This call is no longer available.');
      }

      if (!isCurrent()) { abandon(); return; }
      if (!callId) throw new Error('Could not establish call. Please try again.');
      callIdRef.current = callId;
      activeCallRef.current = { ...params, callId };
      setActiveCall(activeCallRef.current);

      // 3. Transition to RINGING (outgoing) or CONNECTING (incoming)
      if (!params.isIncoming) {
        transitionTo('ringing', 'outgoing wait');
        nativeCallService.startOutgoingCall(String(callId).toLowerCase(), params.otherUserName || 'Call', !!params.isVideo);
        await audioService.playRingback();
        if (!isCurrent()) return;
        ringingTimeoutRef.current = setTimeout(() => {
          if (isCurrent() && stateRef.current === 'ringing') {
            console.log('[CallState] ringing timeout, marking missed');
            if (callIdRef.current) {
              callService.markMissed(callIdRef.current).catch(() => {});
            }
            endCall();
          }
        }, 45000);
      } else {
        transitionTo('connecting', 'incoming accepted');
        await audioService.stopAndSwitchToVoiceChat();
      }

      if (!isCurrent()) return;
      // 4. Subscribe to call status changes
      const subUid = `${callId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      cleanupSubscription();
      statusSubRef.current = supabase.channel(`call_status_${subUid}`)
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `id=eq.${callId}` },
          (payload) => {
            if (!isCurrent()) return;
            const st = (payload.new as any).status;
            if (st === 'declined' || st === 'missed' || st === 'ended') {
              endCall();
            }
          })
        .subscribe();

      // Recover terminal updates missed while Realtime was reconnecting.
      let polling = false;
      const pollStatus = async () => {
        if (!isCurrent() || polling) return;
        polling = true;
        try {
          const record = await settleCallOperation(callService.getCall(callId!));
          if (isCurrent() && record && ['ended', 'declined', 'missed'].includes(record.status)) endCall();
        } catch {} finally { polling = false; }
      };
      statusPollRef.current = setInterval(() => { void pollStatus(); }, 15000);
      void pollStatus();

      // 5. Get Daily token
      const { roomUrl, token } = await callService.getDailyToken({
        callSessionId: callId,
        isOwner: !params.isIncoming,
        kind: 'call',
        expectedProviderIdentity: providerIdentity,
      });
      if (!isCurrent()) return;

      // 6. Create Daily call object
      const call = Daily.createCallObject({
        audioSource: true,
        videoSource: params.isVideo,
        startVideoOff: false,
        startAudioOff: false,
        dailyConfig: {
          // The audio win on a phone is processing, not bitrate. These three
          // matter more to how a call sounds than any codec setting.
          userMediaAudioConstraints: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          // 720p ceiling with Daily adapting downward. Forcing 1080p on a weak
          // connection produces freezing and dropped frames, which is worse
          // than clean 720p, and mobile data here is expensive.
          userMediaVideoConstraints: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
        },
      } as any);
      callObjRef.current = call;

      // 7. Wire Daily events
      call.on('joined-meeting' as DailyEvent, () => {
        if (callObjRef.current !== call) return; // stale guard
        setDailyReady(true);
        const intent = mediaIntentRef.current;
        try { call.setLocalVideo(!intent.videoOff && !intent.held); } catch {}
        try { call.setLocalAudio(!intent.muted && !intent.held); } catch {}
        try {
          (call as any).setNativeInCallAudioMode(params.isVideo ? 'video' : 'voice');
          console.log('[Audio] inCallAudioMode engaged:', params.isVideo ? 'video' : 'voice');
          // Engaging the audio mode silences the ringback; ringback survives by restarting while the call is still ringing.
          [300, 1500].forEach((ms) => setTimeout(() => { try { const { audioService } = require('../services/audioService'); if (callObjRef.current === call && stateRef.current === 'ringing') { audioService.restartRingback(); } } catch {} }, ms));
        } catch (e: any) { console.log('[Audio] inCallAudioMode error:', e?.message); }
        if (params.isGroupCall && callIdRef.current) {
          const stamp = async () => {
            if (!isCurrent() || callObjRef.current !== call) { if (hbRef.current) { clearInterval(hbRef.current); hbRef.current = null; } return; }
            try {
              const { data: s } = await supabase.auth.getSession();
              const uid = s.session?.user?.id;
              if (uid !== actor || !isCurrent() || callObjRef.current !== call) return;
              const { error } = await supabase.from('call_participants')
                .update({ last_seen_at: new Date().toISOString() })
                .eq('call_session_id', callId)
                .eq('user_id', uid)
                .eq('status', 'joined')
                .eq('provider_identity', providerIdentity!);
              console.log('[HB]', error?.message ?? 'ok');
            } catch (e: any) { console.log('[HB] threw', e?.message); }
          };
          stamp();
          if (hbRef.current) clearInterval(hbRef.current);
          hbRef.current = setInterval(stamp, 30000);
        }

        try {
          (call as any).setBandwidth?.({
            kbs: params.isVideo ? 1200 : 64,
            trackConstraints: params.isVideo
              ? { width: 1280, height: 720, frameRate: 30 }
              : undefined,
          });
        } catch {}
        refreshParticipants(call);

        if (params.isIncoming) {
          void onCallConnected(call).catch(() => { if (callObjRef.current === call) endCall(); });
        }
      });

      call.on('participant-joined' as DailyEvent, (ev: DailyEventObjectParticipant | any) => {
        if (callObjRef.current !== call) return; // stale guard
        refreshParticipants(call);
        if (ev?.participant?.local) return;
        void onCallConnected(call).catch(() => { if (callObjRef.current === call) endCall(); });
      });

      call.on('participant-updated' as DailyEvent, () => {
        if (callObjRef.current !== call) return; // stale guard
        refreshParticipants(call);
      });

      call.on('participant-left' as DailyEvent, (ev: DailyEventObjectParticipant | any) => {
        if (callObjRef.current !== call) return; // stale guard
        if (ev?.participant?.local) return;
        refreshParticipants(call);

        if (params.isGroupCall) {
          const ps = call.participants();
          const remoteCount = Object.keys(ps).filter(k => k !== 'local').length;
          if (remoteCount === 0) {
            console.log('[CallState] group empty - allowing reconnection');
            setTimeout(() => {
              const c = callObjRef.current;
              if (!c || c !== call) return;
              const again = Object.keys(c.participants()).filter(k => k !== 'local').length;
              if (again === 0) { console.log('[CallState] group still empty, ending'); endCall(); }
            }, 30000);
          }
        } else {
          // A participant can briefly disappear during a network switch. The
          // authoritative ended status still closes deliberate hangups promptly.
          transitionTo('reconnecting', 'remote disconnected');
          clearReconnectTimeout();
          reconnectTimeoutRef.current = setTimeout(() => {
            if (callObjRef.current === call && !Object.keys(call.participants()).some(key => key !== 'local')) endCall();
          }, 30000);
        }
      });

      call.on('app-message' as DailyEvent, (ev: any) => {
        if (callObjRef.current !== call) return;
        const t = ev?.data?.t;
        if (t === 'hold') setRemoteHeld(true);
        if (t === 'unhold') setRemoteHeld(false);
      });

      call.on('track-started' as DailyEvent, () => {
        if (callObjRef.current !== call) return;
        refreshParticipants(call);
      });
      call.on('track-stopped' as DailyEvent, () => {
        if (callObjRef.current !== call) return;
        refreshParticipants(call);
      });

      // ── Network Quality Events ──────────────────────────────────────────

      call.on('network-quality-change' as DailyEvent, (ev: any) => {
        if (callObjRef.current !== call) return; // stale guard
        const quality = ev?.threshold ?? ev?.quality; // SDK quality is numeric; threshold is the label.
        if (typeof quality === 'string') {
          // Track quality for UI indicator
          if (['excellent', 'good', 'low', 'very-low'].includes(quality)) {
            setNetworkQuality(quality as any);
          }
          if (quality === 'low' || quality === 'very-low') {
            if (stateRef.current === 'active') {
              transitionTo('degraded', 'network quality ' + quality);
              // Low bandwidth is not a disconnect; let the SDK adapt media.
            }
          } else if (quality === 'good' || quality === 'excellent') {
            if (stateRef.current === 'degraded') {
              clearDegradedTimeout();
              transitionTo('active', 'network quality recovered');
            }
          }
        }
      });

      const interruptedTransports = new Set<string>();
      call.on('network-connection' as DailyEvent, (ev: any) => {
        if (callObjRef.current !== call) return; // stale guard
        const evType = ev?.event || ''; // `type` names the transport, not its state.

        if (evType === 'interrupted' || evType === 'disconnected') {
          interruptedTransports.add(ev?.type ?? 'unknown');
          const current = stateRef.current;
          if (current === 'active' || current === 'degraded') {
            clearDegradedTimeout();
            console.log('[Network] connection', evType, 'from state:', current);
            transitionTo('reconnecting', 'network ' + evType);
            clearReconnectTimeout();
            reconnectTimeoutRef.current = setTimeout(() => {
              if (callObjRef.current === call && stateRef.current === 'reconnecting') {
                console.log('[Network] reconnect timeout reached, ending call');
                setErrorMsg('Connection lost');
                transitionTo('failed', 'reconnect timeout');
                endCall();
              }
            }, 30000);
          }
        }

        if (evType === 'connected' || evType === 'recovered') {
          interruptedTransports.delete(ev?.type ?? 'unknown');
          if (interruptedTransports.size) return;
          if (!params.isGroupCall && !Object.keys(call.participants()).some(key => key !== 'local')) return;
          if (stateRef.current === 'reconnecting') {
            clearReconnectTimeout();
            console.log('[Network] reconnected via:', evType);
            (async () => {
              await audioService.stopAndSwitchToVoiceChat();
              if (callObjRef.current !== call || !isCurrent()) return;
              transitionTo('active', 'network ' + evType);
              applySpeakerRoute(mediaIntentRef.current.speaker);
            })().catch(() => {});
          }
        }
      });

      call.on('error' as DailyEvent, (ev: any) => {
        if (callObjRef.current !== call) return; // stale guard
        const msg = ev?.errorMsg || ev?.error?.message || 'Call error';
        console.log('[CallState] Daily error:', msg);
        setErrorMsg(msg);
        if (stateRef.current !== 'ending') {
          transitionTo('failed', 'daily error');
          endCall();
        }
      });

      call.on('left-meeting' as DailyEvent, () => {
        if (callObjRef.current === call && isCurrent()) endCall();
      });

      // 8. Join the Daily room
      await settleCallOperation(call.join({
        url: roomUrl,
        token,
        userName: profile?.full_name || 'User',
      }), 30000);

    } catch (e: any) {
      if (!isCurrent()) { abandon(); return; }
      const msg = e?.message || 'Could not connect. Please try again.';
      setErrorMsg(msg);
      Alert.alert('Call unavailable', msg);
      transitionTo('failed', 'setup failed');
      endCall();
    }
  };

  // ── Speaker Routing Helper ───────────────────────────────────────────────
  // MUST be declared before onCallConnected which references it.

  const applySpeakerRoute = useCallback((toSpeaker: boolean) => {
    // Daily's native in-call audio mode is the only working route control:
    // 'video' = speakerphone, 'voice' = earpiece. The old setAudioDevice path
    // never existed on this SDK and the expo-av fallback was proven dead.
    const call = callObjRef.current as any;
    if (!call) return;
    try {
      call.setNativeInCallAudioMode(toSpeaker ? 'video' : 'voice');
      console.log('[Speaker] route ->', toSpeaker ? 'speaker' : 'earpiece');
    } catch (e: any) {
      console.log('[Speaker] route error:', e?.message);
    }
  }, []);

  // ── On Call Connected ───────────────────────────────────────────────────
  // Audio transition is fully awaited before state change.

  const onCallConnected = useCallback(async (call: DailyCall) => {
    const current = stateRef.current;
    if (current !== 'ringing' && current !== 'connecting' && current !== 'reconnecting' && current !== 'degraded') {
      if (current === 'active') return;
      return;
    }

    clearRingingTimeout();
    clearDegradedTimeout();
    clearReconnectTimeout();

    await audioService.stopAndSwitchToVoiceChat();
    if (callObjRef.current !== call || endingRef.current) return;

    transitionTo('active', 'media connected');
    if (callIdRef.current) nativeCallService.reportConnected(String(callIdRef.current).toLowerCase());
    setConnected(true);

    // Apply default speaker routing: video = speakerphone, voice = earpiece
    applySpeakerRoute(mediaIntentRef.current.speaker);

    startTimer();

  }, [transitionTo, clearRingingTimeout, clearDegradedTimeout, clearReconnectTimeout, startTimer, applySpeakerRoute]);

  // ── Controls (with action lock) ─────────────────────────────────────────

  const withActionLock = useCallback((fn: () => void) => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    try { fn(); } catch { setErrorMsg('Could not update call controls. Please try again.'); }
    finally { setTimeout(() => { actionLockRef.current = false; }, 300); }
  }, []);

  const toggleMute = useCallback(() => {
    withActionLock(() => {
      const call = callObjRef.current;
      const s = stateRef.current;
      if (!call) return;
      if (s !== 'active' && s !== 'connecting' && s !== 'reconnecting' && s !== 'degraded') return;
      const intent = mediaIntentRef.current;
      const nowMuted = !intent.muted;
      call.setLocalAudio(!nowMuted && !intent.held);
      intent.muted = nowMuted;
      setMuted(nowMuted);
    });
  }, [withActionLock]);

  const toggleVideo = useCallback(async () => {
    const call = callObjRef.current;
    if (!call || actionLockRef.current || !['active', 'connecting', 'reconnecting', 'degraded'].includes(stateRef.current)) return;
    actionLockRef.current = true;
    try {
      const intent = mediaIntentRef.current;
      const nowOff = !intent.videoOff;
      if (!nowOff) {
        const permission = Platform.OS === 'android'
          ? await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
          : (await Camera.requestCameraPermissionsAsync()).status;
        if (callObjRef.current !== call) return;
        if (permission !== 'granted') {
          Alert.alert('Camera access needed', 'Allow camera access in Settings to turn on your video.');
          return;
        }
      }
      call.setLocalVideo(!nowOff && !intent.held);
      intent.videoOff = nowOff;
      setVideoOff(nowOff);
    } catch {
      Alert.alert('Camera unavailable', 'Could not turn on the camera. Please try again.');
    } finally {
      setTimeout(() => { if (callObjRef.current === call) actionLockRef.current = false; }, 300);
    }
  }, []);

  const toggleHold = useCallback(() => {
    withActionLock(() => {
      const call = callObjRef.current;
      if (!call) return;
      if (stateRef.current !== 'active' && stateRef.current !== 'degraded') return;
      const intent = mediaIntentRef.current;
      const nowHeld = !intent.held;
      call.setLocalAudio(!nowHeld && !intent.muted);
      call.setLocalVideo(!nowHeld && !intent.videoOff);
      intent.held = nowHeld;
      setHeld(nowHeld);
      try { (call as any).sendAppMessage({ t: nowHeld ? 'hold' : 'unhold' }, '*'); } catch {}
    });
  }, [withActionLock]);

  const flipCamera = useCallback(async () => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    try {
      const call = callObjRef.current;
      if (!call) return;
      const s = stateRef.current;
      if (s !== 'active' && s !== 'connecting' && s !== 'degraded') return;
      await call.cycleCamera();
    } catch {}
    finally { setTimeout(() => { actionLockRef.current = false; }, 300); }
  }, []);

  const toggleSpeaker = useCallback(() => {
    withActionLock(() => {
      const s = stateRef.current;
      if (s !== 'active' && s !== 'connecting' && s !== 'reconnecting' && s !== 'degraded') return;
      setSpeakerOn(prev => {
        const next = !prev;
        mediaIntentRef.current.speaker = next;
        applySpeakerRoute(next);
        return next;
      });
    });
  }, [withActionLock, applySpeakerRoute]);

  useEffect(() => {
    if (!myId) return;
    const flush = () => { void flushNativeCallCloses(myId).catch(() => {}); };
    flush();
    const interval = setInterval(flush, 20000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') flush(); });
    return () => { clearInterval(interval); listener.remove(); };
  }, [myId]);

  useEffect(() => {
    return () => {
      // Changing account or unmounting cannot retain the previous account's media.
      if (stateRef.current !== 'idle') endCall();
    };
  }, [myId, endCall]);

  // ── Context Value ─────────────────────────────────────────────────────

  useEffect(() => {
    const id = activeCall?.callId;
    if (!activeCall?.isGroupCall || !id) return;
    const ch = supabase.channel(`gcall_end_${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `id=eq.${id}` }, (p: any) => {
        const st = (p.new as any)?.status;
        if ((st === 'ended' || st === 'missed') && stateRef.current !== 'idle' && stateRef.current !== 'ending') {
          endCall();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeCall?.callId, activeCall?.isGroupCall, endCall]);

  return (
    <CallContext.Provider value={{
      callState, activeCall, elapsed, muted, videoOff, held, remoteHeld, speakerOn,
      networkQuality, connected, dailyReady, errorMsg, localParticipant,
      remoteParticipant, remoteParticipants, wasEverActive,
      startCall, endCall, clearCallState,
      toggleMute, toggleVideo, toggleHold, toggleSpeaker, flipCamera,
    }}>
      {children}
    </CallContext.Provider>
  );
}
