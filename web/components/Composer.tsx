"use client";

import { useRef, useState } from "react";
import { ImagePlus, X, Globe, Users, BadgeCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Photo = { file: File; preview: string; width: number; height: number };

const AUDIENCES = [
  { key: "everyone", label: "Everyone", icon: Globe },
  { key: "followers", label: "Followers", icon: Users },
  { key: "verified", label: "Verified", icon: BadgeCheck },
] as const;

export function Composer({ onPosted }: { onPosted: () => void }) {
  const supabase = useRef(createClient()).current;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]["key"]>("everyone");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...photos];
    for (const f of Array.from(list).slice(0, 4 - next.length)) {
      if (!f.type.startsWith("image/")) continue;
      let width = 0, height = 0;
      try {
        const bmp = await createImageBitmap(f);
        width = bmp.width;
        height = bmp.height;
        bmp.close();
      } catch { /* dims optional */ }
      next.push({ file: f, preview: URL.createObjectURL(f), width, height });
    }
    setPhotos(next);
  }

  async function post() {
    const content = text.trim();
    if (pending || (!content && photos.length === 0)) return;
    setPending(true);
    setError(null);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) { setError("Sign in to post."); setPending(false); return; }

    const media: { url: string; media_type: string; sort_order: number; width?: number; height?: number }[] = [];
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      const ext = (p.file.name.split(".").pop() || "jpg").toLowerCase();
      const path = uid + "/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
      const { error: upErr } = await supabase.storage.from("post-media").upload(path, p.file, { contentType: p.file.type });
      if (upErr) { setError("Photo upload failed: " + upErr.message); setPending(false); return; }
      const { data: pub } = supabase.storage.from("post-media").getPublicUrl(path);
      media.push({ url: pub.publicUrl, media_type: "image", sort_order: i, ...(p.width ? { width: p.width } : {}), ...(p.height ? { height: p.height } : {}) });
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
      if (mErr) { setError("Posted, but photos did not attach: " + mErr.message); }
    }

    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setText("");
    setPhotos([]);
    setAudience("everyone");
    setOpen(false);
    setPending(false);
    onPosted();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-2 flex w-full items-center gap-3 rounded-lg border border-white/10 px-4 py-3 text-left transition-colors hover:bg-surface">
        <span className="h-2 w-2 rounded-full bg-pearl" aria-hidden />
        <span className="text-[15px] text-white/40">Share something with your circles</span>
      </button>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-white/10 p-4">
      <textarea value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What is happening?"
        rows={3}
        autoFocus
        className="w-full resize-none bg-transparent text-[15px] text-white placeholder:text-white/30 outline-none"
      />
      {photos.length > 0 ? (
        <div className="mt-2 flex gap-2">
          {photos.map((p, i) => (
            <span key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="" className="h-20 w-20 rounded-md object-cover" />
              <button onClick={() => setPhotos(photos.filter((_, x) => x !== i))} className="absolute -right-1.5 -top-1.5 rounded-full bg-ink p-0.5 text-white/70 hover:text-white">
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
      <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
        <button onClick={() => fileRef.current?.click()} disabled={photos.length >= 4} title="Add photos" className="rounded-md p-2 text-white/60 transition-colors hover:bg-surface hover:text-pearl disabled:opacity-30">
          <ImagePlus size={19} />
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <select value={audience}
          onChange={(e) => setAudience(e.target.value as typeof audience)}
          className="rounded-md bg-surface px-2 py-1.5 text-[13px] text-white/80 outline-none"
        >
          {AUDIENCES.map((a) => (
            <option key={a.key} value={a.key} className="bg-navy">{a.label}</option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <button onClick={() => { setOpen(false); setError(null); }} className="rounded-md bg-surface px-4 py-2 text-[13px] text-white">Cancel</button>
          <button onClick={post} disabled={pending || (!text.trim() && photos.length === 0)} className="rounded-md bg-pearl px-5 py-2 text-[13px] font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-40">
            {pending ? "Posting" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}