"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X, Globe, Users, AtSign, BadgeCheck, Lightbulb, Tag } from "lucide-react";
import { ProductPicker, type ProductCard } from "@/components/ProductPicker";
import { createClient } from "@/lib/supabase/client";

type Media = { file: File; preview: string; width: number; height: number; isVideo: boolean; alt: string };
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
  const [preview, setPreview] = useState<{ url: string; domain?: string; title?: string; description?: string; image_url?: string } | null>(null);
  const previewOff = useRef<string | null>(null);

  useEffect(() => {
    function onThread(e: Event) { setThreadTo((e as CustomEvent).detail?.id ?? null); }
    window.addEventListener("pc-thread-post", onThread);
    return () => window.removeEventListener("pc-thread-post", onThread);
  }, []);

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
      const { error: upErr } = await supabase.storage.from("post-media").upload(path, p.file, { contentType: p.file.type });
      if (upErr) {
        setError("Upload failed on \u201C" + p.file.name + "\u201D: " + upErr.message + ". Nothing was posted.");
        setPending(false);
        return;
      }
      const { data: pub } = supabase.storage.from("post-media").getPublicUrl(path);
      media.push({ url: pub.publicUrl, media_type: p.isVideo ? "video" : "image", sort_order: i, ...(p.width ? { width: p.width } : {}), ...(p.height ? { height: p.height } : {}), ...(p.alt.trim() ? { alt_text: p.alt.trim() } : {}) });
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
    if (inno && articleTitle.trim()) {
      insertData.article_title = articleTitle.trim();
      insertData.read_minutes = Math.max(1, Math.round((content.split(/\s+/).length || 0) / 200));
    }
    if (quote) insertData.quoted_post_id = quote.id;
    if (threadTo) insertData.thread_parent_id = threadTo;

    const { data: newPost, error: insErr } = await supabase.from("posts").insert(insertData).select("id").single();
    if (insErr || !newPost) { setError(insErr?.message || "Could not post."); setPending(false); return; }

    if (products.length > 0) {
      const { error: prodErr } = await supabase.rpc("set_post_products", {
        p_post_id: newPost.id,
        p_products: products.map((c, i) => ({ ...c, sort_order: i })),
      });
      if (prodErr) setError("Posted, but the product cards did not save: " + prodErr.message);
    }

    if (media.length > 0) {
      const rows = media.map((m) => ({ post_id: newPost.id, ...m }));
      const { error: mErr } = await supabase.from("post_media").insert(rows);
      if (mErr) setError("Posted, but media did not attach: " + mErr.message);
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
    onQuoteDone?.();
    onPosted();
  }

  const remaining = MAX_CHARS - text.length;
  const chip = (on: boolean) => "rounded-full px-2.5 py-1 text-[12px] transition-colors " + (on ? "bg-surface-elevated font-semibold text-white" : "bg-surface text-white/55 hover:text-white");

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-2 flex w-full items-center gap-3 rounded-lg border border-white/10 px-4 py-3 text-left transition-colors hover:bg-surface">
        <span className="h-2 w-2 rounded-full bg-pearl" aria-hidden />
        <span className="text-[15px] text-white/40">Share something with your circles</span>
      </button>
    );
  }

  return (
    <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={"relative mb-3 flex max-h-[82vh] flex-col rounded-lg border p-4 transition-colors " + (dragOver ? "border-pearl bg-surface" : "border-white/10")}
    >
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {quote ? (
        <div className="mb-2 rounded-lg border border-white/10 p-2.5">
          <p className="text-[11px] uppercase tracking-wide text-white/40">Quoting {quote.author}</p>
          <p className="mt-0.5 line-clamp-2 text-[13px] text-white/70">{quote.text}</p>
        </div>
      ) : null}
      {inno ? (
        <input value={articleTitle}
          onChange={(e) => setArticleTitle(e.target.value)}
          placeholder="Article title (optional)"
          className="mb-2 w-full rounded-md bg-surface px-3 py-2 text-[15px] font-semibold text-white placeholder:text-white/30 outline-none"
        />
      ) : null}
      <textarea ref={taRef}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onPaste={onPaste}
        placeholder={inno ? "Share your innovation" : "What is happening?"}
        rows={3}
        autoFocus
        className="w-full resize-none bg-transparent text-[15px] text-white placeholder:text-white/30 outline-none"
      />
      {mentions.length > 0 ? (
        <div className="absolute z-20 w-64 overflow-hidden rounded-lg border border-white/10 bg-navy shadow-2xl">
          {mentions.map((u) => (
            <button key={u.id} onClick={() => pickMention(u)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-elevated">
              {u.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-xs font-semibold text-porcelain">{(u.full_name ?? "?").charAt(0)}</span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-white">{u.full_name}</span>
                <span className="block truncate text-[12px] text-white/50">@{u.username}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {dragOver ? <p className="text-[12px] text-pearl">Drop photos or videos to attach</p> : null}
      {inno ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {INNO_FIELDS.map((f) => (
            <button key={f} onClick={() => setInnoField(innoField === f ? null : f)} className={chip(innoField === f)}>{f}</button>
          ))}
          <span className="mx-1 text-white/20">|</span>
          {INNO_STAGES.map((g) => (
            <button key={g} onClick={() => setInnoStage(innoStage === g ? null : g)} className={chip(innoStage === g)}>{g}</button>
          ))}
        </div>
      ) : null}
      {items.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map((p, i) => (
            <span key={i} className="relative">
              {p.isVideo ? (
                <video src={p.preview} muted className="h-20 w-20 rounded-md object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.preview} alt="" className="h-20 w-20 rounded-md object-cover" />
              )}
              {p.isVideo ? <span className="absolute bottom-1 left-1 rounded-sm bg-ink/70 px-1 text-[9px] font-bold text-white">VIDEO</span> : null}
              <button onClick={() => setItems(items.filter((_, x) => x !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-0.5 text-white/70 hover:text-white">
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {items.filter((m) => !m.isVideo).length > 0 ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {items.map((m, i) => m.isVideo ? null : (
            <span key={m.preview} className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.preview} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
              <input value={m.alt}
                onChange={(e) => setItems((list) => list.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))}
                placeholder="Describe this image, helps people using screen readers"
                maxLength={500}
                className="min-w-0 flex-1 rounded-md bg-surface px-3 py-1.5 text-[12px] text-white placeholder:text-white/25 outline-none focus:bg-surface-elevated"
              />
            </span>
          ))}
        </div>
      ) : null}
      {threadTo ? (
        <p className="mt-2 flex items-center gap-2 rounded-md bg-surface px-3 py-2 text-[12px] text-white/70">
          Adding to your thread
          <button onClick={() => setThreadTo(null)} className="ml-auto text-pearl hover:underline">Cancel</button>
        </p>
      ) : null}
      {preview ? (
        <span className="mt-2 flex items-center gap-3 overflow-hidden rounded-lg border border-white/10 p-2.5">
          {preview.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.image_url} alt="" className="h-12 w-12 shrink-0 rounded-md bg-surface object-cover" />
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-white/40">{preview.domain ?? ""}</span>
            <span className="line-clamp-2 block text-[13px] font-semibold text-white">{preview.title ?? preview.url}</span>
          </span>
          <button onClick={() => { previewOff.current = preview.url; setPreview(null); }} title="Remove preview" className="shrink-0 rounded-full p-1 text-white/40 hover:bg-surface hover:text-white"><X size={14} /></button>
        </span>
      ) : null}
      {pickerOpen ? <ProductPicker selected={products} onChange={setProducts} onClose={() => setPickerOpen(false)} /> : null}
      {!pickerOpen && products.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {products.map((c) => (
            <span key={c.id} className="flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[11px] text-white/80">
              <Tag size={10} className="text-pearl" /> {c.title}
              <button onClick={() => setProducts(products.filter((x) => x.id !== c.id))} className="text-white/40 hover:text-white"><X size={11} /></button>
            </span>
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
      </div>
      <div className="mt-3 flex shrink-0 items-center gap-2 border-t border-white/10 pt-3">
        <button onClick={() => fileRef.current?.click()} disabled={items.length >= MAX_MEDIA} title="Add photos or videos" className="rounded-md p-2 text-white/60 transition-colors hover:bg-surface hover:text-pearl disabled:opacity-30">
          <ImagePlus size={19} />
        </button>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <button onClick={() => setPickerOpen((v) => !v)} title="Attach products" className={"relative flex items-center rounded-md p-2 transition-colors " + (products.length > 0 ? "text-pearl" : "text-white/50 hover:bg-surface hover:text-pearl")}>
          <Tag size={17} />
          {products.length > 0 ? <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-pearl px-1 text-[9px] font-bold text-ink">{products.length}</span> : null}
        </button>
        <button onClick={() => setInno((v) => !v)} title="Innovation post" className={"flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] transition-colors " + (inno ? "bg-surface-elevated font-semibold text-pearl" : "text-white/50 hover:bg-surface hover:text-white")}>
          <Lightbulb size={15} /> Innovation
        </button>
        <select value={audience}
          onChange={(e) => setAudience(e.target.value as typeof audience)}
          className="rounded-md bg-surface px-2 py-1.5 text-[13px] text-white/80 outline-none"
        >
          {AUDIENCES.map((a) => (
            <option key={a.key} value={a.key} className="bg-navy">{a.label}</option>
          ))}
        </select>
        {items.length > 0 ? <span className="text-[12px] text-white/40">{items.length}/{MAX_MEDIA}</span> : null}
        {remaining <= 200 ? (
          <span className={"text-[12px] font-semibold " + (remaining <= 20 ? "text-danger" : "text-white/50")}>{remaining} left</span>
        ) : null}
        <div className="ml-auto flex gap-2">
          <button onClick={() => { setOpen(false); setError(null); onQuoteDone?.(); }} className="rounded-md bg-surface px-4 py-2 text-[13px] text-white">Cancel</button>
          <button onClick={post} disabled={pending || (!text.trim() && items.length === 0)} className="rounded-md bg-pearl px-5 py-2 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-40">
            {pending ? "Posting" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}