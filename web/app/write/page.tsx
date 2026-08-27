"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ImagePlus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function WriteArticlePage() {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useState(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase.from("profiles").select("full_name").eq("id", auth.user.id).single();
      setName(data?.full_name ?? null);
    })();
  });

  const minutes = useMemo(() => {
    const words = body.trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  }, [body]);

  const pickCover = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setCover(f);
    setCoverPreview(URL.createObjectURL(f));
  };
  const clearCover = () => { if (coverPreview) URL.revokeObjectURL(coverPreview); setCover(null); setCoverPreview(null); if (fileRef.current) fileRef.current.value = ""; };

  const publish = async () => {
    if (busy) return;
    if (!title.trim() || body.trim().length < 100) {
      setError("An article needs a title and at least a real opening — write a little more.");
      return;
    }
    setError(null);
    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) { setError("Sign in to publish."); setBusy(false); return; }

    let imageUrl: string | null = null;
    if (cover) {
      const ext = (cover.name.split(".").pop() || "jpg").toLowerCase();
      const path = uid + "/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
      const { error: upErr } = await supabase.storage.from("post-media").upload(path, cover, { contentType: cover.type });
      if (!upErr) {
        const { data: pub } = supabase.storage.from("post-media").getPublicUrl(path);
        imageUrl = pub.publicUrl;
      }
    }

    const { data: newPost, error: insErr } = await supabase.from("posts").insert({
      user_id: uid,
      body: body.trim(),
      article_title: title.trim(),
      read_minutes: minutes,
      image_url: imageUrl,
    }).select("id").single();

    setBusy(false);
    if (insErr || !newPost) { setError(insErr?.message || "Could not publish."); return; }
    router.push("/post/" + newPost.id);
  };

  return (
    <div className="mx-auto max-w-[680px] px-1 pb-20">
      <div className="flex items-center justify-between pb-4">
        <Link href="/settings" className="inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Settings</Link>
        <button onClick={publish} disabled={busy} className="rounded-full bg-ink px-4 py-1.5 text-[13.5px] font-bold text-white disabled:opacity-40">{busy ? "Publishing" : "Publish"}</button>
      </div>

      <textarea value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" rows={1}
        onInput={e => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }}
        className="w-full resize-none overflow-hidden border-0 font-display text-[26px] font-bold leading-tight text-ink outline-none placeholder:text-ink/30" />

      {coverPreview ? (
        <div className="relative mb-3 mt-2 overflow-hidden rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverPreview} alt="" className="h-[220px] w-full object-cover" />
          <button onClick={clearCover} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"><X size={14} /></button>
        </div>
      ) : (
        <label className="mb-3 mt-2 flex min-h-[54px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-ink/15 text-[13px] font-semibold text-ink/45 hover:border-ink/30">
          <ImagePlus size={15} /> Add a cover image (optional)
          <input ref={fileRef} type="file" accept="image/*" onChange={pickCover} className="hidden" />
        </label>
      )}

      <p className="mb-3 text-[12px] font-semibold text-ink/45">{minutes} min read · publishing as {name || "you"}</p>

      <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Write the piece. Paragraphs are preserved exactly as you write them."
        className="min-h-[420px] w-full resize-none border-0 text-[16px] leading-relaxed text-ink outline-none placeholder:text-ink/30" />

      {error ? <p className="mt-2 text-[13px] text-red-500">{error}</p> : null}
    </div>
  );
}
