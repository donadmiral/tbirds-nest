"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { startOneToOneCall, getDailyRoom, setCallStatus, endCall, type CallSession } from "@/lib/calls";

type Incoming = CallSession & { caller_name?: string };

export function WebCallLayer() {
  const supabase = useRef(createClient()).current;
  const frameRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<CallSession | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [connecting, setConnecting] = useState(false);
  const activeCallRef = useRef<CallSession | null>(null);
  activeCallRef.current = activeCall;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUid(data.session?.user.id ?? null));
  }, [supabase]);

  const teardownFrame = useCallback(async () => {
    if (frameRef.current) {
      try { await frameRef.current.destroy(); } catch { /* gone */ }
      frameRef.current = null;
    }
  }, []);

  const hangup = useCallback(async (record: boolean) => {
    const c = activeCallRef.current;
    await teardownFrame();
    setActiveCall(null);
    setConnecting(false);
    if (c && record) await endCall(c.id);
  }, [teardownFrame]);

  const joinRoom = useCallback(async (session: CallSession) => {
    setConnecting(true);
    const room = await getDailyRoom(session.id);
    if (!room || !containerRef.current) {
      setConnecting(false);
      alert("Could not connect the call.");
      await endCall(session.id);
      setActiveCall(null);
      return;
    }
    const DailyIframe = (await import("@daily-co/daily-js")).default;
    const frame = DailyIframe.createFrame(containerRef.current, {
      showLeaveButton: true,
      iframeStyle: { width: "100%", height: "100%", border: "0", borderRadius: "12px" },
    });
    frameRef.current = frame as unknown as { destroy: () => Promise<void> };
    frame.on("left-meeting", () => { hangup(true); });
    await frame.join({ url: room.roomUrl, token: room.token, startVideoOff: !session.is_video });
    setConnecting(false);
  }, [hangup]);

  useEffect(() => {
    async function onStart(e: Event) {
      if (activeCallRef.current) return;
      const d = (e as CustomEvent).detail as { receiverId: string; conversationId: string | null; isVideo: boolean; name: string };
      const session = await startOneToOneCall(d.receiverId, d.conversationId, d.isVideo);
      if (!session) { alert("Could not start the call."); return; }
      setActiveCall(session);
      await joinRoom(session);
    }
    window.addEventListener("pc-start-call", onStart);
    return () => window.removeEventListener("pc-start-call", onStart);
  }, [joinRoom]);

  useEffect(() => {
    if (!activeCall) return;
    const ch = supabase
      .channel("web_call_" + activeCall.id)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "call_sessions", filter: "id=eq." + activeCall.id }, (p) => {
        const s = (p.new as CallSession).status;
        if (s === "ended" || s === "declined" || s === "missed") hangup(false);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, activeCall, hangup]);

  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel("web_incoming_calls")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "call_sessions", filter: "receiver_id=eq." + uid }, async (p) => {
        const s = p.new as CallSession;
        if (s.status !== "ringing" || activeCallRef.current) return;
        if (s.expires_at && new Date(s.expires_at).getTime() < Date.now()) return;
        const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", s.initiator_id).maybeSingle();
        setIncoming({ ...s, caller_name: prof?.full_name ?? "Someone" });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "call_sessions", filter: "receiver_id=eq." + uid }, (p) => {
        const s = p.new as CallSession;
        setIncoming((cur) => (cur && cur.id === s.id && s.status !== "ringing" ? null : cur));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, uid]);

  async function answer() {
    if (!incoming) return;
    const s = incoming;
    setIncoming(null);
    await setCallStatus(s.id, "active");
    setActiveCall(s);
    await joinRoom(s);
  }

  async function decline() {
    if (!incoming) return;
    await setCallStatus(incoming.id, "declined");
    setIncoming(null);
  }

  return (
    <>
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

      <div className={(activeCall ? "fixed" : "hidden") + " inset-0 z-[55] flex items-center justify-center bg-black/80 p-4"}>
        <div className="relative h-[85vh] w-full max-w-4xl">
          {connecting ? (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-white/60">Connecting</p>
          ) : null}
          <div ref={containerRef} className="h-full w-full" />
        </div>
      </div>
    </>
  );
}