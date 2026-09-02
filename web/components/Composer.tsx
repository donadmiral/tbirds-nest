"use client";

import { useEffect, useRef, useState } from "react";
import { checkUploadableBytes } from "@/lib/media";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import { ImagePlus, X, Globe, Users, AtSign, BadgeCheck, Lightbulb, Tag, Image as ImageIcon, FileText, Feather, Video } from "lucide-react";
import { ProductPicker, type ProductCard } from "@/components/ProductPicker";
import { createClient } from "@/lib/supabase/client";
import { STORY_FILTERS, filterCss } from "@/lib/stories";
import type { PostMediaEditRecipe } from "@/components/VideoPlayer";

type Media = { file: File; preview: string; width: number; height: number; isVideo: boolean; alt: string; tags?: MediaTagDraft[]; edit?: PostMediaEditRecipe | null };
type MediaTagDraft = { user_id: string; nx: number; ny: number; full_name: string | null; username: string | null; avatar_url: string | null };
type PostKind = "post" | "media" | "video" | "article" | "listing" | "poll" | "innovation";

// The same row as the phone: Post, Article and Listing are kinds of thing;
// Innovation is a kind with its own tint. Photo, video and poll are tools.
const KINDS: { key: PostKind; label: string; icon: typeof ImagePlus; href?: string }[] = [
  { key: "post", label: "Post", icon: Feather },
  { key: "article", label: "Article", icon: FileText, href: "/write" },
  { key: "listing", label: "Listing", icon: Tag, href: "/market/new" },
  { key: "innovation", label: "Innovation", icon: Lightbulb },
];
const TOOLS: { key: PostKind; label: string; icon: typeof ImagePlus }[] = [
  { key: "media", label: "Photo", icon: ImageIcon },
  { key: "video", label: "Video", icon: Video },
  { key: "poll", label: "Poll", icon: BarChart3 },
];

type MentionHit = { id: string; full_name: string | null; username: string | null; avatar_url: string | null };
export type QuoteTarget = { id: string; author: string; text: string };

const MAX_MEDIA = 10;
const MAX_CHARS = 2000;
const DRAFT_KEY = "pc_draft_web";
const INNO_FIELDS = ["Agritech", "Health", "Energy", "Fintech", "Education", "Other"];
const INNO_STAGES = ["Idea", "Prototype", "Launched"];

const AUDIENCES = [
  { key: "everyone", label: "Everyone", icon: Globe },
  { key: "followers", label: "Followers", icon: Users },
  { key: "mentioned", label: "Mentioned only", icon: AtSign },
  { key: "verified", label: "Verified only", icon: BadgeCheck },
] as const;

