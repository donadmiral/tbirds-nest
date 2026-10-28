"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FollowButton } from "@/components/FollowButton";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { isProfileId, matchesUsername, profilePath, usernameLookupPattern } from "@/lib/profileLookup";

type Person = { id: string; full_name: string | null; username: string | null; avatar_url: string | null; is_verified?: boolean | null; verified_tier?: string | null };
const PAGE = 40;

function initials(name?: string | null) {
  return (name || "M").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

export default function FollowsPage() {
  const supabase = useMemo(createClient, []);
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
  const [profileError, setProfileError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [profileRetry, setProfileRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const listGeneration = useRef(0);
  const pageInFlight = useRef(false);
  const removingId = useRef<string | null>(null);
  const listRetry = useRef({ pageN: 0, replace: true });

  useEffect(() => {
    let cancelled = false;
    listGeneration.current += 1;
    setTarget(null); setPeople([]); setHasMore(false); setLoading(true); setProfileError(null); setListError(null);
    (async () => {
      try {
        const { data: sess, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (cancelled) return;
        setMe(sess.session?.user.id ?? null);
        const query = supabase.from("profiles").select("id, full_name, username, avatar_url");
        const byId = isProfileId(username);
        const { data, error } = await (byId ? query.eq("id", username) : query.ilike("username", usernameLookupPattern(username))).limit(1).maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        const profile = (byId ? data?.id === username.toLowerCase() : matchesUsername(data, username)) ? (data as Person) : null;
        setTarget(profile);
        if (!profile) setLoading(false);
      } catch {
        if (!cancelled) { setProfileError("Could not load this profile. Please try again."); setLoading(false); }
      }
    })();
    return () => { cancelled = true; listGeneration.current += 1; };
  }, [username, supabase, profileRetry]);

  const load = useCallback(async (which: "followers" | "following", pageN: number, replace: boolean) => {
    if (!target) return;
    if (!replace && pageInFlight.current) return;
    const generation = replace ? ++listGeneration.current : listGeneration.current;
    pageInFlight.current = true;
    listRetry.current = { pageN, replace };
    setListError(null);
    if (replace) setLoading(true); else setLoadingMore(true);
    try {
      const from = pageN * PAGE;
      const col = which === "followers" ? "follower_id" : "following_id";
      const eqCol = which === "followers" ? "following_id" : "follower_id";
      const { data: rows, error } = await supabase.from("follows").select(col).eq(eqCol, target.id).neq(col, target.id)
        .order("created_at", { ascending: false }).order(col, { ascending: false }).range(from, from + PAGE - 1);
      if (error) throw error;
      const ids = ((rows ?? []) as any[]).map(r => r[col]).filter(Boolean);
      let found: Person[] = [];
      if (ids.length > 0) {
        const { data: profs, error: profileReadError } = await supabase.from("profiles").select("id, full_name, username, avatar_url, is_verified, verified_tier").in("id", ids);
        if (profileReadError) throw profileReadError;
        const byId = new Map(((profs ?? []) as Person[]).map(p => [p.id, p]));
        found = ids.map(id => byId.get(id)).filter(Boolean) as Person[];
      }
      if (generation !== listGeneration.current) return;
      setPeople(prev => replace ? found : [...new Map([...prev, ...found].map(person => [person.id, person])).values()]);
      setHasMore(ids.length >= PAGE);
      setPage(pageN);
    } catch {
      if (generation === listGeneration.current) setListError("Could not load connections. Please try again.");
    } finally {
      if (generation === listGeneration.current) { pageInFlight.current = false; setLoading(false); setLoadingMore(false); }
    }
  }, [target, supabase]);

  useEffect(() => {
    if (target) { setPeople([]); setPage(0); setHasMore(false); void load(tab, 0, true); }
    return () => { listGeneration.current += 1; pageInFlight.current = false; };
  }, [tab, target, load]);

  const removeFollower = async (p: Person) => {
    if (removingId.current) return;
    if (!window.confirm((p.full_name || "This member") + " will no longer follow you. Remove?")) return;
    removingId.current = p.id; setRemoving(p.id); setListError(null);
    const generation = listGeneration.current;
    try {
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !target || session.session?.user.id !== target.id) throw new Error("Account changed");
      const { error } = await supabase.rpc("remove_follower", { p_follower_id: p.id });
      if (error) throw error;
      if (generation === listGeneration.current) await load(tab, 0, true);
    } catch {
      if (generation === listGeneration.current) {
        listRetry.current = { pageN: 0, replace: true };
        setListError("Could not remove this follower. Refresh the list before trying again.");
      }
    } finally { removingId.current = null; setRemoving(null); }
  };

  const filtered = useMemo(() => {
    const qn = query.trim().toLowerCase();
    if (!qn) return people;
    return people.filter(p => (p.full_name || "").toLowerCase().includes(qn) || (p.username || "").toLowerCase().includes(qn));
  }, [people, query]);

  const isSelf = !!me && !!target && me === target.id;

  return (
    <section className="mx-auto min-h-[65vh] w-full max-w-[560px] px-2 py-4">
      <div className="mb-4 flex items-center gap-3">
        <Link href={"/" + encodeURIComponent(username)} aria-label="Back to profile" className="rounded-full p-1.5 text-ink/60 hover:bg-ink/5 hover:text-ink"><ArrowLeft size={20} /></Link>
        <h1 className="text-lg font-semibold text-ink">{target?.username ? "@" + target.username : target?.full_name || "Connections"}</h1>
      </div>
      <div className="mb-4 flex border-b border-ink/10">
        {(["followers", "following"] as const).map(k => (
          <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}
            className={"flex-1 pb-2.5 text-[14px] font-semibold " + (tab === k ? "border-b-2 border-ink text-ink" : "text-muted")}>
            {k === "followers" ? "Followers" : "Following"}
          </button>
        ))}
      </div>
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-ink/5 px-3 py-2">
        <Search size={15} className="text-muted" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" aria-label="Search loaded connections"
          className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-muted" />
        {query ? <button aria-label="Clear search" onClick={() => setQuery("")}><X size={15} className="text-muted" /></button> : null}
      </div>
      {profileError || listError ? <div role="alert" className="mb-4 text-sm text-danger">
        <p>{profileError || listError}</p>
        <button disabled={loading || loadingMore} onClick={() => profileError ? setProfileRetry(n => n + 1) : void load(tab, listRetry.current.pageN, listRetry.current.replace)}
          className="mt-2 min-h-10 rounded-full bg-ink/5 px-4 font-semibold text-ink">Try again</button>
      </div> : null}
      {loading ? (
        <p className="py-16 text-center text-sm text-muted">Loading…</p>
      ) : profileError ? null : !target ? (
        <p className="py-16 text-center text-sm text-muted">Profile not found.</p>
      ) : filtered.length === 0 && !listError ? (
        <p className="py-16 text-center text-sm text-muted">{query ? "No matches." : tab === "followers" ? "No followers yet." : "Not following anyone yet."}</p>
      ) : (
        <ul>
          {filtered.map(p => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <Link href={profilePath(p.username, p.id)} className="flex min-w-0 flex-1 items-center gap-3">
                {p.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(p.avatar_url, 200) ?? p.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                ) : (
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink/5 text-[14px] font-bold text-ink">{initials(p.full_name)}</span>
                )}
                <span className="min-w-0">
                  <span className="flex items-center gap-[3px]">
                    <span className="truncate text-[14.5px] font-semibold text-ink">{p.full_name || "Member"}</span>
                    {p.is_verified ? <VerifiedBadge tier={p.verified_tier ?? undefined} size={13} /> : null}
                  </span>
                  {p.username ? <span className="block truncate text-[12.5px] text-muted">@{p.username}</span> : null}
                </span>
              </Link>
              {me && me !== p.id ? <FollowButton authorId={p.id} /> : null}
              {isSelf && tab === "followers" && me !== p.id ? (
                <button disabled={!!removing} aria-busy={removing === p.id} onClick={() => void removeFollower(p)} className="rounded-full p-1.5 text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-50" title="Remove follower" aria-label={"Remove " + (p.full_name || p.username || "member") + " as follower"}><X size={15} /></button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!loading && hasMore ? (
        <button disabled={loadingMore} aria-busy={loadingMore} onClick={() => void load(tab, page + 1, false)} className="mx-auto mt-4 block rounded-full bg-ink/5 px-5 py-2 text-[13px] font-semibold text-ink hover:bg-ink/10 disabled:opacity-50">{loadingMore ? "Loading…" : "Show more"}</button>
      ) : null}
    </section>
  );
}
