"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ImagePlus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ArticleBody } from "@/components/ArticleBody";

export default function WriteArticlePage() {
  const supabase = useRef(createClient()).current;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [preview, setPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const DRAFT_KEY = "pc:article-draft";
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
  // Wraps the current selection, or inserts at the caret, then restores focus.
  function wrap(before: string, after: string) {
    const el = bodyRef.current;
    if (!el) { setBody((b) => b + before + after); return; }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? start;
    const chosen = body.slice(start, end);
    const lineStart = before.startsWith("#") || before.startsWith(">");
    const insertion = (lineStart && start > 0 && body[start - 1] !== "\n" ? "\n" : "") + before + chosen + after;
    const next = body.slice(0, start) + insertion + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + insertion.length - after.length;
      el.setSelectionRange(chosen ? pos : start + insertion.length - after.length, chosen ? pos : start + insertion.length - after.length);
    });
  }

  async function insertImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = uid + "/article-" + Date.now() + "." + ext;
    const { error: upErr } = await supabase.storage.from("post-media").upload(path, file, { contentType: file.type });
    if (upErr) { setError("That image did not upload: " + upErr.message); return; }
    const { data } = supabase.storage.from("post-media").getPublicUrl(path);
    wrap("\n![](" + data.publicUrl + ")\n", "");
    e.target.value = "";
  }

  // The draft outlives the tab: closing it by accident no longer loses the piece.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) { const d = JSON.parse(raw) as { title?: string; body?: string }; if (d.title) setTitle(d.title); if (d.body) setBody(d.body); }
    } catch { /* no draft */ }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      if (title || body) window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, body }));
    }, 500);
    return () => clearTimeout(t);
  }, [title, body]);

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

    window.localStorage.removeItem(DRAFT_KEY);
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

      {/* Formatting inserts the same markup X uses under the hood: headings,
          bold, italic, quotes, links and images. Plain paragraphs need none. */}
      <div className="sticky top-[72px] z-10 mb-2 flex flex-wrap items-center gap-1 rounded-xl border border-ink/10 bg-white/95 px-2 py-1.5 backdrop-blur">
        {([
          ["H", "Heading", "# ", ""], ["h", "Subheading", "## ", ""], ["B", "Bold", "**", "**"], ["I", "Italic", "_", "_"],
          ["\u201C", "Quote", "> ", ""], ["\u2014", "Divider", "\n---\n", ""], ["\u{1F517}", "Link", "[", "](https://)"],
        ] as [string, string, string, string][]).map(([glyph, title, before, after]) => (
          <button key={title} type="button" title={title} onClick={() => wrap(before, after)}
            className="min-w-[32px] rounded-lg px-2 py-1 text-[13px] font-semibold text-ink/70 transition-colors hover:bg-surface hover:text-ink">{glyph}</button>
        ))}
        <label title="Insert an image" className="min-w-[32px] cursor-pointer rounded-lg px-2 py-1 text-ink/70 transition-colors hover:bg-surface hover:text-ink">
          <ImagePlus size={15} />
          <input type="file" accept="image/*" onChange={insertImage} className="hidden" />
        </label>
        <span className="ml-auto text-[11.5px] text-ink/40">{body.trim() ? body.trim().split(/\s+/).length : 0} words</span>
        <button type="button" onClick={() => setPreview((v) => !v)}
          className={"rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors " + (preview ? "bg-ink text-white" : "bg-surface text-ink/70 hover:text-ink")}>
          {preview ? "Edit" : "Preview"}
        </button>
      </div>

      {preview ? (
        <div className="min-h-[420px] rounded-xl border border-ink/10 bg-white px-5 py-4">
          {body.trim() ? <ArticleBody text={body} /> : <p className="text-[14px] text-ink/40">Nothing to preview yet.</p>}
        </div>
      ) : (
        <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} placeholder="Write the piece. Paragraphs are preserved exactly as you write them. Use the toolbar for headings, emphasis, quotes, links and images."
          className="min-h-[420px] w-full resize-none border-0 text-[16px] leading-relaxed text-ink outline-none placeholder:text-ink/30" />
      )}

      {error ? <p className="mt-2 text-[13px] text-red-500">{error}</p> : null}
    </div>
  );
}
