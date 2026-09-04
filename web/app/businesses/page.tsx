"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { Briefcase, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";

type Row = { business_id: string; full_name: string | null; username: string | null; avatar_url: string | null; role: string; category: string | null; is_verified: boolean; member_count: number; post_count: number };

export default function BusinessesPage() {
  const supabase = useRef(createClient()).current;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_my_businesses");
    if (error) { setErr(error.message); return; }
    setRows((data as Row[]) ?? []);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto max-w-[640px] px-1">
      <div className="flex items-center justify-between pb-1">
        <h1 className="flex items-center gap-2 font-display text-xl text-porcelain"><Briefcase size={19} className="text-pearl" /> Businesses</h1>
        <Link href="/businesses/new" className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-bold text-white"><Plus size={14} /> New</Link>
      </div>
      <p className="pb-5 text-[13px] text-ink/50">Pages you run, and your team.</p>

      {err ? <p className="text-sm text-red-400">{err}</p> : rows === null ? <p className="py-10 text-center text-sm text-ink/40">Loading</p>
      : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-ink/15 px-6 py-16 text-center">
          <Briefcase size={30} className="text-ink/25" />
          <p className="text-[15px] font-semibold text-ink">No businesses yet</p>
          <p className="max-w-[340px] text-[13px] text-ink/50">A business gets its own profile, followers, posts and chats. You stay signed in as yourself and choose who to post as — nobody shares a password.</p>
          <Link href="/businesses/new" className="mt-1 rounded-full bg-ink px-5 py-2 text-[13.5px] font-bold text-white">Create a business</Link>
        </div>
      ) : rows.map(r => (
        <Link key={r.business_id} href={"/" + (r.username || "")} className="mb-2 flex items-center gap-3 rounded-xl border border-ink/10 p-3.5 transition-colors hover:bg-ink/[0.02]">
          {r.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(r.avatar_url, 200) ?? r.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : <span className="flex h-12 w-12 items-center justify-center rounded-full bg-navy text-[14px] font-semibold text-white">{(r.full_name || "B").charAt(0)}</span>}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold text-ink">{r.full_name || "Business"} <VerifiedBadge userId={r.business_id} size={13} /></p>
            <p className="text-[12px] text-ink/45">{r.category || "Business"} · {r.member_count} team{r.member_count === 1 ? "" : "s"} · {r.post_count} posts</p>
          </div>
          <span className="shrink-0 rounded-full bg-pearl/15 px-2.5 py-1 text-[11px] font-bold capitalize text-pearl">{r.role}</span>
        </Link>
      ))}
    </div>
  );
}
