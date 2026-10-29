"use client";

import { profilePath } from "@/lib/profileLookup";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ThumbsUp, ThumbsDown, Reply, Trash2, Copy, MoreHorizontal, ChevronDown, ChevronUp, EyeOff, ShieldAlert, UserMinus, Pin, Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PersonName } from "@/components/PersonName";
import { StoryAvatar } from "@/components/StoryAvatar";
import { RichText } from "@/components/RichText";
import { RelativeTime } from "@/components/RelativeTime";
import { refreshCommentCount } from "@/lib/commentCounts";
import { loadCommentHighlights, pinnedFirst } from '../../shared/commentHighlights';

type CommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  parent_comment_id: string | null;
  likes_count: number;
  dislikes_count: number;
  created_at: string;
  hidden?: boolean;
  spam?: boolean;
  spam_reason?: string | null;
  author?: { full_name: string | null; username: string | null; avatar_url: string | null } | null;
  replies: CommentRow[];
};

export function Comments({ postId, autoFocus }: { postId: string; autoFocus?: boolean }) {
  const [off, setOff] = useState(false);
  const [collabInvite, setCollabInvite] = useState(false);
  const supabase = useRef(createClient()).current;
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [items, setItems] = useState<CommentRow[]>([]);
  const [reactions, setReactions] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [authorLikes, setAuthorLikes] = useState<Set<string>>(new Set());
  const loadRevision = useRef(0);
  const pendingActions = useRef(new Set<string>());
  const activeScope = useRef({ key: '', generation: 0 });
  const scopeKey = `${postId}:${uid ?? ''}`;
  if (activeScope.current.key !== scopeKey) activeScope.current = { key: scopeKey, generation: activeScope.current.generation + 1 };
  // Native alerts and retained callbacks must belong to the render that opened them.
  const actionScope = activeScope.current;
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [postAuthor, setPostAuthor] = useState<string | null>(null);
  const [showSpam, setShowSpam] = useState(false);

  const load = useCallback(async () => {
    const revision = ++loadRevision.current;
    const current = () => revision === loadRevision.current;
    try {
    const { data: sess } = await supabase.auth.getSession();
    if (!current()) return;
    const userId = sess.session?.user.id ?? null;
    setUid(userId);
    if (userId) { const { data: ci } = await supabase.from("post_collaborators").select("status").eq("post_id", postId).eq("user_id", userId).maybeSingle(); if (!current()) return; setCollabInvite((ci as { status?: string } | null)?.status === "invited"); }
    else setCollabInvite(false);
    const { data: pol, error: policyError } = await supabase.from("posts").select("comment_policy, user_id").eq("id", postId).maybeSingle();
    if (!current()) return;
    if (policyError) throw policyError;
    const authorId = (pol as { user_id?: string } | null)?.user_id ?? null;
    setPostAuthor(authorId);
    if ((pol as { comment_policy?: string } | null)?.comment_policy === "off") { setOff(true); setItems([]); setLoadError(null); return; }
    setOff(false);
    const { data: rows, error: commentsError } = await supabase
      .from("post_comments")
      .select("id, post_id, user_id, body, content, parent_comment_id, likes_count, dislikes_count, created_at, hidden_at, is_spam, spam_reason")
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    if (!current()) return;
    if (commentsError) throw commentsError;
    const all = ((rows ?? []) as (CommentRow & { content: string | null; hidden_at?: string | null; is_spam?: boolean })[]).filter((r) => !r.hidden_at || r.user_id === userId || authorId === userId).map((r) => ({ ...r, body: r.body || r.content || "", hidden: !!r.hidden_at, spam: !!r.is_spam && r.user_id !== userId, replies: [] as CommentRow[] }));
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
    if (!current()) return;
    setItems(top); setLoadError(null);
    void loadCommentHighlights(supabase, postId, authorId, all.map(c => c.id)).then(value => {
      if (current()) { setPinnedId(value.pinnedId); setAuthorLikes(value.likedByAuthor); }
    }).catch(() => {});
    if (userId && all.length > 0) {
      const { data: cr } = await supabase.from("comment_reactions").select("comment_id, value").eq("user_id", userId).in("comment_id", all.map((c) => c.id));
      const r: Record<string, number> = {};
      (cr ?? []).forEach((row) => { r[row.comment_id] = row.value; });
      if (current()) setReactions(r);
    }
    } catch { if (current()) setLoadError('Comments could not load. Please try again.'); }
    finally { if (current()) setLoaded(true); }
  }, [supabase, postId]);

  useEffect(() => {
    pendingActions.current.clear(); setBusy(false); setMenuFor(null);
    setCollabInvite(false); setPostAuthor(null); setOff(false); setExpanded(new Set()); setShowSpam(false);
    setLoaded(false); setItems([]); setLoadError(null); setPinnedId(null); setAuthorLikes(new Set()); setReactions({}); setReplyTo(null); setDraft('');
    void load();
    return () => { ++loadRevision.current; activeScope.current = { ...activeScope.current, generation: activeScope.current.generation + 1 }; };
  }, [load]);
  useEffect(() => { if (autoFocus) { const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 80); return () => clearTimeout(t); } }, [autoFocus]);

  async function react(commentId: string, value: 1 | -1) {
    if (actionScope !== activeScope.current || !uid || pendingActions.current.has(commentId)) return;
    pendingActions.current.add(commentId);
    const scope = activeScope.current;
    const prev = reactions[commentId] ?? 0;
    setReactions((r) => ({ ...r, [commentId]: prev === value ? 0 : value }));
    try {
    const { data, error } = await supabase.rpc("set_comment_reaction", { p_comment_id: commentId, p_value: value });
    if (scope !== activeScope.current) return;
    if (error) throw error;
    const counts = data as { likes?: number; dislikes?: number; value?: number } | null;
    const confirmed = counts?.value ?? (prev === value ? 0 : value);
    setReactions(r => ({ ...r, [commentId]: confirmed }));
    if (uid === postAuthor) setAuthorLikes(previous => { const next = new Set(previous); if (confirmed === 1) next.add(commentId); else next.delete(commentId); return next; });
    if (counts) {
      const patch = (c: CommentRow): CommentRow => {
        const me = c.id === commentId
          ? { ...c, likes_count: counts.likes ?? c.likes_count, dislikes_count: counts.dislikes ?? c.dislikes_count }
          : c;
        return { ...me, replies: me.replies.map(patch) };
      };
      setItems((l) => l.map(patch));
    }
    } catch { if (scope === activeScope.current) { setReactions(r => ({ ...r, [commentId]: prev })); setLoadError('Your reaction could not be saved. Please try again.'); } }
    finally { if (scope === activeScope.current) pendingActions.current.delete(commentId); }
  }

  async function pinComment(c: CommentRow) {
    if (actionScope !== activeScope.current || !uid || uid !== postAuthor || pendingActions.current.has('pin')) return;
    pendingActions.current.add('pin');
    const scope = activeScope.current;
    try {
      const { data, error } = await supabase.rpc('set_comment_pinned', { p_comment_id: c.id, p_pinned: pinnedId !== c.id });
      if (error) throw error;
      if (scope === activeScope.current) { setPinnedId((data as { pinned_comment_id?: string | null } | null)?.pinned_comment_id ?? null); setMenuFor(null); }
    } catch { if (scope === activeScope.current) setLoadError('The pin could not be saved. Please try again.'); }
    finally { if (scope === activeScope.current) pendingActions.current.delete('pin'); }
  }

  async function moderate(c: CommentRow, kind: 'hidden' | 'spam') {
    const action = `moderate:${c.id}`;
    if (actionScope !== activeScope.current || !uid || uid !== postAuthor || pendingActions.current.has(action)) return;
    pendingActions.current.add(action);
    const scope = activeScope.current;
    try {
      const { error } = kind === 'hidden'
        ? await supabase.rpc('set_comment_hidden', { p_comment_id: c.id, p_hidden: !c.hidden })
        : await supabase.rpc('set_comment_spam', { p_comment_id: c.id, p_spam: !c.spam });
      if (error) throw error;
      if (scope === activeScope.current) { setMenuFor(null); await load(); }
    } catch { if (scope === activeScope.current) setLoadError('The moderation change could not be saved. Please try again.'); }
    finally { if (scope === activeScope.current) pendingActions.current.delete(action); }
  }

  async function remove(c: CommentRow) {
    if (actionScope !== activeScope.current || !uid || c.user_id !== uid || pendingActions.current.has(`delete:${c.id}`)) return;
    if (!window.confirm("Delete this comment?")) return;
    pendingActions.current.add(`delete:${c.id}`);
    const scope = activeScope.current;
    setMenuFor(null);
    try {
      const { error, status } = await supabase.from("post_comments").delete().eq("id", c.id);
      if (error && (status === 0 || status >= 500)) throw error;
      if (error && scope === activeScope.current) alert("Could not delete: " + error.message);
    } catch {
      if (scope === activeScope.current) alert("Could not confirm whether the comment was deleted. Check the thread before trying again.");
    } finally {
      void refreshCommentCount(supabase, postId);
      if (scope === activeScope.current) {
        pendingActions.current.delete(`delete:${c.id}`);
        void load();
      }
    }
  }

  async function copyText(c: CommentRow) {
    if (actionScope !== activeScope.current) return;
    const scope = activeScope.current;
    try {
      await navigator.clipboard.writeText(c.body);
      if (scope === activeScope.current) setMenuFor(null);
    } catch { if (scope === activeScope.current) setLoadError('Text could not be copied. Please try again.'); }
  }

  function startReply(c: CommentRow) {
    if (actionScope !== activeScope.current) return;
    setReplyTo(c);
    setTimeout(() => { if (actionScope === activeScope.current) inputRef.current?.focus(); }, 50);
  }

  async function submit() {
    const body = draft.trim();
    if (actionScope !== activeScope.current || !body || busy || !uid || off || pendingActions.current.has('submit')) return;
    pendingActions.current.add('submit');
    const scope = activeScope.current;
    setBusy(true);
    try {
      const { error, status } = await supabase.from("post_comments").insert({
        post_id: postId, user_id: uid, body, content: body,
        parent_comment_id: replyTo?.id ?? null, media_url: null, media_type: null,
      });
      if (scope !== activeScope.current) return;
      if (error && (status === 0 || status >= 500)) throw error;
      if (error) { alert("Could not comment: " + error.message); return; }
      if (replyTo) setExpanded((s) => new Set(s).add(replyTo.parent_comment_id ?? replyTo.id));
      setDraft(current => current === draft ? "" : current);
      setReplyTo(current => current?.id === replyTo?.id ? null : current);
    } catch {
      if (scope === activeScope.current) alert("Could not confirm whether your comment was sent. Check the thread before trying again.");
    } finally {
      void refreshCommentCount(supabase, postId);
      if (scope === activeScope.current) {
        setBusy(false);
        pendingActions.current.delete('submit');
        void load();
      }
    }
  }

  function countAll(c: CommentRow): number {
    return c.replies.reduce((n, r) => n + 1 + countAll(r), 0);
  }

  async function respondToInvite(status: 'accepted' | 'declined') {
    if (actionScope !== activeScope.current || !uid || pendingActions.current.has('invite')) return;
    pendingActions.current.add('invite');
    const scope = activeScope.current;
    try {
      const { data, error } = await supabase.from('post_collaborators').update({ status }).eq('post_id', postId).eq('user_id', uid).select('status').maybeSingle();
      if (error || !data || data.status !== status) throw error || new Error('Invitation not updated');
      if (scope === activeScope.current) setCollabInvite(false);
    } catch { if (scope === activeScope.current) setLoadError('The collaboration response could not be saved. Please try again.'); }
    finally { if (scope === activeScope.current) pendingActions.current.delete('invite'); }
  }

  function renderRow(c: CommentRow, depth: number): React.ReactNode {
    const mine = reactions[c.id] ?? 0;
    const vb = "flex min-h-11 min-w-11 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] transition-colors duration-[140ms]";
    const total = countAll(c);
    const open = expanded.has(c.id);
    return (
      <div key={c.id} className={depth > 0 ? "mt-3 " + (depth === 1 ? "ml-10" : "ml-6") : "mt-4"}>
        <div className="group flex gap-2.5">
          <StoryAvatar userId={c.user_id} name={c.author?.full_name} avatarUrl={c.author?.avatar_url} size={depth > 0 ? 30 : 36} href={c.author?.username ? "/" + c.author.username : null} />
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-1.5 text-[13px]">
              <Link href={profilePath(c.author?.username, c.user_id)} className="font-semibold text-ink hover:underline"><PersonName name={c.author?.full_name ?? "Member"} userId={c.user_id} badgeSize={13} /></Link>
              {c.hidden ? <span className="rounded-md bg-ink/5 px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">Hidden</span> : null}
              {c.spam ? <span className="rounded-md bg-ink/5 px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">May be spam</span> : null}
              <span className="text-muted"><RelativeTime dateTime={c.created_at} /></span>
            </p>
            {pinnedId === c.id ? <p className="mb-1 flex items-center gap-1 text-[11px] text-secondary"><Pin size={11} /> Pinned by author</p> : null}
            <p className="whitespace-pre-wrap text-[14px] text-ink/90"><RichText text={c.body} /></p>
            {authorLikes.has(c.id) ? <p className="mt-1 flex items-center gap-1 text-[11px] text-secondary"><Heart size={11} className="text-danger" fill="currentColor" /> Liked by author</p> : null}
            <div className="-ml-2.5 mt-1 flex flex-wrap items-center gap-0.5">
              <button aria-label="Like comment" aria-pressed={mine === 1} onClick={() => react(c.id, 1)} className={vb + " " + (mine === 1 ? "text-success" : "text-muted hover:bg-success/10 hover:text-success")}>
                <ThumbsUp size={13} fill={mine === 1 ? "currentColor" : "none"} /> {c.likes_count > 0 ? c.likes_count : ""}
              </button>
              <button aria-label="Dislike comment" aria-pressed={mine === -1} onClick={() => react(c.id, -1)} className={vb + " " + (mine === -1 ? "text-danger" : "text-muted hover:bg-danger/10 hover:text-danger")}>
                <ThumbsDown size={13} fill={mine === -1 ? "currentColor" : "none"} /> {c.dislikes_count > 0 ? c.dislikes_count : ""}
              </button>
              <button onClick={() => startReply(c)} className={vb + " text-muted hover:bg-ink/[0.06] hover:text-ink"}>
                <Reply size={13} /> Reply
              </button>
              <span className="relative">
                <button aria-label="Comment actions" aria-expanded={menuFor === c.id} onClick={() => setMenuFor(menuFor === c.id ? null : c.id)} className="min-h-11 min-w-11 rounded-full p-2 text-muted transition-colors duration-[140ms] hover:bg-surface hover:text-ink" title="More">
                  <MoreHorizontal size={14} />
                </button>
                {menuFor === c.id ? (
                  <span className="absolute left-0 top-9 z-20 w-44 overflow-hidden rounded-lg border border-ink/10 bg-white text-ink shadow-2xl">
                    {uid === postAuthor && depth === 0 && !c.parent_comment_id && !c.hidden && !c.spam ? <button onClick={() => pinComment(c)} className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-ink hover:bg-surface"><Pin size={13} />{pinnedId === c.id ? 'Unpin comment' : 'Pin comment'}</button> : null}
                    <button onClick={() => copyText(c)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-ink/90 transition-colors duration-[140ms] hover:bg-surface-elevated"><Copy size={13} /> Copy text</button>
                    {postAuthor && uid === postAuthor && uid !== c.user_id ? (
                      <>
                        <button onClick={() => moderate(c, 'hidden')} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-ink/90 transition-colors duration-[140ms] hover:bg-surface-elevated"><EyeOff size={13} /> {c.hidden ? "Unhide" : "Hide"}</button>
                        <button onClick={() => moderate(c, 'spam')} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-ink/90 transition-colors duration-[140ms] hover:bg-surface-elevated"><ShieldAlert size={13} /> {c.spam ? "Not spam" : "Mark as spam"}</button>
                        <button onClick={() => { const who = c.author?.full_name || "this person"; if (!confirm("Restrict " + who + "? Their comments on your posts will only be visible to them until you approve them, their messages move to Message requests, and you will not get notifications from them. They will not know.")) return; void supabase.rpc("set_restriction", { p_user: c.user_id, p_on: true }).then(({ error }) => { setMenuFor(null); if (error) alert(error.message); else alert(who + " is restricted. Undo it in Settings, under Restricted accounts."); }); }} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-ink/90 transition-colors duration-[140ms] hover:bg-surface-elevated"><UserMinus size={13} /> Restrict</button>
                      </>
                    ) : null}
                    {uid === c.user_id ? (
                      <button onClick={() => remove(c)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-danger transition-colors duration-[140ms] hover:bg-surface-elevated"><Trash2 size={13} /> Delete</button>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </div>
            {depth === 0 && total > 0 ? (
              <button onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                className="mt-1.5 flex items-center gap-1 text-[12px] font-semibold text-accent hover:underline"
              >
                {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {open ? "Hide replies" : "View " + total + (total === 1 ? " reply" : " replies")}
              </button>
            ) : null}
          </div>
        </div>
        {(depth > 0 || open) ? c.replies.map(r => renderRow(r, depth + 1)) : null}
      </div>
    );
  }

  return (
    <section className="mt-6 border-t border-ink/10 pt-4">
      <h2 className="text-[15px] font-semibold text-ink">{off ? 'Comments are turned off' : !loaded || loadError || items.length > 0 ? "Comments" : "No comments yet"}</h2>
      {collabInvite ? <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-ink/10 bg-surface px-3 py-2 text-[13px] text-ink"><span className="flex-1 font-semibold">You are invited to collaborate on this post</span><button type="button" onClick={() => respondToInvite('accepted')} className="min-h-11 rounded-full bg-ink px-3 py-1 font-bold text-white">Accept</button><button type="button" onClick={() => respondToInvite('declined')} className="min-h-11 px-3 font-semibold text-secondary">Decline</button></div> : null}
      {loadError ? <p role="status" className="mt-3 text-[13px] text-danger">{loadError} <button type="button" onClick={() => load()} className="min-h-11 px-2 font-semibold underline">Try again</button></p> : null}
      {!loaded ? <p className="py-6 text-center text-sm text-muted">Loading comments</p> : pinnedFirst(items.filter(c => !c.spam), pinnedId).map(c => renderRow(c, 0))}
      {loaded && items.some((c) => c.spam) ? (
        <div className="mt-4">
          <button onClick={() => setShowSpam((v) => !v)} className="flex items-center gap-1 text-[12.5px] font-semibold text-muted hover:text-ink">
            {showSpam ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {items.filter((c) => c.spam).length} {items.filter((c) => c.spam).length === 1 ? "comment" : "comments"} may be spam
          </button>
          {showSpam ? items.filter(c => c.spam).map(c => renderRow(c, 0)) : null}
        </div>
      ) : null}
      {!off && uid ? <div className="mt-5">
        {replyTo ? (
          <p className="mb-1 flex items-center gap-2 text-[12px] text-muted">
            Replying to <span className="font-semibold text-ink/80">{replyTo.author?.full_name}</span>
            <button onClick={() => setReplyTo(null)} className="text-accent hover:underline">Cancel</button>
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={replyTo ? "Write a reply" : "Add a comment"}
            rows={1}
            className="max-h-32 flex-1 resize-none rounded-full bg-surface px-4 py-2.5 text-[14px] text-ink placeholder:text-muted outline-none transition-colors duration-[140ms] focus:bg-surface-elevated"
          />
          <button onClick={submit} disabled={busy || !draft.trim()} className="rounded-full bg-pearl px-5 py-2.5 text-[13px] font-bold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-30">
            {busy ? "Sending" : "Send"}
          </button>
        </div>
      </div> : null}
    </section>
  );
}
