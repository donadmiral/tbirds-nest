"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function MessageButton({ profileId }: { profileId: string }) {
  const [uid, setUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => setUid(data.session?.user.id ?? null));
  }, []);

  if (!uid || uid === profileId) return null;

  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("start_dm_ctx", { p_receiver_id: profileId, p_context: "personal" });
      if (!error && data) router.push("/messages?c=" + data);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={open}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-4 py-2 text-[13px] font-semibold text-ink transition-colors duration-[140ms] hover:bg-ink/5 disabled:opacity-60"
    >
      <Mail size={14} strokeWidth={2} />
      Message
    </button>
  );
}