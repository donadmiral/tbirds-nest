"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { startOneToOneCall, startGroupCall, getDailyRoom, setCallStatus, endCall, joinGroupCall, leaveGroupCall, declineGroupCall, getPendingIncomingCalls, isCallInvitationOpen, type CallSession } from "@/lib/calls";
import { flushPendingCallCloses, queueCallClose, type CallCloseIntent } from "@/lib/callRecovery";

type Incoming = CallSession & { caller_name?: string };
const ringing = isCallInvitationOpen;
const CLOSE_PENDING = 'The call closed on this device. Its status will update when your connection returns.';

function sendCloseKeepalive(call: CallSession, token: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !key || (call.is_group_call && !call.provider_identity)) return;
  const target = call.is_group_call ? '/rest/v1/rpc/' + (call.provider_identity ? 'leave_group_call_membership' : 'leave_group_call')
    : '/rest/v1/call_sessions?id=eq.' + call.id + '&status=in.(ringing,active)';
  void fetch(url + target, { method: call.is_group_call ? 'POST' : 'PATCH', keepalive: true,
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + token },
    body: JSON.stringify(call.is_group_call ? { p_session_id: call.id, ...(call.provider_identity ? { p_provider_identity: call.provider_identity } : {}) } : { status: 'ended' }),
  }).catch(() => {});
}

