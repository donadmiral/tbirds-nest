"use client";

import { useEffect, useState } from "react";
import { Phone, Video, X } from "lucide-react";
import { checkLiveGroupCall, startGroupCall, requestGroupJoin, declineGroupCall, type LiveGroupCall } from "@/lib/calls";

export function GroupCallBar({ conversationId }: { conversationId: string }) {
  const [live, setLive] = useState<LiveGroupCall | null>(null);

  useEffect(() => {
    let on = true;
    const check = () => checkLiveGroupCall(conversationId).then(
      (l) => { console.log("[BAR]", conversationId.slice(0, 8), l ? "LIVE " + l.id.slice(0, 8) + " joined:" + l.joinedNames.length : "clear"); if (on) setLive(l); },
      (err) => { console.log("[BAR] check failed:", err instanceof Error ? err.message : err); if (on) setLive(null); }
    );
    check();
    const t = setInterval(check, 8000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { on = false; clearInterval(t); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [conversationId]);

  async function start(isVideo: boolean) {
    const sessionId = await startGroupCall(conversationId, isVideo);
    if (!sessionId) { alert("Could not start the call."); return; }
    requestGroupJoin({ sessionId, isVideo });
  }

  async function reject() {
    if (!live) return;
    setLive(null);
    try { await declineGroupCall(live.id); } catch { /* dead session declines can fail, dismissal stands */ }
  }

  if (live) {
    return (
      <div className="mt-2 flex w-full items-center gap-2.5 rounded-lg border border-success/40 bg-success/10 px-3 py-2.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-white">
            Ongoing {live.is_video ? "video" : "voice"} call · {live.joinedNames.length} in call
          </span>
          {live.joinedNames.length > 0 ? (
            <span className="block truncate text-[12px] text-white/55">{live.joinedNames.join(", ")}</span>
          ) : null}
        </span>
        <button onClick={() => requestGroupJoin({ sessionId: live.id, isVideo: live.is_video })} className="shrink-0 rounded-md bg-success px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90">Join</button>
        <button onClick={reject} title="Reject" className="shrink-0 rounded-md bg-surface p-1.5 text-white/60 transition-colors hover:bg-surface-elevated hover:text-danger"><X size={15} /></button>
      </div>
    );
  }

  const btn = "rounded-md p-2 text-white/60 transition-colors hover:bg-surface hover:text-pearl";
  return (
    <span className="ml-auto flex items-center gap-1">
      <button onClick={() => start(false)} title="Start group voice call" className={btn}><Phone size={17} /></button>
      <button onClick={() => start(true)} title="Start group video call" className={btn}><Video size={17} /></button>
    </span>
  );
}