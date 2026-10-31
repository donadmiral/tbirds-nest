"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadConversations } from "@/lib/messages";
import { withTimeout } from "@/lib/withTimeout";

export function MarketUnreadDot() {
  const [supabase] = useState(createClient);
  const [n, setN] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let on = true;
    let pending = false;
    async function check() {
      if (pending) return;
      pending = true;
      try {
        const { data, error } = await withTimeout(supabase.auth.getSession());
        if (error) throw error;
        const uid = data.session?.user.id;
        const convs = uid ? await withTimeout(loadConversations(uid, "market")) : [];
        if (on) { setN(convs.reduce((sum, c) => sum + (c.unread ?? 0), 0)); setUnavailable(false); }
      } catch { if (on) setUnavailable(true); }
      finally { pending = false; }
    }
    void check();
    const t = setInterval(check, 30000);
    return () => { on = false; clearInterval(t); };
  }, [supabase]);

  if (unavailable) return <span role="status" aria-label="Message count unavailable" title="Message updates could not load. They will be checked again shortly." className="absolute -right-1 -top-1 text-xs text-muted">!</span>;
  if (n === 0) return null;
  return (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-pearl px-1 text-[9px] font-bold text-on-pearl">
      {n > 9 ? "9+" : n}
    </span>
  );
}
