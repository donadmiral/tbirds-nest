"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X, Globe, Users, AtSign, BadgeCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Media = { file: File; preview: string; width: number; height: number; isVideo: boolean };

const MAX_MEDIA = 10;
const MAX_CHARS = 2000;
const DRAFT_KEY = "pc_draft_web";

const AUDIENCES = [
  { key: "everyone", label: "Everyone", icon: Globe },
  { key: "followers", label: "Followers", icon: Users },
  { key: "mentioned", label: "Mentioned only", icon: AtSign },
  { key: "verified", label: "Verified only", icon: BadgeCheck },
] as const;

export function Composer({ onPosted }: { onPosted: () => void }) {
  const supabase = useRef(createClient()).current;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [items, setItems] = useState<Media[]>([]);
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]["key"]>("everyone");
  const [pending, setPending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft restoration, the phone's pc_draft concept for the browser.
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
      next.push({ file: f, preview: URL.createObjectURL(f), width, height, isVideo });
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
    if (content.length > MAX_CHARS) { setError("Posts are limited to " + MAX_CHARS + " characters."); return; }
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
        // One failed upload never becomes a silently incomplete post.
        setError("Upload failed on \u201C" + p.file.name + "\u201D: " + upErr.message + ". Nothing was posted.");
        setPending(false);
        return;
      }
      const { data: pub } = supabase.storage.from("post-media").getPublicUrl(path);
      media.push({ url: pub.publicUrl, media_type: p.isVideo ? "video" : "image", sort_order: i, ...(p.width ? { width: p.width } : {}), ...(p.height ? { height: p.height } : {}) });
    }

    const { data: newPost, error: insErr } = await supabase
      .from("posts")
      .insert({ user_id: uid, content: content || null, audience, is_exclusive: false, channel: null })
      .select("id")
      .single();
    if (insErr || !newPost) { setError(insErr?.message || "Could not post."); setPending(false); return; }

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
    setOpen(false);
    setPending(false);
    onPosted();
  }

  const remaining = MAX_CHARS - text.length;

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
      className={"mb-3 rounded-lg border p-4 transition-colors " + (dragOver ? "border-pearl bg-surface" : "border-white/10")}
    >
      <textarea value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
        onPaste={onPaste}
        placeholder="What is happening?"
        rows={3}
        autoFocus
        className="w-full resize-none bg-transparent text-[15px] text-white placeholder:text-white/30 outline-none"
      />
      {dragOver ? <p className="text-[12px] text-pearl">Drop photos or videos to attach</p> : null}
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
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
      <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
        <button onClick={() => fileRef.current?.click()} disabled={items.length >= MAX_MEDIA} title="Add photos or videos" className="rounded-md p-2 text-white/60 transition-colors hover:bg-surface hover:text-pearl disabled:opacity-30">
          <ImagePlus size={19} />
        </button>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
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
          <button onClick={() => { setOpen(false); setError(null); }} className="rounded-md bg-surface px-4 py-2 text-[13px] text-white">Cancel</button>
          <button onClick={post} disabled={pending || (!text.trim() && items.length === 0)} className="rounded-md bg-pearl px-5 py-2 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-40">
            {pending ? "Posting" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}