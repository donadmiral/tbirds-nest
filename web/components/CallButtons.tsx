"use client";

import { Phone, Video } from "lucide-react";
import { requestWebCall } from "@/lib/calls";

export function CallButtons({ otherId, conversationId, name }: { otherId: string | null; conversationId: string | null; name: string }) {
  if (!otherId) return null;
  const btn = "rounded-md p-2 text-white/60 transition-colors hover:bg-surface hover:text-pearl";
  return (
    <span className="ml-auto flex items-center gap-1">
      <button onClick={() => requestWebCall({ receiverId: otherId, conversationId, isVideo: false, name })} title="Voice call" className={btn}>
        <Phone size={17} />
      </button>
      <button onClick={() => requestWebCall({ receiverId: otherId, conversationId, isVideo: true, name })} title="Video call" className={btn}>
        <Video size={17} />
      </button>
    </span>
  );
}