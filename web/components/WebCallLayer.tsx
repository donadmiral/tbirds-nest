"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { startOneToOneCall, getDailyRoom, setCallStatus, endCall, joinGroupCall, leaveGroupCall, declineGroupCall, type CallSession } from "@/lib/calls";

type Incoming = CallSession & { caller_name?: string };

export function WebCallLayer() {
  const supabase = useRef(createClient()).current;
  const frameRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [activeCall, setActiveCall] = useState<CallSession | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const activeCallRef = useRef<CallSession | null>(null);
  activeCallRef.current = activeCall;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUid(data.session?.user.id ?? null);
      tokenRef.current = data.session?.access_token ?? null;
    });
  }, [supabase]);

  // A closed tab must not leave a zombie joined row: keepalive leave on pagehide.
  useEffect(() => {
    function onHide() {
      const c = activeCallRef.current;
      const token = tokenRef.current;
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!c || !c.is_group_call || !token || !url || !key) return;
      fetch(url + "/rest/v1/rpc/leave_group_call", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", apikey: key, Authorization: "Bearer " + token },
        body: JSON.stringify({ p_session_id: c.id }),
      }).catch(() => {});
    }
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  const teardownFrame = useCallback(async () => {
    if (frameRef.current) {
      try { await frameRef.current.destroy(); } catch { /* gone */ }
      frameRef.current = null;
    }
  }, []);

  const hangup = useCallback(async (record: boolean) => {
    const c = activeCallRef.current;
    console.log("[CALL] hangup, record:", record, "session:", c?.id);
    await teardownFrame();
    setActiveCall(null);
    setConnecting(false);
    setCallError(null);
    if (!c) return;
    if (c.is_group_call) await leaveGroupCall(c.id);
    else if (record) await endCall(c.id);
  }, [teardownFrame]);

  const joinRoom = useCallback(async (session: CallSession) => {
    setConnecting(true);
    setCallError(null);
    console.log("[CALL] fetching daily room for session", session.id);
    try {
      const room = await getDailyRoom(session.id);
      console.log("[CALL] daily room result:", room ? { roomUrl: room.roomUrl, tokenLen: room.token?.length } : null);
      if (!room) throw new Error("daily-get-token returned no room or token");
      if (!containerRef.current) throw new Error("call container missing");
      const DailyIframe = (await import("@daily-co/daily-js")).default;
      console.log("[CALL] creating frame");
      const frame = DailyIframe.createFrame(containerRef.current, {
        showLeaveButton: true,
        iframeStyle: { width: "100%", height: "100%", border: "0", borderRadius: "12px" },
      });
      frameRef.current = frame as unknown as { destroy: () => Promise<void> };
      frame.on("left-meeting", () => { console.log("[CALL] left-meeting"); hangup(true); });
      frame.on("error", (e: unknown) => { console.log("[CALL] frame error:", e); });
      frame.on("loaded", () => { console.log("[CALL] frame loaded"); setConnecting(false); });
      console.log("[CALL] joining", room.roomUrl);
      await frame.join({ url: room.roomUrl, token: room.token, startVideoOff: !session.is_video });
      console.log("[CALL] joined");
      setConnecting(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log("[CALL] JOIN FAILED:", msg);
      setCallError(msg);
      setConnecting(false);
    }
  }, [hangup]);

  useEffect(() => {
    async function onStart(e: Event) {
      if (activeCallRef.current) return;
      const d = (e as CustomEvent).detail as { receiverId: string; conversationId: string | null; isVideo: boolean; name: string };
      console.log("[CALL] starting", d.isVideo ? "video" : "voice", "call to", d.receiverId);
      const session = await startOneToOneCall(d.receiverId, d.conversationId, d.isVideo);
      console.log("[CALL] session created:", session?.id ?? "FAILED");
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
        console.log("[CALL] session status changed:", s);
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
        console.log("[CALL] incoming session:", s.id, "status:", s.status);
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

  useEffect(() => {
    async function onGroupJoin(e: Event) {
      if (activeCallRef.current) return;
      const d = (e as CustomEvent).detail as { sessionId: string; isVideo: boolean };
      console.log("[CALL] joining group session", d.sessionId);
      await joinGroupCall(d.sessionId);
      const session = { id: d.sessionId, is_video: d.isVideo, is_group_call: true, status: "active" } as CallSession;
      setActiveCall(session);
      await joinRoom(session);
    }
    window.addEventListener("pc-join-group-call", onGroupJoin);
    return () => window.removeEventListener("pc-join-group-call", onGroupJoin);
  }, [joinRoom]);

  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel("web_incoming_group_calls")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "call_participants", filter: "user_id=eq." + uid }, async (p) => {
        const row = p.new as { call_session_id: string; status: string };
        if (row.status !== "invited" || activeCallRef.current) return;
        const { data: s } = await supabase.from("call_sessions").select("*").eq("id", row.call_session_id).maybeSingle();
        if (!s || s.status !== "ringing") return;
        if (s.expires_at && new Date(s.expires_at).getTime() < Date.now()) return;
        const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", s.initiator_id).maybeSingle();
        setIncoming({ ...(s as CallSession), caller_name: (prof?.full_name ?? "Someone") + " · group call" });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, uid]);

  async function answer() {
    if (!incoming) return;
    const s = incoming;
    console.log("[CALL] answering", s.id);
    setIncoming(null);
    if (s.is_group_call) await joinGroupCall(s.id);
    else await setCallStatus(s.id, "active");
    setActiveCall(s);
    await joinRoom(s);
  }

  async function decline() {
    if (!incoming) return;
    console.log("[CALL] declining", incoming.id);
    if (incoming.is_group_call) await declineGroupCall(incoming.id);
    else await setCallStatus(incoming.id, "declined");
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