export function WebCallLayer() {
  const supabase = useRef(createClient()).current;
  const frameRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const uidRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [activeCall, setActiveCall] = useState<CallSession | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const activeCallRef = useRef<CallSession | null>(null);
  const incomingRef = useRef<Incoming | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const live = useRef(true);
  const incomingGeneration = useRef(0);

  const teardownFrame = useCallback(async () => {
    const frame = frameRef.current;
    frameRef.current = null; // Detach before destroy can emit left-meeting.
    if (!frame) return;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 2500);
      Promise.resolve().then(() => frame.destroy()).catch(() => {}).finally(() => { clearTimeout(timeout); resolve(); });
    });
  }, []);

  const releaseSession = useCallback(async (session: CallCloseIntent) => {
    if (session.is_group_call) await leaveGroupCall(session.id, session.provider_identity);
    else await endCall(session.id);
  }, []);

  const flushCloses = useCallback(async (account: string) => {
    return flushPendingCallCloses(account, () => live.current && uidRef.current === account, releaseSession);
  }, [releaseSession]);

  const closeSession = useCallback(async (session: CallSession, account: string) => {
    if (queueCallClose(account, session)) return flushCloses(account);
    // A missing group admission response cannot authorize closing an unknown
    // generation. Its server heartbeat expiry handles an abandoned admission.
    if (session.is_group_call) return false;
    if (live.current && uidRef.current === account) {
      try { await releaseSession(session); return true; } catch { return false; }
    }
    return false;
  }, [flushCloses, releaseSession]);

  const hangup = useCallback(async (record: boolean) => {
    const operation = ++generation.current;
    const session = activeCallRef.current;
    const account = uidRef.current;
    activeCallRef.current = null;
    busy.current = false;
    setActiveCall(null); setConnecting(false); setReconnecting(false); setCallError(null);
    // Record and send closure independently of a stalled media teardown.
    const closing = session && account && (record || session.is_group_call) ? closeSession(session, account) : Promise.resolve(true);
    const [, closed] = await Promise.all([teardownFrame(), closing]);
    if (!closed && live.current && uidRef.current === account && generation.current === operation) {
      setCallError(CLOSE_PENDING);
    }
  }, [teardownFrame, closeSession]);

  useEffect(() => {
    live.current = true;
    let authRevision = 0;
    const apply = (session: { user: { id: string }; access_token: string } | null) => {
      const next = session?.user.id ?? null;
      if (uidRef.current !== next) {
        if (activeCallRef.current && uidRef.current) {
          queueCallClose(uidRef.current, activeCallRef.current);
          sendCloseKeepalive(activeCallRef.current, tokenRef.current);
        }
        ++generation.current; ++incomingGeneration.current;
        busy.current = false; activeCallRef.current = null; incomingRef.current = null;
        setActiveCall(null); setIncoming(null); setConnecting(false); setReconnecting(false); setCallError(null);
        void teardownFrame();
      }
      uidRef.current = next; setUid(next); tokenRef.current = session?.access_token ?? null;
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { ++authRevision; apply(session); });
    const revision = authRevision;
    void supabase.auth.getSession().then(({ data }) => { if (live.current && authRevision === revision) apply(data.session); });
    return () => {
      if (activeCallRef.current && uidRef.current) {
        queueCallClose(uidRef.current, activeCallRef.current);
        sendCloseKeepalive(activeCallRef.current, tokenRef.current);
      }
      live.current = false; ++generation.current; ++incomingGeneration.current; subscription.unsubscribe(); void teardownFrame();
    };
  }, [supabase, teardownFrame]);

  useEffect(() => {
    if (!uid) return;
    const retry = () => { void flushCloses(uid).then(clear => { if (clear && live.current && uidRef.current === uid) setCallError(error => error === CLOSE_PENDING ? null : error); }); };
    retry();
    window.addEventListener('online', retry); window.addEventListener('focus', retry);
    const timer = setInterval(retry, 15000);
    return () => { clearInterval(timer); window.removeEventListener('online', retry); window.removeEventListener('focus', retry); };
  }, [uid, flushCloses]);

  useEffect(() => {
    const onHide = () => {
      const c = activeCallRef.current, token = tokenRef.current;
      if (c && uidRef.current) queueCallClose(uidRef.current, c);
      if (c) sendCloseKeepalive(c, token);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  const begin = useCallback(async (create: () => Promise<CallSession | null>, isVideo: boolean) => {
    if (busy.current || activeCallRef.current || !uidRef.current) return;
    busy.current = true;
    const operation = ++generation.current, account = uidRef.current;
    const current = () => live.current && generation.current === operation && uidRef.current === account;
    let session: CallSession | null = null;
    setConnecting(true); setReconnecting(false); setCallError(null);
    try {
      // Permission is checked before we ring someone or accept their invitation.
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('media-unavailable');
      const preview = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
      preview.getTracks().forEach(track => track.stop());
      if (!current()) return;
      session = await create();
      if (!session) throw new Error('unavailable');
      if (!current()) { await closeSession(session, account); return; }
      activeCallRef.current = session; setActiveCall(session);
      if (session.is_group_call && !session.provider_identity) throw new Error('unavailable');
      const room = await getDailyRoom(session.id, session.provider_identity);
      if (!current()) return;
      if (!room) throw new Error('unavailable');
      const DailyIframe = (await import('@daily-co/daily-js')).default;
      if (!current()) return;
      if (!containerRef.current) throw new Error('unavailable');
      const frame = DailyIframe.createFrame(containerRef.current, { showLeaveButton: true,
        iframeStyle: { width: '100%', height: '100%', border: '0', borderRadius: '12px' } });
      frameRef.current = frame as unknown as { destroy: () => Promise<void> };
      frame.on('left-meeting', () => { if (current() && frameRef.current === frame) void hangup(true); });
      frame.on('error', () => {
        if (!current()) return;
        const closed = hangup(true), closedOperation = generation.current;
        void closed.then(() => { if (live.current && generation.current === closedOperation && uidRef.current === account) setCallError('The call was interrupted. Check your connection and try again.'); });
      });
      const interrupted = new Set<string>();
      frame.on('network-connection', event => {
        if (!current() || !event) return;
        if (event.event === 'interrupted') interrupted.add(event.type);
        if (event.event === 'connected') interrupted.delete(event.type);
        setReconnecting(interrupted.size > 0); // Daily handles transport recovery itself.
      });
      await frame.join({ url: room.roomUrl, token: room.token, startVideoOff: !session.is_video });
      if (current()) setConnecting(false);
    } catch (error) {
      if (current()) {
        const closing = session ? closeSession(session, account) : Promise.resolve(true);
        void teardownFrame();
        activeCallRef.current = null; setActiveCall(null); setConnecting(false);
        const name = error instanceof Error ? error.name : '';
        setCallError(name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Allow microphone' + (isVideo ? ' and camera' : '') + ' access in your browser, then try the call again.'
          : name === 'NotFoundError' || name === 'NotReadableError'
            ? 'Your microphone or camera is unavailable. Check your device settings and try again.'
            : 'Could not connect this call. Check your connection and try again.');
        await closing;
      }
    } finally { if (current()) busy.current = false; }
  }, [hangup, closeSession, teardownFrame]);

  useEffect(() => {
    const join = async (sessionId: string, account: string, admittedIdentity?: string) => {
      const provider_identity = admittedIdentity ?? await joinGroupCall(sessionId);
      const { data, error } = await supabase.from('call_sessions').select('*').eq('id', sessionId).single();
      if (error || !data) {
        await closeSession({ id: sessionId, is_group_call: true, provider_identity } as CallSession, account);
        throw new Error('unavailable');
      }
      return { ...data, provider_identity } as CallSession;
    };
    const start = (event: Event) => {
      const d = (event as CustomEvent).detail as { receiverId: string; conversationId: string | null; isVideo: boolean };
      void begin(() => startOneToOneCall(d.receiverId, d.conversationId, d.isVideo), d.isVideo);
    };
    const group = (event: Event) => {
      const d = (event as CustomEvent).detail as { sessionId: string; isVideo: boolean };
      const account = uidRef.current;
      if (account) void begin(() => join(d.sessionId, account), d.isVideo);
    };
    const startGroup = (event: Event) => {
      const d = (event as CustomEvent).detail as { conversationId: string; isVideo: boolean };
      const account = uidRef.current;
      if (!account) return;
      void begin(async () => {
        const admitted = await startGroupCall(d.conversationId, d.isVideo);
        if (!admitted) throw new Error('unavailable');
        return join(admitted.sessionId, account, admitted.providerIdentity);
      }, d.isVideo);
    };
    window.addEventListener('pc-start-call', start); window.addEventListener('pc-join-group-call', group); window.addEventListener('pc-start-group-call', startGroup);
    return () => { window.removeEventListener('pc-start-call', start); window.removeEventListener('pc-join-group-call', group); window.removeEventListener('pc-start-group-call', startGroup); };
  }, [begin, closeSession, supabase]);

  useEffect(() => {
    if (!activeCall || !uid) return;
    let valid = true, checking = false;
    const current = () => valid && uidRef.current === uid && activeCallRef.current?.id === activeCall.id;
    const check = async () => {
      if (checking || !current()) return;
      checking = true;
      try {
      const sessionId = activeCall.id;
      const { data, error } = await supabase.from('call_sessions').select('status').eq('id', sessionId).maybeSingle();
      if (!current()) return;
      if (!error && (!data || !['ringing', 'active'].includes(data.status))) { void hangup(false); return; }
      if (activeCall.is_group_call) {
        const { data: part, error: partError } = await supabase.from('call_participants').select('status,provider_identity').eq('call_session_id', sessionId).eq('user_id', uid).maybeSingle();
        if (!current()) return;
        if (!partError && (part?.status !== 'joined' || (activeCall.provider_identity && part?.provider_identity !== activeCall.provider_identity))) { void hangup(false); return; }
        if (!partError && activeCall.provider_identity) await supabase.from('call_participants').update({ last_seen_at: new Date().toISOString() })
          .eq('call_session_id', sessionId).eq('user_id', uid).eq('status', 'joined').eq('provider_identity', activeCall.provider_identity);
      }
      } catch { /* The transport may recover; do not tear down viable media on a signaling read failure. */ }
      finally { checking = false; }
    };
    const ch = supabase.channel('web_call_' + activeCall.id)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: 'id=eq.' + activeCall.id }, () => { void check(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_participants', filter: 'call_session_id=eq.' + activeCall.id }, () => { void check(); })
      .subscribe(status => { if (status === 'SUBSCRIBED') void check(); });
    const refresh = () => { void check(); };
    refresh();
    window.addEventListener('online', refresh); window.addEventListener('focus', refresh);
    const timer = setInterval(() => { void check(); }, 30000);
    return () => { valid = false; clearInterval(timer); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); void supabase.removeChannel(ch); };
  }, [supabase, activeCall, uid, hangup]);

  useEffect(() => {
    if (!uid) return;
    let valid = true, scanning = false, checking = false;
    const receive = async (session: CallSession) => {
      if (!valid || uidRef.current !== uid || !ringing(session) || busy.current || activeCallRef.current || incomingRef.current) return;
      if (!session.is_group_call && session.receiver_id !== uid) return;
      const operation = ++incomingGeneration.current;
      incomingRef.current = session; setIncoming(session);
      const { data } = await supabase.from('profiles').select('full_name').eq('id', session.initiator_id).maybeSingle();
      if (valid && incomingGeneration.current === operation && incomingRef.current?.id === session.id && ringing(session)) {
        const invite = { ...session, caller_name: (data?.full_name || 'Someone') + (session.is_group_call ? ' · group call' : '') };
        incomingRef.current = invite; setIncoming(invite);
      }
    };
    const recover = async () => {
      if (!valid || scanning || uidRef.current !== uid || busy.current || activeCallRef.current || incomingRef.current) return;
      scanning = true;
      try {
        const calls = await getPendingIncomingCalls(uid);
        if (valid && uidRef.current === uid && calls[0]) await receive(calls[0]);
      } catch { /* Realtime or the next reconnect can retry. */ }
      finally { scanning = false; }
    };
    const refresh = () => { void recover(); };
    const ch = supabase.channel('web_incoming_calls_' + uid)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_sessions', filter: 'receiver_id=eq.' + uid }, p => { void receive(p.new as CallSession); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_participants', filter: 'user_id=eq.' + uid }, async p => {
        const row = p.new as { call_session_id: string; status: string };
        if (row.status !== 'invited') return;
        const { data } = await supabase.from('call_sessions').select('*').eq('id', row.call_session_id).maybeSingle();
        if (data) void receive(data as CallSession);
      }).subscribe(status => { if (status === 'SUBSCRIBED') refresh(); });
    refresh();
    window.addEventListener('online', refresh); window.addEventListener('focus', refresh);
    const recoveryTimer = setInterval(refresh, 30000);
    const timer = setInterval(async () => {
      const invite = incomingRef.current;
      if (!invite || checking) return;
      checking = true;
      try {
      const { data, error } = await supabase.from('call_sessions').select('*').eq('id', invite.id).maybeSingle();
      const participant = invite.is_group_call ? await supabase.from('call_participants').select('status')
        .eq('call_session_id', invite.id).eq('user_id', uid).maybeSingle() : null;
      if (valid && uidRef.current === uid && incomingRef.current?.id === invite.id && (!ringing(invite)
        || (!error && (!data || !ringing(data as CallSession))) || (participant && !participant.error && participant.data?.status !== 'invited'))) {
        ++incomingGeneration.current; incomingRef.current = null; setIncoming(null);
      }
      } catch { /* Retry status without hiding a still-valid invitation on a network failure. */ }
      finally { checking = false; }
    }, 5000);
    return () => { valid = false; clearInterval(timer); clearInterval(recoveryTimer); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); void supabase.removeChannel(ch); };
  }, [supabase, uid]);

  function answer() {
    const session = incomingRef.current;
    if (!session || busy.current || !ringing(session)) return;
    void begin(async () => {
      incomingRef.current = null; ++incomingGeneration.current; setIncoming(null);
      if (session.is_group_call) return { ...session, status: 'active', provider_identity: await joinGroupCall(session.id) };
      await setCallStatus(session.id, 'active');
      return { ...session, status: 'active' };
    }, session.is_video);
  }
  async function decline() {
    const session = incomingRef.current;
    if (!session || busy.current) return;
    incomingRef.current = null; ++incomingGeneration.current; setIncoming(null);
    try { if (session.is_group_call) await declineGroupCall(session.id); else await setCallStatus(session.id, 'declined'); }
    catch { setCallError('The invitation is no longer available.'); }
  }
  return (
    <>
      {callError && !activeCall ? <div role="status" className="fixed bottom-4 inset-x-4 z-[60] mx-auto max-w-lg rounded-xl bg-navy p-4 text-white"><p>{callError}</p><button onClick={() => setCallError(null)} className="mt-2 underline">Dismiss</button></div> : null}
      {incoming ? (
        <div className="fixed inset-x-0 top-4 z-[60] mx-auto flex w-[380px] max-w-[92vw] items-center gap-3 rounded-xl border border-white/15 bg-navy p-3 shadow-2xl">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-porcelain">
            {incoming.is_video ? <Video size={18} /> : <Phone size={18} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold text-white">{incoming.caller_name}</span>
            <span className="block text-[12px] text-white/60">Incoming {incoming.is_video ? "video" : "voice"} call</span>
          </span>
          <button onClick={decline} title="Decline" className="rounded-full bg-danger p-2.5 text-white"><PhoneOff size={16} /></button>
          <button onClick={answer} disabled={connecting} title="Answer" className="rounded-full bg-success p-2.5 text-white disabled:opacity-50"><Phone size={16} /></button>
        </div>
      ) : null}

      <div className={((activeCall || connecting) ? "fixed" : "hidden") + " inset-0 z-[55] flex items-center justify-center bg-black/80 p-4"}>
        <div className="relative h-[85vh] w-full max-w-4xl"><button type="button" onClick={() => { void hangup(true); }} aria-label="End call" className="absolute right-2 top-2 z-20 rounded-full bg-danger p-3 text-white"><PhoneOff size={18} /></button>
          {connecting || reconnecting ? (
            <p role="status" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-white/60">{reconnecting ? 'Reconnecting…' : 'Connecting'}</p>
          ) : null}
          {callError ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
              <p className="max-w-md text-center text-[14px] text-danger">{callError}</p>
              <button onClick={() => hangup(true)} className="flex items-center gap-1.5 rounded-md bg-surface px-4 py-2 text-[13px] text-white"><X size={15} /> Close</button>
            </div>
          ) : null}
          <div ref={containerRef} className="h-full w-full" />
        </div>
      </div>
    </>
  );
}
