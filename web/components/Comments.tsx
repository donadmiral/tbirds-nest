"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ThumbsUp, ThumbsDown, Reply } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StoryAvatar } from "@/components/StoryAvatar";
import { RichText } from "@/components/RichText";
import { timeAgo } from "@/lib/feed";

type CommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  parent_comment_id: string | null;
  likes_count: number;
  dislikes_count: number;
  created_at: string;
  author?: { full_name: string | null; username: string | null; avatar_url: string | null } | null;
  replies: CommentRow[];
};

export function Comments({ postId }: { postId: string }) {
  const supabase = useRef(createClient()).current;
  const [uid, setUid] = useState<string | null>(null);
  const [items, setItems] = useState<CommentRow[]>([]);
  const [reactions, setReactions] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user.id ?? null;
    setUid(userId);
    const { data: rows } = await supabase
      .from("post_comments")
      .select("id, post_id, user_id, body, content, parent_comment_id, likes_count, dislikes_count, created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    const all = ((rows ?? []) as (CommentRow & { content: string | null })[]).map((r) => ({ ...r, body: r.body || r.content || "", replies: [] as CommentRow[] }));
    const ids = Array.from(new Set(all.map((c) => c.user_id)));
    if (ids.length > 0) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", ids);
      const map = new Map((profs ?? []).map((p) => [p.id, p]));
      all.forEach((c) => { c.author = map.get(c.user_id) ?? null; });
    }
    const byId = new Map(all.map((c) => [c.id, c]));
    const top: CommentRow[] = [];
    all.forEach((c) => {
      if (c.parent_comment_id && byId.has(c.parent_comment_id)) byId.get(c.parent_comment_id)!.replies.push(c);
      else top.push(c);
    });
    setItems(top);
    if (userId && all.length > 0) {
      const { data: cr } = await supabase.from("comment_reactions").select("comment_id, value").eq("user_id", userId).in("comment_id", all.map((c) => c.id));
      const r: Record<string, number> = {};
      (cr ?? []).forEach((row) => { r[row.comment_id] = row.value; });
      setReactions(r);
    }
    setLoaded(true);
  }, [supabase, postId]);

  useEffect(() => { load(); }, [load]);

  async function react(commentId: string, value: 1 | -1) {
    if (!uid) return;
    const prev = reactions[commentId] ?? 0;
    const next = prev === value ? 0 : value;
    setReactions((r) => ({ ...r, [commentId]: next }));
    const { data, error } = await supabase.rpc("set_comment_reaction", { p_comment_id: commentId, p_value: value });
    if (error) { setReactions((r) => ({ ...r, [commentId]: prev })); return; }
    const counts = data as { likes?: number; dislikes?: number } | null;
    if (counts) {
      const patch = (c: CommentRow): CommentRow => c.id === commentId
        ? { ...c, likes_count: counts.likes ?? c.likes_count, dislikes_count: counts.dislikes ?? c.dislikes_count }
        : c;
      setItems((l) => l.map((c) => ({ ...patch(c), replies: c.replies.map(patch) })));
    }
  }

  async function submit() {
    const body = draft.trim();
    if (!body || busy || !uid) return;
    setBusy(true);
    const { error } = await supabase.from("post_comments").insert({
      post_id: postId, user_id: uid, body, content: body,
      parent_comment_id: replyTo?.id ?? null, media_url: null, media_type: null,
    });
    setBusy(false);
    if (error) { alert("Could not comment: " + error.message); return; }
    setDraft("");
    setReplyTo(null);
    load();
  }

  function Row({ c, depth }: { c: CommentRow; depth: number }) {
    const mine = reactions[c.id] ?? 0;
    const vb = "flex items-center gap-1 text-[12px] transition-colors";
    return (
      <div className={depth > 0 ? "ml-10 mt-3" : "mt-4"}>
        <div className="flex gap-2.5">
          <StoryAvatar userId={c.user_id} name={c.author?.full_name} avatarUrl={c.author?.avatar_url} size={depth > 0 ? 30 : 36} href={c.author?.username ? "/" + c.author.username : null} />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-1.5 text-[13px]">
              <Link href={c.author?.username ? "/" + c.author.username : "#"} className="font-semibold text-white hover:underline">{c.author?.full_name ?? "Member"}</Link>
              <span className="text-white/40">{timeAgo(c.created_at)}</span>
            </p>
            <p className="whitespace-pre-wrap text-[14px] text-white/90"><RichText text={c.body} /></p>
            <div className="mt-1 flex items-center gap-4">
              <button onClick={() => react(c.id, 1)} className={vb + " " + (mine === 1 ? "text-success" : "text-white/45 hover:text-success")}>
                <ThumbsUp size={13} fill={mine === 1 ? "currentColor" : "none"} /> {c.likes_count > 0 ? c.likes_count : ""}
              </button>
              <button onClick={() => react(c.id, -1)} className={vb + " " + (mine === -1 ? "text-danger" : "text-white/45 hover:text-danger")}>
                <ThumbsDown size={13} fill={mine === -1 ? "currentColor" : "none"} /> {c.dislikes_count > 0 ? c.dislikes_count : ""}
              </button>
              {depth === 0 ? (
                <button onClick={() => setReplyTo(c)} className={vb + " text-white/45 hover:text-white"}>
                  <Reply size={13} /> Reply
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {c.replies.map((r) => <Row key={r.id} c={r} depth={depth + 1} />)}
      </div>
    );
  }

  return (
    <section className="mt-6 border-t border-white/10 pt-4">
      <h2 className="text-[15px] font-semibold text-white">{items.length > 0 ? "Comments" : "No comments yet"}</h2>
      {!loaded ? <p className="py-6 text-center text-sm text-white/40">Loading</p> : items.map((c) => <Row key={c.id} c={c} depth={0} />)}
      <div className="mt-5">
        {replyTo ? (
          <p className="mb-1 flex items-center gap-2 text-[12px] text-white/50">
            Replying to <span className="font-semibold text-white/80">{replyTo.author?.full_name}</span>
            <button onClick={() => setReplyTo(null)} className="text-pearl hover:underline">Cancel</button>
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={replyTo ? "Write a reply" : "Add a comment"}
            rows={1}
            className="max-h-32 flex-1 resize-none rounded-md bg-surface px-4 py-2.5 text-[14px] text-white placeholder:text-white/30 outline-none focus:bg-surface-elevated"
          />
          <button onClick={submit} disabled={busy || !draft.trim()} className="rounded-md bg-pearl px-4 py-2.5 text-[13px] font-semibold text-ink disabled:opacity-30">
            {busy ? "Sending" : "Send"}
          </button>
        </div>
      </div>
    </section>
  );
}