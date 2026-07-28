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
import { Platform, PermissionsAndroid } from 'react-native';
import Daily, {
  DailyCall, DailyEvent, DailyEventObjectParticipant, DailyParticipant,
} from '@daily-co/react-native-daily-js';
import { callService, CallStatus } from '../services/callService';
import { audioService } from '../services/audioService';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';

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
  toggleHold: () => void;
  toggleSpeaker: () => void;
  flipCamera: () => Promise<void>;
  clearCallState: () => void;
};

const CallContext = createContext<CallContextType>({
  callState: 'idle', activeCall: null, elapsed: 0,
  muted: false, videoOff: false, held: false, speakerOn: false,
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
  const statusSubRef = useRef<any>(null);
  const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const degradedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endingRef = useRef(false);
  const actionLockRef = useRef(false);

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
    setActiveCall(null);
    setElapsed(0);
    setMuted(false);
    setVideoOff(false);
    setHeld(false);
    setSpeakerOn(false);
    setNetworkQuality(null);
    setConnected(false);
    setDailyReady(false);
    setErrorMsg(null);
    setLocalParticipant(null);
    setRemoteParticipant(null);
    setRemoteParticipants([]);
    callIdRef.current = null;
    callStartMsRef.current = null;
  }, []);

  const clearCallState = useCallback(() => {
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

    const didTransition = transitionTo('ending', 'endCall');
    if (!didTransition && stateRef.current !== 'ending') {
      console.log('[CallState] forcing ending from', stateRef.current);
      stateRef.current = 'ending';
      setCallState('ending');
    }

    // Stop all audio immediately
    audioService.stopAll();

    // Clear all timers and subscriptions synchronously
    clearRingingTimeout();
    clearReconnectTimeout();
    clearDegradedTimeout();
    clearTimer();
    cleanupSubscription();

    // Capture refs before nulling
    const call = callObjRef.current;
    const cid = callIdRef.current;
    const wallStart = callStartMsRef.current;
    const currentActiveCall = activeCallRef.current;
    const currentMyId = myIdRef.current;
    const wasConnected = wallStart !== null; // timer only starts on connect

    callObjRef.current = null;

    const cleanup = async () => {
      // 1. Leave and destroy Daily
      if (call) {
        try { await call.leave(); } catch {}
        try { call.destroy(); } catch {}
      }

      // 2. DB updates
      if (cid) {
        try {
          const wall = wallStart ? Math.floor((Date.now() - wallStart) / 1000) : 0;

          if (currentActiveCall?.isGroupCall) {
            if (currentMyId) {
              await callService.leaveGroupCall(cid, currentMyId).catch((e: any) =>
                console.log('[CallEnd] leaveGroupCall error:', e?.message));
            }
            await callService.checkAndEndGroupCall(cid).catch((e: any) =>
              console.log('[CallEnd] checkAndEndGroupCall error:', e?.message));
          } else {
            const currentRecord = await callService.getCall(cid);
            const dbStatus = currentRecord?.status;

            if (dbStatus === 'declined' || dbStatus === 'ended') {
              console.log('[CallEnd] status already', dbStatus);
            } else if (wasConnected && wall >= 1) {
              // Call was connected and lasted at least 1 second
              await callService.endCall(cid, wall);
            } else if (wasConnected) {
              // Connected but under 1 second (instant hangup)
              await callService.endCall(cid, 0);
            } else {
              // Never connected: mark as missed
              await callService.markMissed(cid);
            }
          }

          await callService.recordCallEvent(cid).catch((e: any) =>
            console.log('[CallEnd] recordCallEvent error:', e?.message));
        } catch (e: any) {
          console.log('[CallEnd] DB error:', e?.message);
        }
      }

      // 3. Reset audio session
      await audioService.resetSession();

      // 4. Reset state and transition to idle
      resetState();
      stateRef.current = 'idle';
      setCallState('idle');
    };

    cleanup().catch((e) => {
      console.log('[CallEnd] cleanup failed:', e);
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

    endingRef.current = false;
    actionLockRef.current = false;
    transitionTo('initiating', params.isIncoming ? 'incoming' : 'outgoing');
    setWasEverActive(true);
    setActiveCall(params);
    setVideoOff(!params.isVideo);
    setMuted(false);
    setHeld(false);
    setSpeakerOn(params.isVideo); // Video calls default to speaker, voice to earpiece
    setNetworkQuality(null);
    setConnected(false);
    setDailyReady(false);
    setErrorMsg(null);
    setElapsed(0);

    doStartCall(params);
  }, [transitionTo]);

  // ── Internal: Execute Call Setup ────────────────────────────────────────

  const doStartCall = async (params: ActiveCallInfo) => {
    try {
      // 1. Request permissions (Android)
      if (Platform.OS === 'android') {
        const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
        if (params.isVideo) perms.push(PermissionsAndroid.PERMISSIONS.CAMERA);
        await PermissionsAndroid.requestMultiple(perms);
      }

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
        } else {
          const rec = await callService.initiateCall({
            callerId: mid,
            receiverId: params.otherUserId,
            channelId: params.channelId,
            isVideo: params.isVideo,
          });
          callId = rec?.id ?? null;
        }
      }

      // For incoming group calls, join as participant
      if (params.isGroupCall && params.isIncoming && callId && myIdRef.current) {
        await callService.joinGroupCall(callId, myIdRef.current);
      }

      // For incoming 1-on-1 calls, accept (update DB status)
      if (!params.isGroupCall && params.isIncoming && callId) {
        await callService.acceptCall(callId);
      }

      if (!callId) {
        setErrorMsg('Could not establish call');
        transitionTo('failed', 'no callId');
        endingRef.current = false;
        return;
      }

      if (endingRef.current) return;

      callIdRef.current = callId;
      setActiveCall(prev => prev ? { ...prev, callId } : prev);

      // 3. Transition to RINGING (outgoing) or CONNECTING (incoming)
      if (!params.isIncoming) {
        transitionTo('ringing', 'outgoing wait');
        await audioService.playRingback();
        ringingTimeoutRef.current = setTimeout(() => {
          if (stateRef.current === 'ringing') {
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

      // 4. Subscribe to call status changes
      const subUid = `${callId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      cleanupSubscription();
      statusSubRef.current = supabase.channel(`call_status_${subUid}`)
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: `id=eq.${callId}` },
          (payload) => {
            const st = (payload.new as any).status;
            if (st === 'declined' || st === 'missed' || st === 'ended') {
              endCall();
            }
          })
        .subscribe();

      // 5. Get Daily token
      const { roomUrl, token } = await callService.getDailyToken({
        callSessionId: callId,
        isOwner: !params.isIncoming,
        kind: 'call',
      });
      if (endingRef.current) return;

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
        if (params.isVideo) {
          try { call.setLocalVideo(true); } catch {}
        }
        try { call.setLocalAudio(true); } catch {}
        try {
          (call as any).setNativeInCallAudioMode(params.isVideo ? 'video' : 'voice');
          console.log('[Audio] inCallAudioMode engaged:', params.isVideo ? 'video' : 'voice');
        } catch (e: any) { console.log('[Audio] inCallAudioMode error:', e?.message); }

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
          onCallConnected(call);
        }
      });

      call.on('participant-joined' as DailyEvent, (ev: DailyEventObjectParticipant | any) => {
        if (callObjRef.current !== call) return; // stale guard
        refreshParticipants(call);
        if (ev?.participant?.local) return;
        onCallConnected(call);
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
            console.log('[CallState] all group participants left');
            endCall();
          }
        } else {
          endCall();
        }
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
        const quality = ev?.quality ?? ev?.threshold;
        if (typeof quality === 'string') {
          // Track quality for UI indicator
          if (['excellent', 'good', 'low', 'very-low'].includes(quality)) {
            setNetworkQuality(quality as any);
          }
          if (quality === 'low' || quality === 'very-low') {
            if (stateRef.current === 'active') {
              transitionTo('degraded', 'network quality ' + quality);
              // Escalate to reconnecting if degraded persists for 15s
              clearDegradedTimeout();
              degradedTimeoutRef.current = setTimeout(() => {
                if (stateRef.current === 'degraded') {
                  console.log('[CallState] degraded timeout, escalating to reconnecting');
                  transitionTo('reconnecting', 'degraded timeout');
                  clearReconnectTimeout();
                  reconnectTimeoutRef.current = setTimeout(() => {
                    if (stateRef.current === 'reconnecting') {
                      setErrorMsg('Connection lost');
                      transitionTo('failed', 'reconnect timeout');
                      endCall();
                    }
                  }, 30000);
                }
              }, 15000);
            }
          } else if (quality === 'good' || quality === 'excellent') {
            if (stateRef.current === 'degraded') {
              clearDegradedTimeout();
              transitionTo('active', 'network quality recovered');
            }
          }
        }
      });

      call.on('network-connection' as DailyEvent, (ev: any) => {
        if (callObjRef.current !== call) return; // stale guard
        const evType = ev?.type || ev?.event || ev?.action || '';

        if (evType === 'interrupted' || evType === 'disconnected') {
          const current = stateRef.current;
          if (current === 'active' || current === 'degraded') {
            clearDegradedTimeout();
            console.log('[Network] connection', evType, 'from state:', current);
            transitionTo('reconnecting', 'network ' + evType);
            clearReconnectTimeout();
            reconnectTimeoutRef.current = setTimeout(() => {
              if (stateRef.current === 'reconnecting') {
                console.log('[Network] reconnect timeout reached, ending call');
                setErrorMsg('Connection lost');
                transitionTo('failed', 'reconnect timeout');
                endCall();
              }
            }, 30000);
          }
        }

        if (evType === 'connected' || evType === 'recovered') {
          if (stateRef.current === 'reconnecting') {
            clearReconnectTimeout();
            console.log('[Network] reconnected via:', evType);
            (async () => {
              await audioService.stopAndSwitchToVoiceChat();
              transitionTo('active', 'network ' + evType);
              const currentSpeaker = speakerOn;
              applySpeakerRoute(currentSpeaker);
            })();
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

      // 8. Join the Daily room
      await call.join({
        url: roomUrl,
        token,
        userName: profile?.full_name || 'User',
      });

    } catch (e: any) {
      if (!endingRef.current) {
        const msg = e?.message || 'Could not connect';
        console.log('[CallState] startCall error:', msg);
        setErrorMsg(msg);
        transitionTo('failed', 'exception');
        await audioService.stopAll();
        cleanupSubscription();
        clearRingingTimeout();
        clearReconnectTimeout();
        clearDegradedTimeout();

        if (activeCallRef.current?.isGroupCall && callIdRef.current) {
          supabase.rpc('leave_group_call', { p_session_id: callIdRef.current }).then(() => {}, () => {});
        }
        if (callObjRef.current) {
          try { await callObjRef.current.leave(); } catch {}
          try { callObjRef.current.destroy(); } catch {}
          callObjRef.current = null;
        }
        resetState();
        stateRef.current = 'idle';
        setCallState('idle');
        endingRef.current = false;
      }
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

    await audioService.stopAndSwitchToVoiceChat();

    transitionTo('active', 'media connected');
    setConnected(true);

    // Apply default speaker routing: video = speakerphone, voice = earpiece
    const isVideoCall = activeCallRef.current?.isVideo ?? false;
    applySpeakerRoute(isVideoCall);

    startTimer();

    if (callIdRef.current && activeCallRef.current && !activeCallRef.current.isIncoming && !activeCallRef.current.isGroupCall) {
      callService.acceptCall(callIdRef.current).catch(() => {});
    }
  }, [transitionTo, clearRingingTimeout, clearDegradedTimeout, startTimer, applySpeakerRoute]);

  // ── Controls (with action lock) ─────────────────────────────────────────

  const withActionLock = useCallback((fn: () => void) => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    fn();
    setTimeout(() => { actionLockRef.current = false; }, 300);
  }, []);

  const toggleMute = useCallback(() => {
    withActionLock(() => {
      const call = callObjRef.current;
      const s = stateRef.current;
      if (!call) return;
      if (s !== 'active' && s !== 'connecting' && s !== 'reconnecting' && s !== 'degraded') return;
      setMuted(prev => {
        const nowMuted = !prev;
        call.setLocalAudio(!nowMuted);
        return nowMuted;
      });
    });
  }, [withActionLock]);

  const toggleVideo = useCallback(() => {
    withActionLock(() => {
      const call = callObjRef.current;
      const s = stateRef.current;
      if (!call) return;
      if (s !== 'active' && s !== 'connecting' && s !== 'reconnecting' && s !== 'degraded') return;
      setVideoOff(prev => {
        const nowOff = !prev;
        call.setLocalVideo(!nowOff);
        return nowOff;
      });
    });
  }, [withActionLock]);

  const toggleHold = useCallback(() => {
    withActionLock(() => {
      const call = callObjRef.current;
      if (!call) return;
      if (stateRef.current !== 'active' && stateRef.current !== 'degraded') return;
      setHeld(prev => {
        const nowHeld = !prev;
        call.setLocalAudio(!nowHeld);
        if (activeCallRef.current?.isVideo) call.setLocalVideo(!nowHeld);
        return nowHeld;
      });
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
        applySpeakerRoute(next);
        return next;
      });
    });
  }, [withActionLock, applySpeakerRoute]);

  // ── Context Value ─────────────────────────────────────────────────────

  return (
    <CallContext.Provider value={{
      callState, activeCall, elapsed, muted, videoOff, held, speakerOn,
      networkQuality, connected, dailyReady, errorMsg, localParticipant,
      remoteParticipant, remoteParticipants, wasEverActive,
      startCall, endCall, clearCallState,
      toggleMute, toggleVideo, toggleHold, toggleSpeaker, flipCamera,
    }}>
      {children}
    </CallContext.Provider>
  );
}