"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { ArrowLeft, UserMinus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonName } from "@/components/PersonName";

type Row = { user_id: string; created_at: string | null; full_name: string | null; username: string | null; avatar_url: string | null };

// Restrict is the quiet alternative to a block: their comments on your posts wait for your approval,
// their messages go to Message requests, nothing they do notifies you, and they are not told.
export default function RestrictedAccountsPage() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_restricted_accounts");
    if (error) { setErr(error.message); return; }
    setRows(((data ?? []) as Row[]));
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  const unrestrict = async (row: Row) => {
    const name = row.full_name || (row.username ? "@" + row.username : "this person");
    if (!confirm(name + "'s comments will show on your posts as usual and their messages will come straight to your chats. Unrestrict?")) return;
    setBusy(b => ({ ...b, [row.user_id]: true }));
    const { error } = await supabase.rpc("set_restriction", { p_user: row.user_id, p_on: false });
    setBusy(b => { const n = { ...b }; delete n[row.user_id]; return n; });
    if (error) { alert("Could not unrestrict: " + error.message); return; }
    setRows(r => (r ?? []).filter(x => x.user_id !== row.user_id));
  };

  return (
    <div className="mx-auto max-w-[560px] px-1">
      <Link href="/settings" aria-label="Back to Settings" className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><ArrowLeft size={19} /></Link>
      <h1 className="flex items-center gap-2 pb-1 font-display text-xl text-porcelain"><UserMinus size={19} className="text-pearl" /> Restricted accounts</h1>
      <p className="pb-5 text-[13px] text-ink/50">A restricted person's comments on your posts wait for your approval, their messages go to Message requests, and nothing they do notifies you. They are not told. Restrict someone from their profile or from one of their comments.</p>
      {err ? <p className="text-sm text-red-400">{err}</p> : rows === null ? <p className="py-10 text-center text-sm text-ink/40">Loading</p>
      : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-ink/15 py-14 text-center">
          <UserMinus size={28} className="text-ink/25" />
          <p className="text-[14px] font-semibold text-ink">Nobody is restricted</p>
        </div>
      ) : rows.map(r => (
        <div key={r.user_id} className="mb-2 flex items-center gap-3.5 rounded-lg border border-ink/10 p-3.5">
          <Link href={r.username ? "/" + r.username : "#"} className="shrink-0">
            {r.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displayImageUrl(r.avatar_url, 200) ?? r.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
            ) : <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy text-[17px] font-semibold text-white">{(r.full_name || "U").charAt(0)}</span>}
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold text-ink"><PersonName name={r.full_name || "User"} userId={r.user_id} badgeSize={13} /></p>
            {r.username ? <p className="text-[12px] text-ink/45">@{r.username}</p> : null}
          </div>
          <button onClick={() => unrestrict(r)} disabled={!!busy[r.user_id]} className="rounded-full border border-ink/15 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink transition-colors duration-[140ms] hover:bg-surface disabled:opacity-40">Unrestrict</button>
        </div>
      ))}
    </div>
  );
}
