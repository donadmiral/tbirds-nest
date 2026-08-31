"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FollowButton } from "@/components/FollowButton";
import { VerifiedBadge } from "@/components/VerifiedBadge";

type Person = { id: string; full_name: string | null; username: string | null; avatar_url: string | null; is_verified?: boolean | null; verified_tier?: string | null };
const PAGE = 40;

function initials(name?: string | null) {
  return (name || "M").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

export default function FollowsPage() {
  const supabase = createClient();
  const params = useParams<{ username: string }>();
  const sp = useSearchParams();
  const username = String(params.username || "");
  const [target, setTarget] = useState<Person | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [tab, setTab] = useState<"followers" | "following">(sp.get("tab") === "following" ? "following" : "followers");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      setMe(sess.session?.user.id ?? null);
      const { data } = await supabase.from("profiles").select("id, full_name, username, avatar_url").ilike("username", username).limit(1).maybeSingle();
      setTarget((data as Person) ?? null);
      if (!data) setLoading(false);
    })();
  }, [username, supabase]);

  const load = useCallback(async (which: "followers" | "following", pageN: number, replace: boolean) => {
    if (!target) return;
    if (replace) setLoading(true);
    try {
      const from = pageN * PAGE;
      const col = which === "followers" ? "follower_id" : "following_id";
      const eqCol = which === "followers" ? "following_id" : "follower_id";
      const { data: rows } = await supabase.from("follows").select(col).eq(eqCol, target.id).neq(col, target.id)
        .order("created_at", { ascending: false }).range(from, from + PAGE - 1);
      const ids = ((rows ?? []) as any[]).map(r => r[col]).filter(Boolean);
      let found: Person[] = [];
      if (ids.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name, username, avatar_url, is_verified, verified_tier").in("id", ids);
        const byId = new Map(((profs ?? []) as Person[]).map(p => [p.id, p]));
        found = ids.map(id => byId.get(id)).filter(Boolean) as Person[];
      }
      setPeople(prev => replace ? found : [...prev, ...found]);
      setHasMore(ids.length >= PAGE);
      setPage(pageN);
    } finally { setLoading(false); }
  }, [target, supabase]);

  useEffect(() => { if (target) { setPeople([]); setPage(0); load(tab, 0, true); } }, [tab, target, load]);

  const removeFollower = async (p: Person) => {
    if (!window.confirm((p.full_name || "This member") + " will no longer follow you. Remove?")) return;
    const { error } = await supabase.rpc("remove_follower", { p_follower_id: p.id });
    if (!error) setPeople(prev => prev.filter(x => x.id !== p.id));
  };

  const filtered = useMemo(() => {
    const qn = query.trim().toLowerCase();
    if (!qn) return people;
    return people.filter(p => (p.full_name || "").toLowerCase().includes(qn) || (p.username || "").toLowerCase().includes(qn));
  }, [people, query]);

  const isSelf = !!me && !!target && me === target.id;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[560px] px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link href={"/" + username} className="rounded-full p-1.5 text-ink/60 hover:bg-ink/5 hover:text-ink"><ArrowLeft size={20} /></Link>
        <h1 className="text-lg font-semibold text-ink">@{username}</h1>
      </div>
      <div className="mb-4 flex border-b border-ink/10">
        {(["followers", "following"] as const).map(k => (
          <button key={k} onClick={() => setTab(k)}
            className={"flex-1 pb-2.5 text-[14px] font-semibold " + (tab === k ? "border-b-2 border-[#0B1E3D] text-[#0B1E3D]" : "text-ink/45")}>
            {k === "followers" ? "Followers" : "Following"}
          </button>
        ))}
      </div>
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-ink/5 px-3 py-2">
        <Search size={15} className="text-ink/40" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search"
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink/40" />
        {query ? <button onClick={() => setQuery("")}><X size={15} className="text-ink/40" /></button> : null}
      </div>
      {loading ? (
        <p className="py-16 text-center text-sm text-ink/40">Loading…</p>
      ) : !target ? (
        <p className="py-16 text-center text-sm text-ink/40">Profile not found.</p>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink/40">{query ? "No matches." : tab === "followers" ? "No followers yet." : "Not following anyone yet."}</p>
      ) : (
        <ul>
          {filtered.map(p => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <Link href={"/" + (p.username ?? "")} className="flex min-w-0 flex-1 items-center gap-3">
                {p.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(p.avatar_url, 200) ?? p.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink/5 text-[14px] font-bold text-[#0B1E3D]">{initials(p.full_name)}</span>
                )}
                <span className="min-w-0">
                  <span className="flex items-center gap-[3px]">
                    <span className="truncate text-[14.5px] font-semibold text-ink">{p.full_name || "Member"}</span>
                    {p.is_verified ? <VerifiedBadge tier={p.verified_tier ?? undefined} size={13} /> : null}
                  </span>
                  {p.username ? <span className="block truncate text-[12.5px] text-ink/45">@{p.username}</span> : null}
                </span>
              </Link>
              {me && me !== p.id ? <FollowButton authorId={p.id} /> : null}
              {isSelf && tab === "followers" && me !== p.id ? (
                <button onClick={() => removeFollower(p)} className="rounded-full p-1.5 text-ink/40 hover:bg-ink/5 hover:text-ink" title="Remove follower"><X size={15} /></button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!loading && hasMore && !query ? (
        <button onClick={() => load(tab, page + 1, false)} className="mx-auto mt-4 block rounded-full bg-ink/5 px-5 py-2 text-[13px] font-semibold text-ink hover:bg-ink/10">Show more</button>
      ) : null}
    </main>
  );
}