export function Composer({ onPosted, quote, onQuoteDone }: { onPosted: () => void; quote?: QuoteTarget | null; onQuoteDone?: () => void }) {
  const supabase = useRef(createClient()).current;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [open, setOpen] = useState(false);
  const [myAvatar, setMyAvatar] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [items, setItems] = useState<Media[]>([]);
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]["key"]>("everyone");
  const [inno, setInno] = useState(false);
  const [innoField, setInnoField] = useState<string | null>(null);
  const [innoStage, setInnoStage] = useState<string | null>(null);
  const [articleTitle, setArticleTitle] = useState("");
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [threadTo, setThreadTo] = useState<string | null>(null);
  const [pollOn, setPollOn] = useState(false);
  // Tag people on a photo: open the tagger for one item, click where the person is, pick them.
  const [tagIdx, setTagIdx] = useState<number | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [tagAt, setTagAt] = useState<{ nx: number; ny: number } | null>(null);
  const [tagQ, setTagQ] = useState("");
  const [tagHits, setTagHits] = useState<any[]>([]);
  useEffect(() => {
    if (tagAt === null) return;
    const q = tagQ.trim().replace(/^@/, "");
    let dead = false;
    const t = window.setTimeout(async () => {
      const sb = createClient();
      const base = sb.from("profiles").select("id, full_name, username, avatar_url").limit(12);
      const { data } = q ? await base.or("username.ilike." + q + "%,full_name.ilike.%" + q + "%") : await base.order("last_seen", { ascending: false });
      if (!dead) setTagHits(data || []);
    }, 160);
    return () => { dead = true; window.clearTimeout(t); };
  }, [tagQ, tagAt]);
  const addTag = (p: any) => {
    if (tagIdx === null || !tagAt) return;
    setItems((prev) => prev.map((it, i) => i !== tagIdx ? it : { ...it, tags: [...(it.tags || []).filter((t) => t.user_id !== p.id), { user_id: p.id, nx: tagAt.nx, ny: tagAt.ny, full_name: p.full_name ?? null, username: p.username ?? null, avatar_url: p.avatar_url ?? null }] }));
    setTagAt(null); setTagQ(""); setTagHits([]);
  };
  const removeTag = (i: number, uid: string) => setItems((prev) => prev.map((it, x) => x !== i ? it : { ...it, tags: (it.tags || []).filter((t) => t.user_id !== uid) }));
  // "kind" is a view over the flags that already existed, not a new source of
  // truth: picking one sets the flags, so every downstream check still works.
  const [kind, setKindState] = useState<PostKind>("post");
  const setKind = (k: PostKind) => {
    setKindState(k);
    setPollOn(k === "poll");
    setInno(k === "innovation");
    if (k === "video") setKind("media");
    // Picking media should do the obvious thing and ask for the files. The
    // timeout lets the dialog mount first, otherwise the click lands on
    // nothing on the first open.
    if (k === "media" && items.length === 0) setTimeout(() => fileRef.current?.click(), 60);
    if (k !== "article") setArticleTitle("");
  };
  const [pollOpts, setPollOpts] = useState<string[]>(["", ""]);
  const [pollDays, setPollDays] = useState(1);
  const [postCategory, setPostCategory] = useState("");
  const [preview, setPreview] = useState<{ url: string; domain?: string; title?: string; description?: string; image_url?: string } | null>(null);
  const previewOff = useRef<string | null>(null);

  useEffect(() => {
    function onThread(e: Event) { setThreadTo((e as CustomEvent).detail?.id ?? null); }
    window.addEventListener("pc-thread-post", onThread);
    return () => window.removeEventListener("pc-thread-post", onThread);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user.id;
      if (!uid) return;
      supabase.from("profiles").select("avatar_url").eq("id", uid).maybeSingle().then(({ data: p }) => setMyAvatar(p?.avatar_url ?? null));
    });
  }, [supabase]);

  useEffect(() => {
    const url = (text.match(/https?:\/\/\S+/) || [])[0] ?? null;
    if (!url) { setPreview(null); return; }
    if (previewOff.current === url || preview?.url === url) return;
    const t = setTimeout(async () => {
      try {
        const { data, error: e } = await supabase.functions.invoke("link-preview", { body: { url } });
        if (!e && data && !data.error) setPreview({ url, ...data });
      } catch { /* no preview, fine */ }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const [mentions, setMentions] = useState<MentionHit[]>([]);
  const [pending, setPending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (quote) { setOpen(true); taRef.current?.focus(); }
  }, [quote]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as { text?: string };
        if (d.text) { setText(d.text); setOpen(true); }
      }
    } catch { /* fresh start */ }
  }, []);
  useEffect(() => {
    try {
      if (text.trim()) localStorage.setItem(DRAFT_KEY, JSON.stringify({ text }));
      else localStorage.removeItem(DRAFT_KEY);
    } catch { /* quota */ }
  }, [text]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { setOpen(false); setError(null); onQuoteDone?.(); } }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onQuoteDone]);

  function onTextChange(v: string) {
    const next = v.slice(0, MAX_CHARS);
    setText(next);
    const match = next.match(/@([\w.]*)$/);
    if (match && match[1].length >= 1) {
      supabase.from("profiles").select("id, full_name, username, avatar_url").ilike("username", match[1] + "%").limit(5)
        .then(({ data }) => setMentions((data ?? []) as MentionHit[]));
    } else {
      setMentions([]);
    }
  }

  function pickMention(u: MentionHit) {
    setText((t) => t.replace(/@([\w.]*)$/, "@" + (u.username ?? "") + " "));
    setMentions([]);
    taRef.current?.focus();
  }

  async function addFiles(list: FileList | File[] | null) {
    if (pollOn) return;
    if (!list) return;
    const next = [...items];
    for (const f of Array.from(list).slice(0, MAX_MEDIA - next.length)) {
      const isVideo = f.type.startsWith("video/");
      if (!f.type.startsWith("image/") && !isVideo) continue;
      let width = 0, height = 0;
      if (!isVideo) {
        try {
          const bmp = await createImageBitmap(f);
          width = bmp.width;
          height = bmp.height;
          bmp.close();
        } catch { /* dims optional */ }
      }
      next.push({ file: f, preview: URL.createObjectURL(f), width, height, isVideo, alt: "" });
    }
    setItems(next);
    setOpen(true);
  }

  function onPaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) { e.preventDefault(); addFiles(files); }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  async function post() {
    const content = text.trim();
    if (pending || (!content && items.length === 0)) return;
    setPending(true);
    setError(null);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) { setError("Sign in to post."); setPending(false); return; }

    const media: { url: string; media_type: string; sort_order: number; width?: number; height?: number }[] = [];
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      const ext = (p.file.name.split(".").pop() || (p.isVideo ? "mp4" : "jpg")).toLowerCase();
      const path = uid + "/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
      const bad = await checkUploadableBytes(p.file);
      if (bad) { setError(bad); setPending(false); return; }
      const { error: upErr } = await supabase.storage.from("post-media").upload(path, p.file, { contentType: p.file.type });
      if (upErr) {
        setError("Upload failed on \u201C" + p.file.name + "\u201D: " + upErr.message + ". Nothing was posted.");
        setPending(false);
        return;
      }
      const { data: pub } = supabase.storage.from("post-media").getPublicUrl(path);
      media.push({ url: pub.publicUrl, media_type: p.isVideo ? "video" : "image", sort_order: i, ...(p.edit && Object.keys(p.edit).length ? { edit: p.edit } : {}), ...(p.width ? { width: p.width } : {}), ...(p.height ? { height: p.height } : {}), ...(p.alt.trim() ? { alt_text: p.alt.trim() } : {}) });
    }

    const insertData: Record<string, unknown> = {
      user_id: uid,
      content: content || null,
      audience,
      is_exclusive: false,
      channel: inno ? "innovation" : null,
    };
    if (inno && innoField) insertData.innovation_field = innoField;
    if (inno && innoStage) insertData.innovation_stage = innoStage;
    // A title makes it an article, whether or not it is also an innovation
    // post. This used to be gated on inno, so an article written without that
    // toggle silently lost its title on save.
    if (articleTitle.trim()) {
      insertData.article_title = articleTitle.trim();
      insertData.read_minutes = Math.max(1, Math.round((content.split(/\s+/).length || 0) / 200));
    }
    if (quote) insertData.quoted_post_id = quote.id;
    if (threadTo) insertData.thread_parent_id = threadTo;
    if (postCategory) insertData.category = postCategory;

    const { data: newPost, error: insErr } = await supabase.from("posts").insert(insertData).select("id").single();
    if (insErr || !newPost) { setError(insErr?.message || "Could not post."); setPending(false); return; }

    if (products.length > 0) {
      const { error: prodErr } = await supabase.rpc("set_post_products", {
        p_post_id: newPost.id,
        p_products: products.map((c, i) => ({ ...c, sort_order: i })),
      });
      if (prodErr) setError("Posted, but the product cards did not save: " + prodErr.message);
    }

    if (pollOn) {
      const labels = pollOpts.map((x) => x.trim()).filter(Boolean);
      if (labels.length >= 2) {
        const ends = new Date(Date.now() + pollDays * 86400000).toISOString();
        const { error: plErr } = await supabase.from("post_polls").insert({ post_id: newPost.id, ends_at: ends });
        if (!plErr) await supabase.from("post_poll_options").insert(labels.map((label, i) => ({ post_id: newPost.id, label, sort_order: i })));
        else setError("Posted, but the poll did not save: " + plErr.message);
      }
    }
    if (media.length > 0) {
      const rows = media.map((m) => ({ post_id: newPost.id, ...m }));
      const { data: inserted, error: mErr } = await supabase.from("post_media").insert(rows).select("id, sort_order");
      if (mErr) setError("Posted, but media did not attach: " + mErr.message);
      else {
        // Tagged people, anchored to the media row each tag was placed on.
        const tagRows: any[] = [];
        items.forEach((it, i) => { const row = (inserted || []).find((r: any) => r.sort_order === i); (it.tags || []).forEach((t) => { if (row) tagRows.push({ post_id: newPost.id, media_id: row.id, user_id: t.user_id, nx: t.nx, ny: t.ny }); }); });
        if (tagRows.length) await supabase.from("post_media_tags").insert(tagRows);
      }
    }

    items.forEach((p) => URL.revokeObjectURL(p.preview));
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* fine */ }
    setText("");
    setItems([]);
    setAudience("everyone");
    setProducts([]);
    setPickerOpen(false);
    setInno(false);
    setInnoField(null);
    setInnoStage(null);
    setArticleTitle("");
    setOpen(false);
    setPending(false);
    setThreadTo(null);
    setPreview(null);
    previewOff.current = null;
    setPollOn(false);
    setPollOpts(["", ""]);
    setPollDays(1);
    setPostCategory("");
    onQuoteDone?.();
    onPosted();
  }

  const remaining = MAX_CHARS - text.length;
  const chip = (on: boolean) => "rounded-full px-2.5 py-1 text-[12px] transition-colors duration-[140ms] " + (on ? "bg-surface-elevated font-semibold text-ink" : "bg-surface text-ink/55 hover:text-ink");

  if (!open) {
    // The collapsed state is a card, not a text field: the prompt line opens
    // the composer, and the row under it opens it already set to a kind of
    // post, so choosing "Poll" is one click rather than two.
    const start = (k?: PostKind) => () => {
      setOpen(true);
      if (k) setKind(k);
    };
    const action = "flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink";
    return (
      <div className="mb-4 rounded-2xl border border-ink/10 bg-white px-5 pb-3 pt-4">
        <button onClick={start()} className="flex w-full items-center gap-3 text-left">
          {myAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={myAvatar} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
          ) : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy text-white"><span className="h-2 w-2 rounded-full bg-pearl" /></span>}
          <span className="text-[16px] text-ink/40">What&apos;s on your mind?</span>
        </button>
        <div className="mt-3 flex items-center gap-1 border-t border-ink/8 pt-2.5">
          <button onClick={start("media")} className={action}><ImageIcon size={16} className="text-pearl-muted" /> Photo</button>
          <button onClick={start("article")} className={action}><FileText size={16} className="text-pearl-muted" /> Article</button>
          <button onClick={start("poll")} className={action}><BarChart3 size={16} className="text-pearl-muted" /> Poll</button>
          <button onClick={start()} className="ml-auto rounded-full bg-pearl px-5 py-1.5 text-[13px] font-bold text-ink transition-opacity duration-[140ms] hover:opacity-90">Post</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-[6vh]" onClick={(e) => { if (e.target === e.currentTarget) { setOpen(false); setError(null); onQuoteDone?.(); } }}>
      <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={"relative flex max-h-[86vh] w-full max-w-[560px] flex-col rounded-2xl border bg-white p-5 shadow-2xl transition-colors duration-[140ms] " + (dragOver ? "border-pearl bg-surface" : "border-ink/10")}
      >
      {/* What am I making? The kinds used to be icon-only toggles in the footer,
          so nothing named them and nothing showed which one was active. Naming
          them here means the answer is visible before you start typing, and
          switching kind is one click rather than hunting a tooltip. */}
      {!quote && !threadTo ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-ink/8 pb-3">
          {KINDS.map((k) => {
            const on = k.key === kind || (k.key === "post" && (kind === "media" || kind === "video" || kind === "poll"));
            const gold = k.key === "innovation";
            const cls = "flex h-[34px] items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-semibold transition-colors duration-[140ms] " +
              (gold
                ? (on ? "border-pearl bg-pearl/55 text-navy" : "border-pearl bg-pearl/30 text-navy hover:bg-pearl/40")
                : (on ? "border-navy bg-navy text-white" : "border-ink/10 bg-surface text-ink/70 hover:text-ink"));
            if (k.href) return <a key={k.key} href={k.href} className={cls}><k.icon size={14} />{k.label}</a>;
            return (
              <button key={k.key} onClick={() => setKind(k.key)} className={cls}>
                <k.icon size={14} />
                {k.label}
              </button>
            );
          })}
          <span className="mx-1 h-5 w-px bg-ink/10" aria-hidden />
          {TOOLS.map((t) => (
            <button key={t.key} onClick={() => setKind(t.key)} title={t.label} aria-label={t.label}
              className={"flex h-9 w-9 items-center justify-center rounded-xl border transition-colors duration-[140ms] " + (kind === t.key ? "border-[#BFDBFE] bg-[#EFF6FF] text-ink" : "border-ink/10 bg-surface text-ink/45 hover:text-ink")}>
              <t.icon size={17} />
            </button>
          ))}
          <Link
            href="/market/new"
            className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-ink/55 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"
          >
            <Tag size={14} /> Sell an item
          </Link>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {quote ? (
        <div className="mb-3 rounded-lg border border-ink/10 p-3">
          <p className="text-[11px] uppercase tracking-wide text-ink/40">Quoting {quote.author}</p>
          <p className="mt-0.5 line-clamp-2 text-[13px] text-ink/70">{quote.text}</p>
        </div>
      ) : null}
      <div className="flex gap-3">
        {myAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={myAvatar} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
        ) : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy text-white"><span className="h-2 w-2 rounded-full bg-pearl" /></span>}
        <div className="min-w-0 flex-1">
          {kind === "article" || inno ? (
            <input value={articleTitle}
              onChange={(e) => setArticleTitle(e.target.value)}
              placeholder={kind === "article" ? "Article title" : "Article title (optional)"}
              className="mb-2 w-full rounded-md bg-surface px-3 py-2 text-[16px] font-semibold text-ink placeholder:text-ink/30 outline-none"
            />
          ) : null}
          <textarea ref={taRef}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onPaste={onPaste}
            placeholder={inno ? "Share your innovation" : "What is happening?"}
            rows={4}
            autoFocus
            className="w-full resize-none bg-transparent text-[18px] leading-relaxed text-ink placeholder:text-ink/30 outline-none"
          />
        </div>
      </div>
      {mentions.length > 0 ? (
        <div className="absolute z-20 w-64 overflow-hidden rounded-lg border border-ink/10 bg-navy shadow-2xl">
          {mentions.map((u) => (
            <button key={u.id} onClick={() => pickMention(u)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-[140ms] hover:bg-surface-elevated">
              {u.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayImageUrl(u.avatar_url, 100) ?? u.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-xs font-semibold text-porcelain">{(u.full_name ?? "?").charAt(0)}</span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-ink">{u.full_name}</span>
                <span className="block truncate text-[12px] text-ink/50">@{u.username}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {dragOver ? <p className="ml-14 text-[12px] text-pearl">Drop photos or videos to attach</p> : null}
      {inno ? (
        <div className="ml-14 mt-2 flex flex-wrap items-center gap-1.5">
          {INNO_FIELDS.map((f) => (
            <button key={f} onClick={() => setInnoField(innoField === f ? null : f)} className={chip(innoField === f)}>{f}</button>
          ))}
          <span className="mx-1 text-ink/20">|</span>
          {INNO_STAGES.map((g) => (
            <button key={g} onClick={() => setInnoStage(innoStage === g ? null : g)} className={chip(innoStage === g)}>{g}</button>
          ))}
        </div>
      ) : null}
      {items.length > 0 ? (
        <div className="ml-14 mt-3 flex flex-wrap gap-2">
          {items.map((p, i) => (
            <span key={i} className="relative">
              {p.isVideo ? (
                <video src={p.preview} muted className="h-20 w-20 rounded-lg object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.preview} alt="" className="h-20 w-20 rounded-lg object-cover" />
              )}
              {p.isVideo ? <span className="absolute bottom-1 left-1 rounded-sm bg-ink/70 px-1 text-[9px] font-bold text-white">VIDEO</span> : (
                <button type="button" onClick={() => setTagIdx(i)} title="Tag people" className="absolute bottom-1 left-1 flex items-center gap-1 rounded-md bg-ink/70 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-ink/85">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#C9BFB0]" />{(p.tags || []).length ? (p.tags || []).length : "Tag"}
                </button>
              )}
              <button type="button" onClick={() => setEditIdx(i)} title="Edit" className={"absolute bottom-1 right-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white " + (p.edit && Object.keys(p.edit).length ? "bg-[#C9BFB0] text-[#0B1E3D]" : "bg-ink/70 hover:bg-ink/85")}>Edit</button>
              <button onClick={() => setItems(items.filter((_, x) => x !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-0.5 text-white transition-opacity duration-[140ms] hover:opacity-80">
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {editIdx !== null && items[editIdx] ? (
        <MediaEditDialog item={items[editIdx]} onClose={() => setEditIdx(null)}
          onSave={(edit) => { setItems((prev) => prev.map((it, x) => x !== editIdx ? it : { ...it, edit })); setEditIdx(null); }} />
      ) : null}
      {tagIdx !== null && items[tagIdx] ? (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4" onClick={() => { setTagIdx(null); setTagAt(null); }}>
          <div className="relative max-h-[92vh] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={items[tagIdx].preview} alt="" className="max-h-[80vh] max-w-[92vw] select-none rounded-xl object-contain" draggable={false}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTagAt({ nx: Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width)), ny: Math.max(0.02, Math.min(0.98, (e.clientY - r.top) / r.height)) }); }} />
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-[12.5px] font-bold text-white">{tagAt ? "Who is this?" : "Click where the person is"}</div>
            {(items[tagIdx].tags || []).map((t) => (
              <span key={t.user_id} className="absolute" style={{ left: "calc(" + t.nx * 100 + "% - 5px)", top: "calc(" + t.ny * 100 + "% - 5px)" }}>
                <span className="block h-2.5 w-2.5 rounded-full border-2 border-white bg-[#C9BFB0]" />
                <span className="absolute left-[-6px] top-3.5 flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#0B1E3D]/90 py-0.5 pl-2 pr-1 text-[12px] font-bold text-white">{t.full_name || t.username}
                  <button type="button" onClick={() => removeTag(tagIdx, t.user_id)} className="rounded-full p-0.5 hover:bg-white/20"><X size={12} /></button>
                </span>
              </span>
            ))}
            {tagAt ? (
              <div className="absolute inset-x-0 bottom-0 max-h-[55%] overflow-auto rounded-b-xl bg-white p-3 shadow-2xl">
                <input autoFocus value={tagQ} onChange={(e) => setTagQ(e.target.value)} placeholder="Search by name or handle" className="w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] outline-none focus:border-ink/40" />
                <div className="mt-1">
                  {tagHits.map((p) => (
                    <button key={p.id} type="button" onClick={() => addTag(p)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-ink/5">
                      {p.avatar_url ? <img src={p.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="h-8 w-8 rounded-full bg-ink/10" />}
                      <span className="min-w-0"><span className="block truncate text-[14px] font-bold text-ink">{p.full_name || p.username}</span>{p.username ? <span className="block text-[12px] text-ink/55">@{p.username}</span> : null}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <button type="button" onClick={() => { setTagIdx(null); setTagAt(null); }} className="absolute -right-2 -top-2 rounded-full bg-white p-1.5 text-ink shadow"><X size={16} /></button>
          </div>
        </div>
      ) : null}
      {items.filter((m) => !m.isVideo).length > 0 ? (
        <div className="ml-14 mt-2 flex flex-col gap-1.5">
          {items.map((m, i) => m.isVideo ? null : (
            <span key={m.preview} className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.preview} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
              <input value={m.alt}
                onChange={(e) => setItems((list) => list.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))}
                placeholder="Describe this image, helps people using screen readers"
                maxLength={500}
                className="min-w-0 flex-1 rounded-md bg-surface px-3 py-1.5 text-[12px] text-ink placeholder:text-ink/25 outline-none transition-colors duration-[140ms] focus:bg-surface-elevated"
              />
            </span>
          ))}
        </div>
      ) : null}
      {pollOn ? (
        <div className="ml-14 mt-3 flex flex-col gap-1.5 rounded-lg border border-ink/10 p-3">
          {pollOpts.map((o, i) => (
            <input key={i} value={o}
              onChange={(e) => setPollOpts((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={"Option " + (i + 1) + (i > 1 ? ", optional" : "")}
              maxLength={60}
              className="w-full rounded-md bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-ink/30 outline-none transition-colors duration-[140ms] focus:bg-surface-elevated"
            />
          ))}
          <span className="flex items-center gap-2 pt-1">
            {pollOpts.length < 4 ? (
              <button onClick={() => setPollOpts((l) => [...l, ""])} className="text-[12px] font-semibold text-pearl-muted hover:underline">Add option</button>
            ) : null}
            <select value={pollDays} onChange={(e) => setPollDays(Number(e.target.value))} className="ml-auto rounded-md bg-surface px-2 py-1 text-[12px] text-ink outline-none">
              <option value={1} className="bg-navy">1 day</option>
              <option value={3} className="bg-navy">3 days</option>
              <option value={7} className="bg-navy">7 days</option>
            </select>
            <button onClick={() => { setPollOn(false); setPollOpts(["", ""]); }} className="text-[12px] text-ink/45 hover:underline">Remove poll</button>
          </span>
        </div>
      ) : null}
      {threadTo ? (
        <p className="ml-14 mt-3 flex items-center gap-2 rounded-md bg-surface px-3 py-2 text-[12px] text-ink/70">
          Adding to your thread
          <button onClick={() => setThreadTo(null)} className="ml-auto text-pearl hover:underline">Cancel</button>
        </p>
      ) : null}
      {preview ? (
        <span className="ml-14 mt-3 flex items-center gap-3 overflow-hidden rounded-lg border border-ink/10 p-2.5">
          {preview.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.image_url} alt="" className="h-12 w-12 shrink-0 rounded-md bg-surface object-cover" />
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-ink/40">{preview.domain ?? ""}</span>
            <span className="line-clamp-2 block text-[13px] font-semibold text-ink">{preview.title ?? preview.url}</span>
          </span>
          <button onClick={() => { previewOff.current = preview.url; setPreview(null); }} title="Remove preview" className="shrink-0 rounded-full p-1 text-ink/40 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><X size={14} /></button>
        </span>
      ) : null}
      {pickerOpen ? <div className="ml-14 mt-3"><ProductPicker selected={products} onChange={setProducts} onClose={() => setPickerOpen(false)} /></div> : null}
      {!pickerOpen && products.length > 0 ? (
        <div className="ml-14 mt-3 flex flex-wrap gap-1.5">
          {products.map((c) => (
            <span key={c.id} className="flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[11px] text-ink/80">
              <Tag size={10} className="text-pearl" /> {c.title}
              <button onClick={() => setProducts(products.filter((x) => x.id !== c.id))} className="text-ink/40 hover:text-ink"><X size={11} /></button>
            </span>
          ))}
        </div>
      ) : null}
      {error ? <p className="ml-14 mt-3 text-[13px] text-danger">{error}</p> : null}
      </div>
      <div className="mt-4 flex shrink-0 flex-wrap items-center gap-1 border-t border-ink/10 pt-4">
        <button onClick={() => fileRef.current?.click()} disabled={items.length >= MAX_MEDIA} title="Add photos or videos" className="rounded-full p-2.5 text-pearl transition-colors duration-[140ms] hover:bg-pearl/10 disabled:opacity-30">
          <ImagePlus size={20} />
        </button>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <button onClick={() => setPickerOpen((v) => !v)} title="Attach products" className={"relative flex items-center rounded-full p-2.5 transition-colors duration-[140ms] " + (products.length > 0 ? "bg-pearl/10 text-pearl" : "text-pearl hover:bg-pearl/10")}>
          <Tag size={18} />
          {products.length > 0 ? <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-pearl px-1 text-[9px] font-bold text-ink">{products.length}</span> : null}
        </button>
        <button onClick={() => { if (items.length === 0) setPollOn((v) => !v); }} disabled={items.length > 0} title="Add a poll" className={"rounded-full p-2.5 transition-colors duration-[140ms] disabled:opacity-30 " + (pollOn ? "bg-pearl/10 text-pearl" : "text-pearl hover:bg-pearl/10")}>
          <BarChart3 size={18} />
        </button>
        <button onClick={() => setInno((v) => !v)} title="Innovation post" className={"flex items-center gap-1 rounded-full px-3 py-2 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (inno ? "bg-pearl/10 text-pearl" : "text-ink/50 hover:bg-surface hover:text-ink")}>
          <Lightbulb size={16} /> Innovation
        </button>
        <div className="ml-auto flex items-center gap-2">
          {items.length > 0 ? <span className="text-[12px] text-ink/40">{items.length}/{MAX_MEDIA}</span> : null}
          {remaining <= 200 ? (
            <span className={"text-[12px] font-semibold " + (remaining <= 20 ? "text-danger" : "text-ink/50")}>{remaining} left</span>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-3">
        <select value={postCategory} onChange={(e) => setPostCategory(e.target.value)} title="Category" className="max-w-[120px] rounded-full bg-surface px-3 py-1.5 text-[12.5px] text-ink/80 outline-none">
          <option value="" className="bg-navy">Category</option>
          {CATEGORIES.filter((c) => c.key !== "innovation").map((c) => (
            <option key={c.key} value={c.key} className="bg-navy">{c.label}</option>
          ))}
        </select>
        <select value={audience}
          onChange={(e) => setAudience(e.target.value as typeof audience)}
          className="rounded-full bg-surface px-3 py-1.5 text-[12.5px] text-ink/80 outline-none"
        >
          {AUDIENCES.map((a) => (
            <option key={a.key} value={a.key} className="bg-navy">{a.label}</option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <button onClick={() => { setOpen(false); setError(null); onQuoteDone?.(); }} className="rounded-full bg-surface px-4 py-2 text-[13.5px] font-semibold text-ink transition-colors duration-[140ms] hover:bg-surface-elevated">Cancel</button>
          <button onClick={post} disabled={pending || (!text.trim() && items.length === 0)} className="rounded-full bg-pearl px-6 py-2 text-[13.5px] font-bold text-ink shadow-sm transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40">
            {pending ? "Posting" : "Post"}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

// The web edit stage: the same non-destructive recipe the phone writes to
// post_media.edit (fit, filter with strength, adjust, video trim and mute), so
// both surfaces render one post the same way.
function MediaEditDialog({ item, onClose, onSave }: { item: Media; onClose: () => void; onSave: (e: PostMediaEditRecipe | null) => void }) {
  const [e, setE] = useState<PostMediaEditRecipe>({ ...(item.edit || {}) });
  const [dur, setDur] = useState(0);
  const adj = e.adjust || {};
  const setAdj = (k: string, v: number) => setE((p) => ({ ...p, adjust: { ...(p.adjust || {}), [k]: v } }));
  const css = filterCss(e.filterId, (e.filterAmt ?? 100) / 100);
  const adjCss = [
    adj.bri ? "brightness(" + (1 + adj.bri / 200) + ")" : "",
    adj.sat ? "saturate(" + (1 + adj.sat / 100) + ")" : "",
    adj.warm ? "sepia(" + Math.max(0, adj.warm) / 300 + ")" : "",
  ].filter(Boolean).join(" ");
  const filterStyle = [css, adjCss].filter(Boolean).join(" ") || undefined;
  const fit = e.fit === "contain" ? "object-contain" : "object-cover";
  const clean = (): PostMediaEditRecipe | null => {
    const out: any = {};
    if (e.fit === "contain") out.fit = "contain";
    if (e.filterId) { out.filterId = e.filterId; if ((e.filterAmt ?? 100) !== 100) out.filterAmt = e.filterAmt; }
    const a: any = {}; Object.entries(adj).forEach(([k, v]) => { if (v) a[k] = v; }); if (Object.keys(a).length) out.adjust = a;
    if (e.muted) out.muted = true;
    if (typeof e.trimStart === "number" && e.trimStart > 0) out.trimStart = e.trimStart;
    if (typeof e.trimEnd === "number" && dur > 0 && e.trimEnd < dur - 0.05) out.trimEnd = e.trimEnd;
    return Object.keys(out).length ? out : null;
  };
  const slider = (label: string, key: string, min = -100, max = 100) => (
    <label className="flex items-center gap-3 text-[12.5px] text-ink/80"><span className="w-20 shrink-0">{label}</span>
      <input type="range" min={min} max={max} value={(adj as any)[key] || 0} onChange={(ev) => setAdj(key, Number(ev.target.value))} className="flex-1 accent-[#0B1E3D]" />
      <span className="w-8 text-right tabular-nums text-ink/50">{(adj as any)[key] || 0}</span></label>
  );
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-[920px] flex-col gap-4 overflow-auto rounded-2xl bg-white p-4 md:flex-row" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex min-h-[260px] flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
          {item.isVideo ? (
            <video src={item.preview} muted={!!e.muted} controls playsInline className={"max-h-[70vh] w-full " + fit} style={{ filter: filterStyle }}
              onLoadedMetadata={(ev) => { const d = ev.currentTarget.duration || 0; setDur(d); if (typeof e.trimEnd !== "number") setE((p) => ({ ...p, trimEnd: Math.round(d * 10) / 10 })); }} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.preview} alt="" className={"max-h-[70vh] w-full " + fit} style={{ filter: filterStyle }} />
          )}
        </div>
        <div className="flex w-full flex-col gap-4 md:w-[320px]">
          <div>
            <p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-ink/45">Filter</p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setE((p) => ({ ...p, filterId: null }))} className={"rounded-full px-3 py-1 text-[12px] font-bold " + (!e.filterId ? "bg-ink text-white" : "bg-ink/5 text-ink hover:bg-ink/10")}>None</button>
              {STORY_FILTERS.map((f) => <button key={f.id} type="button" onClick={() => setE((p) => ({ ...p, filterId: f.id }))} className={"rounded-full px-3 py-1 text-[12px] font-bold " + (e.filterId === f.id ? "bg-ink text-white" : "bg-ink/5 text-ink hover:bg-ink/10")}>{f.label}</button>)}
            </div>
            {e.filterId ? <label className="mt-2 flex items-center gap-3 text-[12.5px] text-ink/80"><span className="w-20 shrink-0">Strength</span><input type="range" min={0} max={100} value={e.filterAmt ?? 100} onChange={(ev) => setE((p) => ({ ...p, filterAmt: Number(ev.target.value) }))} className="flex-1 accent-[#0B1E3D]" /><span className="w-8 text-right tabular-nums text-ink/50">{e.filterAmt ?? 100}</span></label> : null}
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-ink/45">Adjust</p>
            <div className="flex flex-col gap-1.5">{slider("Brightness", "bri")}{slider("Saturation", "sat")}{slider("Warmth", "warm")}{slider("Fade", "fade", 0, 100)}{slider("Vignette", "vig", 0, 100)}</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setE((p) => ({ ...p, fit: (p.fit || "cover") === "cover" ? "contain" : "cover" }))} className="rounded-full bg-ink/5 px-3 py-1 text-[12px] font-bold text-ink hover:bg-ink/10">{e.fit === "contain" ? "Fill" : "Fit"}</button>
            {item.isVideo ? <button type="button" onClick={() => setE((p) => ({ ...p, muted: !p.muted }))} className={"rounded-full px-3 py-1 text-[12px] font-bold " + (e.muted ? "bg-ink text-white" : "bg-ink/5 text-ink hover:bg-ink/10")}>{e.muted ? "Muted" : "Sound on"}</button> : null}
          </div>
          {item.isVideo && dur > 0 ? (
            <div>
              <p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-ink/45">Trim</p>
              <label className="flex items-center gap-3 text-[12.5px] text-ink/80"><span className="w-20 shrink-0">Start</span><input type="range" min={0} max={dur} step={0.1} value={e.trimStart ?? 0} onChange={(ev) => setE((p) => ({ ...p, trimStart: Math.min(Number(ev.target.value), (p.trimEnd ?? dur) - 0.5) }))} className="flex-1 accent-[#0B1E3D]" /><span className="w-10 text-right tabular-nums text-ink/50">{(e.trimStart ?? 0).toFixed(1)}s</span></label>
              <label className="mt-1.5 flex items-center gap-3 text-[12.5px] text-ink/80"><span className="w-20 shrink-0">End</span><input type="range" min={0} max={dur} step={0.1} value={e.trimEnd ?? dur} onChange={(ev) => setE((p) => ({ ...p, trimEnd: Math.max(Number(ev.target.value), (p.trimStart ?? 0) + 0.5) }))} className="flex-1 accent-[#0B1E3D]" /><span className="w-10 text-right tabular-nums text-ink/50">{(e.trimEnd ?? dur).toFixed(1)}s</span></label>
            </div>
          ) : null}
          <div className="mt-auto flex items-center justify-between pt-2">
            <button type="button" onClick={() => setE({})} className="text-[12.5px] font-bold text-ink/60 hover:text-ink">Reset</button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-[13px] font-bold text-ink hover:bg-ink/5">Cancel</button>
              <button type="button" onClick={() => onSave(clean())} className="rounded-full bg-[#0B1E3D] px-4 py-2 text-[13px] font-bold text-white">Done</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
