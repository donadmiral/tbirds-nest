"use client";

import { useEffect, useRef, useState } from "react";
import { X, Megaphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Announcement = { id: string; title: string | null; body: string | null };
const DISMISS_KEY = "pc_dismissed_announcements";

export function AnnouncementBanner() {
  const supabase = useRef(createClient()).current;
  const [a, setA] = useState<Announcement | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("announcements").select("id, title, body").eq("active", true).limit(3);
      if (!data || data.length === 0) return;
      let dismissed: string[] = [];
      try { dismissed = JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]"); } catch { /* fresh */ }
      const next = (data as Announcement[]).find((x) => !dismissed.includes(x.id));
      if (next) setA(next);
    })();
  }, [supabase]);

  if (!a) return null;

  function dismiss() {
    try {
      const dismissed: string[] = JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]");
      localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed, a!.id]));
    } catch { /* fine */ }
    setA(null);
  }

  return (
    <div className="mb-3 flex items-start gap-3 rounded-lg border border-pearl/30 bg-surface p-3.5">
      <Megaphone size={17} className="mt-0.5 shrink-0 text-pearl" />
      <div className="min-w-0 flex-1">
        {a.title ? <p className="text-[14px] font-semibold text-ink">{a.title}</p> : null}
        {a.body ? <p className="mt-0.5 text-[13px] text-ink/70">{a.body}</p> : null}
      </div>
      <button onClick={dismiss} title="Dismiss" className="shrink-0 rounded-full p-1 text-ink/40 hover:bg-surface-elevated hover:text-ink">
        <X size={15} />
      </button>
    </div>
  );
}