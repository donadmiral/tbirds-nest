"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { checkUploadableBytes } from "@/lib/media";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ImagePlus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ArticleBody } from "@/components/ArticleBody";
import { CATEGORIES } from "@/lib/categories";
import { PublicationAttempt, publicationError } from "@/lib/publication";

export default function WriteArticlePage() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("https://");
  const linkRangeRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const DRAFT_KEY = "pc:article-draft";
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const preparingImage = useRef(false);
  const [imageBusy, setImageBusy] = useState(false);
  const publishedRef = useRef(false);
  const [publicationStatus, setPublicationStatus] = useState<{ postId: string | null; uncertain: boolean; locked: boolean; published: boolean }>({ postId: null, uncertain: false, locked: false, published: false });
  const publication = useRef<{ progress: PublicationAttempt; run: () => Promise<string> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase.from("profiles").select("full_name").eq("id", auth.user.id).single();
      setName(data?.full_name ?? null);
    })().catch(() => { /* Name is optional; publication still verifies authentication. */ });
  }, [supabase]);

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
    const lineStart = before.startsWith("#") || before.startsWith(">") || before.startsWith("- ") || /^\d+\. /.test(before);
    const insertion = (lineStart && start > 0 && body[start - 1] !== "\n" ? "\n" : "") + before + chosen + after;
    const next = body.slice(0, start) + insertion + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + insertion.length - after.length;
      el.setSelectionRange(chosen ? pos : start + insertion.length - after.length, chosen ? pos : start + insertion.length - after.length);
    });
  }

  // Always gives `block` its own paragraph: guarantees a real blank line
  // before and after wherever the cursor sits, so an inserted image (or
  // any block-level markup) can never merge into surrounding text and get
  // read back as a plain paragraph instead of the block it's meant to be.
  function insertBlockAt(text: string, pos: number, block: string): { next: string; newPos: number } {
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    const leadIn = before.length === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const leadOut = after.length === 0 ? "" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    const insertion = leadIn + block + leadOut;
    return { next: before + insertion + after, newPos: before.length + insertion.length };
  }

  const openLinkModal = () => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? start;
    linkRangeRef.current = { start, end };
    setLinkText(body.slice(start, end));
    setLinkUrl("https://");
    setLinkModalOpen(true);
  };

  const confirmLink = () => {
    const url = linkUrl.trim();
    if (!/^https?:\/\/.+/.test(url)) {
      setError("The link needs to start with https:// and have something after it.");
      return;
    }
    setError(null);
    const { start, end } = linkRangeRef.current;
    const text = linkText.trim() || url;
    const markdown = "[" + text + "](" + url + ")";
    const next = body.slice(0, start) + markdown + body.slice(end);
    setBody(next);
    setLinkModalOpen(false);
    const pos = start + markdown.length;
    requestAnimationFrame(() => {
      bodyRef.current?.focus();
      bodyRef.current?.setSelectionRange(pos, pos);
    });
  };

  async function insertImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || busyRef.current || publication.current || preparingImage.current) return;
    preparingImage.current = true;
    setImageBusy(true);
    try {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = uid + "/article-" + crypto.randomUUID() + "." + ext;
    const bad = await checkUploadableBytes(file);
    if (bad) { setError(bad); return; }
    const { error: upErr } = await supabase.storage.from("post-media").upload(path, file, { contentType: file.type });
    if (upErr) { setError("That image did not upload: " + upErr.message); return; }
    const { data } = supabase.storage.from("post-media").getPublicUrl(path);
    const el = bodyRef.current;
    const pos = el?.selectionStart ?? body.length;
    setBody((current) => insertBlockAt(current, pos, "![](" + data.publicUrl + ")").next);
    requestAnimationFrame(() => { el?.focus(); });
    e.target.value = "";
    } catch (failure) { setError(publicationError(failure)); }
    finally { preparingImage.current = false; setImageBusy(false); }
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
      if (publishedRef.current) return;
      try {
        if (title || body) window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, body }));
        else window.localStorage.removeItem(DRAFT_KEY);
      } catch { /* Keep the in-memory draft if browser storage is unavailable. */ }
    }, 500);
    return () => clearTimeout(t);
  }, [title, body]);

  const clearCover = () => { if (coverPreview) URL.revokeObjectURL(coverPreview); setCover(null); setCoverPreview(null); if (fileRef.current) fileRef.current.value = ""; };

