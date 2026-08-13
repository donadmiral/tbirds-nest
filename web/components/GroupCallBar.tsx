"use client";

import { useEffect, useState } from "react";
import { Phone, Video } from "lucide-react";
import { checkLiveGroupCall, startGroupCall, requestGroupJoin, type LiveGroupCall } from "@/lib/calls";

export function GroupCallBar({ conversationId }: { conversationId: string }) {
  const [live, setLive] = useState<LiveGroupCall | null>(null);

  useEffect(() => {
    let on = true;
    const check = () => checkLiveGroupCall(conversationId).then((l) => { if (on) setLive(l); });
    check();
    const t = setInterval(check, 8000);
    return () => { on = false; clearInterval(t); };
  }, [conversationId]);

  async function start(isVideo: boolean) {
    const sessionId = await startGroupCall(conversationId, isVideo);
    if (!sessionId) { alert("Could not start the call."); return; }
    requestGroupJoin({ sessionId, isVideo });
  }

  if (live) {
    return (
      <button onClick={() => requestGroupJoin({ sessionId: live.id, isVideo: live.is_video })}
        className="mt-2 flex w-full items-center gap-2.5 rounded-lg border border-success/40 bg-success/10 px-3 py-2.5 text-left transition-colors hover:bg-success/15"
      >
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
        <span className="shrink-0 rounded-md bg-success px-3 py-1.5 text-[12px] font-semibold text-white">Join</span>
      </button>
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