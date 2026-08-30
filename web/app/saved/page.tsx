"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
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
  const supabase = useRef(createClient()).current;
  const [posts, setPosts] = useState<SavedPost[] | null>(null);
  const [cols, setCols] = useState<Collection[]>([]);
  const [colSel, setColSel] = useState<string>("all");
  const [uid, setUid] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) { setPosts([]); return; }
      // Identity and collections come first. They used to be set after an
      // early return for "no bookmarks", so an empty page lost its collections
      // row entirely and New folder had no user id to write against.
      setUid(uid);
      const { data: colRows } = await supabase.from("bookmark_collections").select("id, name").order("created_at");
      setCols((colRows ?? []) as Collection[]);

      const { data: bookmarks } = await supabase
        .from("post_bookmarks")
        .select("post_id, created_at, collection_id")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(100);
      if (!bookmarks || bookmarks.length === 0) { setPosts([]); return; }
      const postIds = bookmarks.map((b) => b.post_id);
      const savedAt: Record<string, string> = {};
      const colOf: Record<string, string | null> = {};
      bookmarks.forEach((b) => { savedAt[b.post_id] = b.created_at; colOf[b.post_id] = (b as { collection_id?: string | null }).collection_id ?? null; });

      const { data: postsData } = await supabase
        .from("posts")
        .select("id, user_id, content, body, media_url, likes_count, comments_count, created_at, post_media(id, url, media_type, width, height, sort_order)")
        .in("id", postIds);
      if (!postsData || postsData.length === 0) { setPosts([]); return; }

      const authorIds = Array.from(new Set(postsData.map((p) => p.user_id)));
      const { data: authors } = await supabase
        .from("profiles")
        .select("id, full_name, username, avatar_url")
        .in("id", authorIds);
      const authorMap = new Map((authors ?? []).map((a) => [a.id, a]));

      const rows = (postsData as SavedPost[])
        .map((p) => ({ ...p, author: authorMap.get(p.user_id) ?? null, saved_at: savedAt[p.id], collection_id: colOf[p.id] }))
        .sort((a, b) => new Date(b.saved_at ?? 0).getTime() - new Date(a.saved_at ?? 0).getTime());
      setPosts(rows);
      } catch {
        // Distinguishes "nothing saved" from "could not reach the server",
        // which previously rendered the same empty hub.
        setFailed(true);
        setPosts([]);
      }
    })();
  }, [supabase, tick]);

  async function newFolder() {
    const name = window.prompt("Folder name");
    if (!name || !name.trim() || !uid) return;
    const { error } = await supabase.from("bookmark_collections").insert({ user_id: uid, name: name.trim() });
    if (error) alert(error.message.includes("duplicate") ? "That folder already exists." : error.message);
    setTick((v) => v + 1);
  }
  async function fileInto(postId: string, collectionId: string | null) {
    if (!uid) return;
    await supabase.from("post_bookmarks").update({ collection_id: collectionId }).eq("user_id", uid).eq("post_id", postId);
    setTick((v) => v + 1);
  }
  async function unsave(postId: string) {
    if (!uid) return;
    await supabase.from("post_bookmarks").delete().eq("user_id", uid).eq("post_id", postId);
    setTick((v) => v + 1);
  }

  return (
    <div>
      <Card className="mb-4 flex items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-pearl/15 text-pearl">
          <Bookmark size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] text-ink/45">Your saved hub</span>
          <span className="block font-display text-[24px] leading-tight text-porcelain">
            {posts === null ? "\u2014" : posts.length + (posts.length === 1 ? " item saved" : " items saved")}
          </span>
        </span>
        <button onClick={newFolder} className="shrink-0 rounded-full border border-ink/15 px-4 py-2 text-[12.5px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:bg-surface hover:text-ink">
          New collection
        </button>
      </Card>
      <div className="mb-4 flex gap-1.5 overflow-x-auto">
        <button onClick={() => setColSel("all")} className={"shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors duration-[140ms] " + (colSel === "all" ? "bg-pearl text-ink" : "bg-surface text-ink/60 hover:bg-surface-elevated")}>All</button>
        {cols.map((c) => (
          <button key={c.id} onClick={() => setColSel(c.id)} className={"shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors duration-[140ms] " + (colSel === c.id ? "bg-pearl text-ink" : "bg-surface text-ink/60 hover:bg-surface-elevated")}>{c.name}</button>
        ))}
      </div>
      {failed ? (
        <ErrorState title="Could not load your saved items" onRetry={() => { setFailed(false); setTick(t => t + 1); }} />
      ) : posts === null ? (
        <p className="py-16 text-center text-sm text-ink/40">Loading</p>
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<Bookmark size={19} />}
          title="Nothing saved yet"
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
          return (
            <Link key={p.id} href={"/post/" + p.id} className="mb-3 flex gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3.5 transition-colors duration-[140ms] hover:border-ink/20">
              <StoryAvatar userId={p.user_id}
                name={p.author?.full_name}
                avatarUrl={p.author?.avatar_url}
                size={44}
                href={p.author?.username ? "/" + p.author.username : null}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[14px]">
                  <span className="truncate font-semibold text-ink">{p.author?.full_name ?? "Member"}</span>
                  <span className="truncate text-ink/50">@{p.author?.username}</span>
                  <span className="text-ink/30">·</span>
                  <span className="shrink-0 text-ink/50">{timeAgo(p.created_at)}</span>
                </span>
                {text ? <span className="mt-0.5 line-clamp-3 block whitespace-pre-wrap text-[14px] text-ink/85">{text}</span> : null}
                <span className="mt-1 block text-[12px] text-ink/40">
                  {(p.likes_count ?? 0) + " likes · " + (p.comments_count ?? 0) + " comments"}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                <select value={p.collection_id ?? ""} onChange={(e) => fileInto(p.id, e.target.value || null)} title="File into folder" className="max-w-[110px] rounded-md bg-surface px-1.5 py-1 text-[11px] text-ink/70 outline-none">
                  <option value="" className="bg-navy">No folder</option>
                  {cols.map((c) => <option key={c.id} value={c.id} className="bg-navy">{c.name}</option>)}
                </select>
                <button onClick={() => unsave(p.id)} className="text-[11px] text-ink/40 transition-colors duration-[140ms] hover:text-danger">Unsave</button>
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
    </div>
  );
}