// Same markup grammar ArticleBody reads, run the other way: turns the
// written text into the structured blocks Phase 2 storage expects.
// Kept in sync by hand with the identical function in the other platform's
// composer and with ArticleBody's own regexes - if one changes, all three do.
function bodyToBlocks(text: string): Record<string, unknown>[] {
  const H1 = /^# (.+)$/;
  const H2 = /^## (.+)$/;
  const QUOTE = /^> ?(.*)$/;
  const IMG = /^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/;
  const RULE = /^---+$/;
  const BULLET_LINE = /^- (.+)$/;
  const NUMBERED_LINE = /^\d+\. (.+)$/;
  const blocks: Record<string, unknown>[] = [];
  const rawBlocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  for (const raw of rawBlocks) {
    const block = raw.trim();
    if (!block) continue;
    let m: RegExpMatchArray | null;
    if ((m = H1.exec(block))) { blocks.push({ type: 'heading', level: 1, text: m[1] }); continue; }
    if ((m = H2.exec(block))) { blocks.push({ type: 'heading', level: 2, text: m[1] }); continue; }
    if ((m = IMG.exec(block))) { blocks.push({ type: 'image', url: m[2], caption: m[1] || null }); continue; }
    if (RULE.test(block)) { blocks.push({ type: 'divider' }); continue; }
    if (block.split('\n').every((l) => BULLET_LINE.test(l))) {
      blocks.push({ type: 'bulleted_list', items: block.split('\n').map((l) => BULLET_LINE.exec(l)![1]) });
      continue;
    }
    if (block.split('\n').every((l) => NUMBERED_LINE.test(l))) {
      blocks.push({ type: 'numbered_list', items: block.split('\n').map((l) => NUMBERED_LINE.exec(l)![1]) });
      continue;
    }
    if (block.split('\n').every((l) => QUOTE.test(l))) {
      const inner = block.split('\n').map((l) => (QUOTE.exec(l) ?? ['', ''])[1]).join('\n');
      blocks.push({ type: 'quote', text: inner });
      continue;
    }
    blocks.push({ type: 'paragraph', text: block });
  }
  return blocks;
}

  const publish = async () => {
    if (busyRef.current || preparingImage.current || publication.current?.progress.uncertain) return;
    if (!title.trim() || body.trim().length < 100) {
      setError("An article needs a title and at least a real opening — write a little more.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    if (!publication.current) {
      let author: string | null = null;
      const progress = new PublicationAttempt(async () => {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !author || data.session?.user.id !== author) throw new Error("Return to the account that started this article to finish it.");
      });
      let coverUrl: string | null = null;
      const run = async (): Promise<string> => {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) throw new Error("Sign in to publish.");
        if (author && author !== uid) throw new Error("Return to the account that started this article to finish it.");
        author = uid;

        const coverWidth: number | null = null;
        const coverHeight: number | null = null;
        if (cover && !coverUrl) {
          const ext = (cover.name.split(".").pop() || "jpg").toLowerCase();
          const path = uid + "/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
          const badCover = await checkUploadableBytes(cover);
          if (badCover) throw new Error(badCover);
          const { error: upErr } = await supabase.storage.from("post-media").upload(path, cover, { contentType: cover.type });
          if (upErr) throw new Error("The cover did not upload: " + upErr.message);
          const { data: pub } = supabase.storage.from("post-media").getPublicUrl(path);
          coverUrl = pub.publicUrl;
          // Real width/height need decoding the file; the composer preview already
          // does this via the browser for display, but doesn't currently keep the
          // numbers around to send here. Left null for now rather than guessed.
        }

        // One server call, one transaction: the post and its cover post_media row
        // are created or fail together, instead of two separate client inserts
        // where the second one could silently fail.
        const newPostId = await progress.write("article", () => supabase.rpc("publish_article", {
          p_user_id: uid,
          p_title: title.trim(),
          p_body: body.trim(),
          p_read_minutes: minutes,
          p_cover_url: coverUrl,
          p_cover_width: coverWidth,
          p_cover_height: coverHeight,
          p_blocks: bodyToBlocks(body.trim()),
        }));
        if (!newPostId) { progress.uncertain = true; throw new Error("Could not confirm the article."); }
        progress.postId = newPostId;
        if (category) await progress.write("category", () => supabase.from("posts").update({ category }).eq("id", newPostId).select("id").single());
        await progress.check();
        return newPostId;

      };
      publication.current = { progress, run };
      setPublicationStatus({ postId: null, uncertain: false, locked: true, published: false });
    }
    try {
      const postId = await publication.current.run();
      publishedRef.current = true;
      setPublicationStatus({ postId, uncertain: false, locked: true, published: true });
      try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* Published successfully even if storage is unavailable. */ }
      try { router.push("/post/" + postId); } catch { setError("Your article was published. Use View article to open it."); }
    } catch (failure) {
      const progress = publication.current?.progress;
      setPublicationStatus({ postId: progress?.postId ?? null, uncertain: progress?.uncertain ?? false, locked: !!progress?.postId || !!progress?.uncertain, published: false });
      setError((progress?.uncertain
        ? "We could not confirm the last save. Check your profile before publishing again. Your draft remains open here; keep this page open. "
        : progress?.postId
          ? "Your article is published, but its category did not save. Retry updates this same article. Your draft remains open here; keep this page open. "
          : "Your draft remains open here; keep this page open. ") + publicationError(failure));
      if (!progress?.postId && !progress?.uncertain) publication.current = null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[680px] px-1 pb-20">
      <div className="flex items-center justify-between pb-4">
        <button type="button" onClick={() => { if (window.history.length > 1) router.back(); else router.push("/home"); }} className="inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"><ArrowLeft size={14} /> Back</button>
        <button onClick={publish} disabled={busy || imageBusy || publicationStatus.published || publicationStatus.uncertain} className="rounded-full bg-ink px-4 py-1.5 text-[13.5px] font-bold text-white disabled:opacity-40">{busy ? "Publishing" : publicationStatus.postId ? "Retry" : "Publish"}</button>
      </div>

      <fieldset disabled={publicationStatus.locked} className="contents">
      <textarea value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" rows={1}
        onInput={e => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }}
        className="w-full resize-none overflow-hidden border-0 font-display text-[26px] font-bold leading-tight text-ink outline-none placeholder:text-muted" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button key={c.key} type="button" onClick={() => setCategory(category === c.key ? null : c.key)}
            className={"rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors duration-[140ms] " + (category === c.key ? "border-ink bg-ink text-white" : "border-ink/15 text-ink/60 hover:border-ink/40")}>{c.label}</button>
        ))}
      </div>

      {coverPreview ? (
        <div className="relative mb-3 mt-2 overflow-hidden rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverPreview} alt="" className="h-[220px] w-full object-cover" />
          <button onClick={clearCover} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"><X size={14} /></button>
        </div>
      ) : (
        <label className="mb-3 mt-2 flex min-h-[54px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-ink/15 text-[13px] font-semibold text-muted hover:border-ink/30">
          <ImagePlus size={15} /> Add a cover image (optional)
          <input ref={fileRef} type="file" accept="image/*" onChange={pickCover} className="hidden" />
        </label>
      )}

      <p className="mb-3 text-[12px] font-semibold text-muted">{minutes} min read · publishing as {name || "you"}</p>

      {/* Formatting inserts the same markup X uses under the hood: headings,
          bold, italic, quotes, links and images. Plain paragraphs need none. */}
      <div className="sticky top-[72px] z-10 mb-2 flex flex-wrap items-center gap-1 rounded-xl border border-ink/10 bg-white/95 px-2 py-1.5 backdrop-blur">
        {([
          ["H", "Heading", "# ", ""], ["h", "Subheading", "## ", ""], ["B", "Bold", "**", "**"], ["I", "Italic", "_", "_"],
          ["\u201C", "Quote", "> ", ""], ["\u2014", "Divider", "\n---\n", ""],
          ["\u2022", "Bullet list", "- ", ""], ["1.", "Numbered list", "1. ", ""],
        ] as [string, string, string, string][]).map(([glyph, title, before, after]) => (
          <button key={title} type="button" title={title} onClick={() => wrap(before, after)}
            className="min-w-[32px] rounded-lg px-2 py-1 text-[13px] font-semibold text-ink/70 transition-colors hover:bg-surface hover:text-ink">{glyph}</button>
        ))}
        <button type="button" title="Link" onClick={openLinkModal}
          className="min-w-[32px] rounded-lg px-2 py-1 text-[13px] font-semibold text-ink/70 transition-colors hover:bg-surface hover:text-ink">{"\u{1F517}"}</button>
        <label title="Insert an image" className="min-w-[32px] cursor-pointer rounded-lg px-2 py-1 text-ink/70 transition-colors hover:bg-surface hover:text-ink">
          <ImagePlus size={15} />
          <input type="file" accept="image/*" onChange={insertImage} className="hidden" />
        </label>
        <span className="ml-auto text-[11.5px] text-muted">{body.trim() ? body.trim().split(/\s+/).length : 0} words</span>
        <button type="button" onClick={() => setPreview((v) => !v)}
          className={"rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors " + (preview ? "bg-ink text-white" : "bg-surface text-ink/70 hover:text-ink")}>
          {preview ? "Edit" : "Preview"}
        </button>
      </div>

      {preview ? (
        <div className="min-h-[420px] rounded-xl border border-ink/10 bg-white px-5 py-4">
          {body.trim() ? <ArticleBody text={body} /> : <p className="text-[14px] text-muted">Nothing to preview yet.</p>}
        </div>
      ) : (
        <textarea ref={bodyRef} value={body} onChange={e => setBody(e.target.value)} placeholder="Write the piece. Paragraphs are preserved exactly as you write them. Use the toolbar for headings, emphasis, quotes, links and images."
          className="min-h-[420px] w-full resize-none border-0 text-[16px] leading-relaxed text-ink outline-none placeholder:text-muted" />
      )}

      </fieldset>
      {error ? <p role="alert" className="mt-2 text-[13px] text-danger">{error}{publicationStatus.postId ? <> <Link target="_blank" rel="noopener noreferrer" href={"/post/" + publicationStatus.postId} className="underline">View article</Link></> : null}</p> : null}

      {linkModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6" onClick={() => setLinkModalOpen(false)}>
          <div className="w-full max-w-[360px] rounded-2xl bg-white p-5" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <p className="mb-3 text-[15px] font-bold text-ink">Add a link</p>
            <input value={linkText} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLinkText(e.target.value)} placeholder="Link text"
              className="mb-2.5 w-full rounded-xl bg-surface px-3.5 py-2.5 text-[14px] text-ink outline-none placeholder:text-muted" />
            <input value={linkUrl} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLinkUrl(e.target.value)} placeholder="https://" autoCapitalize="none" autoCorrect="off"
              className="mb-3 w-full rounded-xl bg-surface px-3.5 py-2.5 text-[14px] text-ink outline-none placeholder:text-muted" />
            <div className="flex gap-2.5">
              <button type="button" onClick={() => setLinkModalOpen(false)} className="flex-1 rounded-xl bg-surface py-2.5 text-[13.5px] font-bold text-ink/60">Cancel</button>
              <button type="button" onClick={confirmLink} className="flex-1 rounded-xl bg-ink py-2.5 text-[13.5px] font-bold text-white">Insert</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
