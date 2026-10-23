"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { StoryAvatar } from "@/components/StoryAvatar";
import { timeAgo } from "@/lib/feed";
import { Bookmark } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { ErrorState } from "@/components/ErrorState";

type SavedPost = {
  id: string;
  user_id: string;
  content: string | null;
  body: string | null;
  media_url: string | null;
  likes_count: number | null;
  comments_count: number | null;
  created_at: string;
  post_media: { id: string; url: string; media_type: string; sort_order: number }[] | null;
  author?: { full_name: string | null; username: string | null; avatar_url: string | null } | null;
  saved_at?: string;
  collection_id?: string | null;
};

type Collection = { id: string; name: string };

export default function SavedPage() {
  const [supabase] = useState(createClient);
  const [posts, setPosts] = useState<SavedPost[] | null>(null);
  const [cols, setCols] = useState<Collection[]>([]);
  const [colSel, setColSel] = useState<string>("all");
  const [uid, setUid] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<{ created_at: string; post_id: string } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const generation = useRef(0);
  const loadingRef = useRef(false);

  const load = useCallback(async (after: { created_at: string; post_id: string } | null = null) => {
    if (after && loadingRef.current) return;
    const version = ++generation.current;
    loadingRef.current = true;
    setFailed(false);
    setLoadingMore(!!after);
    if (!after) { setPosts(null); setCursor(null); setHasMore(false); }
    try {
      const { data: sess, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const viewer = sess.session?.user.id;
      if (version !== generation.current) return;
      setUid(viewer ?? null);
      if (!viewer) { setPosts([]); setCols([]); setTotal(0); return; }
      let query = supabase.from("post_bookmarks").select("post_id, created_at, collection_id").eq("user_id", viewer)
        .order("created_at", { ascending: false }).order("post_id", { ascending: false }).limit(40);
      if (colSel !== "all") query = query.eq("collection_id", colSel);
      if (after) query = query.or(`created_at.lt.${after.created_at},and(created_at.eq.${after.created_at},post_id.lt.${after.post_id})`);
      const [collectionResult, bookmarkResult, countResult] = await Promise.all([
        supabase.from("bookmark_collections").select("id, name").eq("user_id", viewer).order("created_at"),
        query,
        supabase.from("post_bookmarks").select("post_id", { count: "exact", head: true }).eq("user_id", viewer),
      ]);
      if (collectionResult.error || bookmarkResult.error || countResult.error) throw collectionResult.error || bookmarkResult.error || countResult.error;
      const bookmarks = bookmarkResult.data ?? [];
      let rows: SavedPost[] = [];
      if (bookmarks.length) {
        const { data: postsData, error: postsError } = await supabase.from("posts")
          .select("id, user_id, content, body, media_url, likes_count, comments_count, created_at, post_media(id, url, media_type, width, height, sort_order)")
          .in("id", bookmarks.map((b) => b.post_id));
        if (postsError) throw postsError;
        const authorIds = Array.from(new Set((postsData ?? []).map((p) => p.user_id)));
        const authorMap = new Map<string, NonNullable<SavedPost["author"]>>();
        if (authorIds.length) {
          const { data: authors, error: authorsError } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", authorIds);
          if (authorsError) throw authorsError;
          for (const author of authors ?? []) authorMap.set(author.id, author);
        }
        const byId = new Map((postsData as SavedPost[] ?? []).map((p) => [p.id, p]));
        rows = bookmarks.flatMap((bookmark) => {
          const post = byId.get(bookmark.post_id);
          return post ? [{ ...post, author: authorMap.get(post.user_id) ?? null, saved_at: bookmark.created_at, collection_id: bookmark.collection_id }] : [];
        });
      }
      if (version !== generation.current) return;
      setCols(collectionResult.data ?? []);
      setTotal(countResult.count);
      setPosts((previous) => after ? [...(previous ?? []), ...rows.filter((row) => !(previous ?? []).some((p) => p.id === row.id))] : rows);
      setCursor(bookmarks.length ? bookmarks[bookmarks.length - 1] : null);
      setHasMore(bookmarks.length === 40);
    } catch {
      if (version === generation.current) setFailed(true);
    } finally {
      if (version === generation.current) { setLoadingMore(false); loadingRef.current = false; }
    }
  }, [supabase, colSel]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Cleanup deliberately invalidates the latest request counter.
    return () => { clearTimeout(timer); generation.current++; loadingRef.current = false; };
  }, [load, tick]);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN") {
        generation.current++;
        setUid(null); setPosts(null); setCols([]); setTotal(null); setColSel("all"); setActionError(null);
        setTick((value) => value + 1);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  async function newFolder() {
    const name = window.prompt("Folder name");
    if (!name?.trim() || !uid || busyRef.current.has("collection")) return;
    busyRef.current.add("collection");
    const version = generation.current;
    setActionError(null);
    try {
      const { error } = await supabase.from("bookmark_collections").insert({ user_id: uid, name: name.trim() });
      if (error) throw error;
      if (version === generation.current) setTick((value) => value + 1);
    } catch { if (version === generation.current) setActionError("Could not create this collection. Check the name and try again."); }
    finally { busyRef.current.delete("collection"); }
  }

  async function changeBookmark(postId: string, collectionId?: string | null) {
    if (!uid || busyRef.current.has(postId)) return;
    const version = generation.current;
    busyRef.current.add(postId); setBusy(new Set(busyRef.current)); setActionError(null);
    try {
      const query = collectionId === undefined ? supabase.from("post_bookmarks").delete() : supabase.from("post_bookmarks").update({ collection_id: collectionId });
      const { data, error } = await query.eq("user_id", uid).eq("post_id", postId).select("post_id").maybeSingle();
      if (error || (collectionId !== undefined && !data)) throw error || new Error("Saved item is no longer available");
      if (version !== generation.current) return;
      setPosts((previous) => (previous ?? []).flatMap((post) => post.id !== postId ? [post] : collectionId === undefined || (colSel !== "all" && collectionId !== colSel) ? [] : [{ ...post, collection_id: collectionId }]));
      if (collectionId === undefined) setTotal((value) => value === null ? null : Math.max(0, value - 1));
    } catch { if (version === generation.current) setActionError("Could not update this saved item. Please try again."); }
    finally { busyRef.current.delete(postId); setBusy(new Set(busyRef.current)); }
  }

  return (
    <div>
      <Card className="mb-4 flex items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-pearl/15 text-accent">
          <Bookmark size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] text-muted">Your saved hub</span>
          <span className="block font-display text-[24px] leading-tight text-porcelain">
            {total === null ? "\u2014" : total + (total === 1 ? " item saved" : " items saved")}
          </span>
        </span>
        <button onClick={newFolder} className="shrink-0 rounded-full border border-ink/15 px-4 py-2 text-[12.5px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:bg-surface hover:text-ink">
          New collection
        </button>
      </Card>
      <div className="mb-4 flex gap-1.5 overflow-x-auto">
        <button onClick={() => setColSel("all")} className={"shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors duration-[140ms] " + (colSel === "all" ? "bg-pearl text-on-pearl" : "bg-surface text-ink/60 hover:bg-surface-elevated")}>All</button>
        {cols.map((c) => (
          <button key={c.id} onClick={() => setColSel(c.id)} className={"shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors duration-[140ms] " + (colSel === c.id ? "bg-pearl text-on-pearl" : "bg-surface text-ink/60 hover:bg-surface-elevated")}>{c.name}</button>
        ))}
      </div>
      {actionError ? <p role="alert" className="mb-3 text-sm text-danger">{actionError}</p> : null}
      {failed ? (
        <ErrorState title="Could not load your saved items" onRetry={() => { setFailed(false); setTick(t => t + 1); }} />
      ) : posts === null ? (
        <p className="py-16 text-center text-sm text-muted">Loading</p>
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<Bookmark size={19} />}
          title={colSel === "all" ? "Nothing saved yet" : "This collection is empty"}
          line="Tap the bookmark on any post and it collects here. Collections let you keep them apart."
          action="Find something to read"
          actionHref="/discover"
        />
      ) : (
        (() => {
          const inView = posts.filter((p) => colSel === "all" || p.collection_id === colSel);
          if (inView.length === 0) {
            return (
              <EmptyState
                title="This collection is empty"
                line="File a saved item into it from the folder menu on any card below."
                action="See everything saved"
                actionHref="/saved"
              />
            );
          }
          return inView.map((p) => {
          const text = p.content ?? p.body ?? "";
          const media = (p.post_media ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
          const first = media[0]?.url ?? p.media_url;
          // eslint-disable-next-line react-hooks/refs -- These callbacks read request guards only when a user acts, never during render.
          const onCollectionChange = (event: React.ChangeEvent<HTMLSelectElement>) => { void changeBookmark(p.id, event.target.value || null); };
          const onUnsave = () => { void changeBookmark(p.id); };
          return (
            <Link key={p.id} href={"/post/" + p.id} className="mb-3 flex gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3.5 transition-colors duration-[140ms] hover:border-ink/20">
              <StoryAvatar userId={p.user_id}
                name={p.author?.full_name}
                avatarUrl={p.author?.avatar_url}
                size={44}
                href={null}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[14px]">
                  <span className="truncate font-semibold text-ink">{p.author?.full_name ?? "Member"} <VerifiedBadge userId={p.user_id} size={13} /></span>
                  <span className="truncate text-muted">@{p.author?.username}</span>
                  <span className="text-muted">·</span>
                  <span className="shrink-0 text-muted">{timeAgo(p.created_at)}</span>
                </span>
                {text ? <span className="mt-0.5 line-clamp-3 block whitespace-pre-wrap text-[14px] text-ink/85">{text}</span> : null}
                <span className="mt-1 block text-[12px] text-muted">
                  {(p.likes_count ?? 0) + " likes · " + (p.comments_count ?? 0) + " comments"}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                <select value={p.collection_id ?? ""} disabled={busy.has(p.id)} onChange={onCollectionChange} title="File into folder" className="max-w-[110px] rounded-md bg-surface px-1.5 py-1 text-[11px] text-ink/70 outline-none">
                  <option value="" className="bg-navy">No folder</option>
                  {cols.map((c) => <option key={c.id} value={c.id} className="bg-navy">{c.name}</option>)}
                </select>
                <button disabled={busy.has(p.id)} onClick={onUnsave} className="text-[11px] text-muted transition-colors duration-[140ms] hover:text-danger">Unsave</button>
              </span>
              {first ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={first} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" />
              ) : null}
            </Link>
          );
          });
        })()
      )}
      {hasMore && !failed ? <button disabled={loadingMore} onClick={() => void load(cursor)} className="mx-auto my-4 block rounded-full border border-ink/15 px-4 py-2 text-sm text-ink/70">{loadingMore ? "Loading" : "Load more"}</button> : null}
    </div>
  );
}