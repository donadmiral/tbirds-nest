"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadConversations } from "@/lib/messages";

export function MarketUnreadDot() {
  const supabase = useRef(createClient()).current;
  const [n, setN] = useState(0);

  useEffect(() => {
    let on = true;
    async function check() {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return;
      const convs = await loadConversations(uid, "market");
      if (on) setN(convs.reduce((sum, c) => sum + (c.unread ?? 0), 0));
    }
    check();
    const t = setInterval(check, 30000);
    return () => { on = false; clearInterval(t); };
  }, [supabase]);

  if (n === 0) return null;
  return (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-pearl px-1 text-[9px] font-bold text-ink">
      {n > 9 ? "9+" : n}
    </span>
  );
}