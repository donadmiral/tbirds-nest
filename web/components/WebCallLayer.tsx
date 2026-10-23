"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { startOneToOneCall, getDailyRoom, setCallStatus, endCall, joinGroupCall, leaveGroupCall, declineGroupCall, type CallSession } from "@/lib/calls";

type Incoming = CallSession & { caller_name?: string };
const ringing = (s: CallSession) => s.status === 'ringing' && Date.now() < (s.expires_at ? Date.parse(s.expires_at) : Date.parse(s.created_at) + 90000);

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
    try { await frame?.destroy(); } catch { /* Already closed. */ }
  }, []);

  const releaseSession = useCallback(async (session: CallSession) => {
    if (session.is_group_call) await leaveGroupCall(session.id);
    else await endCall(session.id);
  }, []);

  const hangup = useCallback(async (record: boolean) => {
    ++generation.current;
    const session = activeCallRef.current;
    activeCallRef.current = null;
    busy.current = false;
    setActiveCall(null); setConnecting(false); setCallError(null);
    await teardownFrame();
    if (session && (record || session.is_group_call)) {
      try { await releaseSession(session); }
      catch { if (live.current) setCallError('The call closed on this device. Reconnecting to update its status.'); }
    }
  }, [teardownFrame, releaseSession]);

  useEffect(() => {
    live.current = true;
    let authRevision = 0;
    const apply = (session: { user: { id: string }; access_token: string } | null) => {
      const next = session?.user.id ?? null;
      if (uidRef.current !== next) {
        ++generation.current; ++incomingGeneration.current;
        busy.current = false; activeCallRef.current = null; incomingRef.current = null;
        setActiveCall(null); setIncoming(null); setConnecting(false); setCallError(null);
        void teardownFrame();
      }
      uidRef.current = next; setUid(next); tokenRef.current = session?.access_token ?? null;
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { ++authRevision; apply(session); });
    const revision = authRevision;
    void supabase.auth.getSession().then(({ data }) => { if (live.current && authRevision === revision) apply(data.session); });
    return () => { live.current = false; ++generation.current; ++incomingGeneration.current; subscription.unsubscribe(); void teardownFrame(); };
  }, [supabase, teardownFrame]);

  useEffect(() => {
    const onHide = () => {
      const c = activeCallRef.current, token = tokenRef.current;
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!c || !token || !url || !key) return;
      const target = c.is_group_call ? '/rest/v1/rpc/leave_group_call' : '/rest/v1/call_sessions?id=eq.' + c.id;
      void fetch(url + target, { method: c.is_group_call ? 'POST' : 'PATCH', keepalive: true,
        headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + token },
        body: JSON.stringify(c.is_group_call ? { p_session_id: c.id } : { status: 'ended' }),
      }).catch(() => {});
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  const begin = useCallback(async (create: () => Promise<CallSession | null>) => {
    if (busy.current || activeCallRef.current || !uidRef.current) return;
    busy.current = true;
    const operation = ++generation.current, account = uidRef.current;
    const current = () => live.current && generation.current === operation && uidRef.current === account;
    let session: CallSession | null = null;
    setConnecting(true); setCallError(null);
    try {
      session = await create();
      if (!session) throw new Error('unavailable');
      if (!current()) { if (uidRef.current === account) await releaseSession(session).catch(() => {}); return; }
      activeCallRef.current = session; setActiveCall(session);
      const room = await getDailyRoom(session.id);
      if (!current()) return;
      if (!room) throw new Error('unavailable');
      const DailyIframe = (await import('@daily-co/daily-js')).default;
      if (!current()) return;
      if (!containerRef.current) throw new Error('unavailable');
      const frame = DailyIframe.createFrame(containerRef.current, { showLeaveButton: true,
        iframeStyle: { width: '100%', height: '100%', border: '0', borderRadius: '12px' } });
      frameRef.current = frame as unknown as { destroy: () => Promise<void> };
      frame.on('left-meeting', () => { if (current() && frameRef.current === frame) void hangup(true); });
      frame.on('error', () => { if (current()) { void hangup(true).then(() => { if (live.current) setCallError('The call was interrupted. Check your connection and try again.'); }); } });
      await frame.join({ url: room.roomUrl, token: room.token, startVideoOff: !session.is_video });
      if (current()) setConnecting(false);
    } catch {
      if (current()) {
        await teardownFrame();
        activeCallRef.current = null; setActiveCall(null); setConnecting(false);
        setCallError('Could not connect this call. Check camera and microphone permissions, your connection, and try again.');
        if (session) await releaseSession(session).catch(() => {});
      }
    } finally { if (current()) busy.current = false; }
  }, [hangup, releaseSession, teardownFrame]);

  useEffect(() => {
    const start = (event: Event) => {
      const d = (event as CustomEvent).detail as { receiverId: string; conversationId: string | null; isVideo: boolean };
      void begin(() => startOneToOneCall(d.receiverId, d.conversationId, d.isVideo));
    };
    const group = (event: Event) => {
      const d = (event as CustomEvent).detail as { sessionId: string };
      void begin(async () => {
        await joinGroupCall(d.sessionId);
        const { data, error } = await supabase.from('call_sessions').select('*').eq('id', d.sessionId).single();
        if (error || !data) { await leaveGroupCall(d.sessionId).catch(() => {}); throw new Error('unavailable'); }
        return data as CallSession;
      });
    };
    window.addEventListener('pc-start-call', start); window.addEventListener('pc-join-group-call', group);
    return () => { window.removeEventListener('pc-start-call', start); window.removeEventListener('pc-join-group-call', group); };
  }, [begin, supabase]);

  useEffect(() => {
    if (!activeCall || !uid) return;
    const check = async () => {
      const sessionId = activeCall.id;
      const { data, error } = await supabase.from('call_sessions').select('status').eq('id', sessionId).maybeSingle();
      if (activeCallRef.current?.id !== sessionId) return;
      if (!error && (!data || !['ringing', 'active'].includes(data.status))) { void hangup(false); return; }
      if (activeCall.is_group_call) {
        const { data: part, error: partError } = await supabase.from('call_participants').select('status').eq('call_session_id', sessionId).eq('user_id', uid).maybeSingle();
        if (activeCallRef.current?.id !== sessionId) return;
        if (!partError && part?.status !== 'joined') { void hangup(false); return; }
        await supabase.from('call_participants').update({ last_seen_at: new Date().toISOString() }).eq('call_session_id', sessionId).eq('user_id', uid).eq('status', 'joined');
      }
    };
    const ch = supabase.channel('web_call_' + activeCall.id)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_sessions', filter: 'id=eq.' + activeCall.id }, () => { void check(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_participants', filter: 'call_session_id=eq.' + activeCall.id }, () => { void check(); }).subscribe();
    const timer = setInterval(() => { void check(); }, 30000);
    return () => { clearInterval(timer); void supabase.removeChannel(ch); };
  }, [supabase, activeCall, uid, hangup]);

  useEffect(() => {
    if (!uid) return;
    let valid = true;
    const receive = async (session: CallSession) => {
      if (!valid || !ringing(session) || busy.current || activeCallRef.current) return;
      const operation = ++incomingGeneration.current;
      incomingRef.current = session; setIncoming(session);
      const { data } = await supabase.from('profiles').select('full_name').eq('id', session.initiator_id).maybeSingle();
      if (valid && incomingGeneration.current === operation && incomingRef.current?.id === session.id && ringing(session)) {
        const invite = { ...session, caller_name: (data?.full_name || 'Someone') + (session.is_group_call ? ' · group call' : '') };
        incomingRef.current = invite; setIncoming(invite);
      }
    };
    const ch = supabase.channel('web_incoming_calls_' + uid)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_sessions', filter: 'receiver_id=eq.' + uid }, p => { void receive(p.new as CallSession); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_participants', filter: 'user_id=eq.' + uid }, async p => {
        const row = p.new as { call_session_id: string; status: string };
        if (row.status !== 'invited') return;
        const { data } = await supabase.from('call_sessions').select('*').eq('id', row.call_session_id).maybeSingle();
        if (data) void receive(data as CallSession);
      }).subscribe();
    const timer = setInterval(async () => {
      const invite = incomingRef.current;
      if (!invite) return;
      const { data, error } = await supabase.from('call_sessions').select('*').eq('id', invite.id).maybeSingle();
      if (valid && incomingRef.current?.id === invite.id && (!ringing(invite) || (!error && (!data || !ringing(data as CallSession))))) {
        ++incomingGeneration.current; incomingRef.current = null; setIncoming(null);
      }
    }, 2000);
    return () => { valid = false; clearInterval(timer); void supabase.removeChannel(ch); };
  }, [supabase, uid]);

  function answer() {
    const session = incomingRef.current;
    if (!session || busy.current || !ringing(session)) return;
    incomingRef.current = null; ++incomingGeneration.current; setIncoming(null);
    void begin(async () => {
      if (session.is_group_call) await joinGroupCall(session.id); else await setCallStatus(session.id, 'active');
      return { ...session, status: 'active' };
    });
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
          <button onClick={answer} title="Answer" className="rounded-full bg-success p-2.5 text-white"><Phone size={16} /></button>
        </div>
      ) : null}

      <div className={((activeCall || connecting) ? "fixed" : "hidden") + " inset-0 z-[55] flex items-center justify-center bg-black/80 p-4"}>
        <div className="relative h-[85vh] w-full max-w-4xl"><button type="button" onClick={() => { void hangup(true); }} aria-label="End call" className="absolute right-2 top-2 z-20 rounded-full bg-danger p-3 text-white"><PhoneOff size={18} /></button>
          {connecting ? (
            <p className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-white/60">Connecting</p>
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