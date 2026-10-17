"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, ImagePlus, Plus, Trash2, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { STORY_FILTERS, STORY_FILTER_FAMILIES, filterCss } from "@/lib/stories";
import { searchPeople, type AccessPerson } from "@/lib/memoryAlbum";
import { PublicationAttempt, publicationError } from "@/lib/publication";
import { checkUploadableBytes } from "@/lib/media";

type Draft = {
  id: string; media_url: string | null; media_type: string; caption: string | null;
  audience: string; shared_with: string[]; duration_sec: number | null; created_at: string;
};

const AUD = [
  { key: "everyone", label: "Everyone" },
  { key: "followers", label: "Followers" },
  { key: "close_friends", label: "Close friends" },
  { key: "only_with", label: "Only these people" },
];

function ComposerInner() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const params = useSearchParams();
  const [uid, setUid] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [caption, setCaption] = useState("");
  const [filterId, setFilterId] = useState<string | null>(null);
  const [audience, setAudience] = useState("everyone");
  const [people, setPeople] = useState<AccessPerson[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AccessPerson[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const publishedRef = useRef(false);
  const [publicationStatus, setPublicationStatus] = useState<{ postId: string | null; uncertain: boolean; locked: boolean; published: boolean }>({ postId: null, uncertain: false, locked: false, published: false });
  const publication = useRef<{ progress: PublicationAttempt; run: () => Promise<void> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user.id ?? null;
      setUid(u);
      if (!u) router.push("/login");
    });
  }, [supabase, router]);

  const loadDrafts = async (u: string) => {
    const { data, error: draftError } = await supabase.from("story_drafts").select("*")
      .eq("user_id", u).order("created_at", { ascending: false }).limit(12);
    if (draftError) throw draftError;
    setDrafts((data ?? []) as Draft[]);
  };
  useEffect(() => { if (uid) void loadDrafts(uid).catch((failure) => setError("Could not load drafts. " + publicationError(failure))); }, [uid]);

  useEffect(() => {
    const d = params.get("draft");
    if (d && drafts.length) {
      const row = drafts.find((x) => x.id === d);
      if (row) applyDraft(row);
    }
  }, [params, drafts.length]);

  useEffect(() => {
    const t = setTimeout(() => { searchPeople(q).then(setResults); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function applyDraft(d: Draft) {
    setDraftId(d.id);
    setMediaUrl(d.media_url);
    setMediaType(d.media_type === "video" ? "video" : "image");
    setDurationSec(d.duration_sec);
    setCaption(d.caption ?? "");
    setAudience(d.audience);
    if (d.shared_with.length) {
      supabase.from("profiles").select("id, full_name, username, avatar_url")
        .in("id", d.shared_with).then(({ data }) => setPeople((data ?? []) as AccessPerson[]));
    } else setPeople([]);
  }

  async function pickFile(f: File) {
    if (!uid || busyRef.current || publication.current) return;
    busyRef.current = true;
    setBusy("upload");
    setError(null);
    try {
      if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) throw new Error("Choose a photo or video.");
      const bad = await checkUploadableBytes(f);
      if (bad) throw new Error(bad);
      const isVideo = f.type.startsWith("video/");
      const ext = (f.name.split(".").pop() || (isVideo ? "mp4" : "jpg")).toLowerCase();
      const path = uid + "/" + crypto.randomUUID() + "." + ext;
      const { error: upErr } = await supabase.storage.from("story-media").upload(path, f, { contentType: f.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("story-media").getPublicUrl(path);
      setMediaUrl(pub.publicUrl);
      setMediaType(isVideo ? "video" : "image");
      setDurationSec(null);
      if (isVideo) {
        const duration = await new Promise<number | null>((resolve) => {
          const video = document.createElement("video");
          const url = URL.createObjectURL(f);
          const finish = (value: number | null) => { clearTimeout(timer); video.onloadedmetadata = null; video.onerror = null; video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); resolve(value); };
          const timer = setTimeout(() => finish(null), 5000);
          video.preload = "metadata";
          video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? Math.min(60, Math.max(1, Math.round(video.duration))) : null);
          video.onerror = () => finish(null);
          video.src = url;
        });
        setDurationSec(duration);
      }
    } catch (failure) { setError(publicationError(failure)); }
    finally { busyRef.current = false; setBusy(null); }
  }

  async function publish() {
    if (!uid || !mediaUrl || busyRef.current || publishedRef.current || publication.current?.progress.uncertain) return;
    if (audience === "only_with" && people.length === 0) { setError("Choose at least one person to share with."); return; }
    busyRef.current = true;
    setBusy("publish");
    setError(null);
    if (!publication.current) {
      const progress = new PublicationAttempt(async () => {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || data.session?.user.id !== uid) throw new Error("Return to the account that started this story to finish it.");
      });
      const run = async () => {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError || auth.user?.id !== uid) throw new Error("Sign in to the account that started this story to finish it.");
        const row = await progress.write("story", () => supabase.from("stories").insert({
          user_id: uid, media_url: mediaUrl, media_type: mediaType,
          caption: caption.trim() || null, audience, filter_id: filterId,
          duration_sec: mediaType === "video" ? durationSec ?? 10 : null,
        }).select("id").single());
        if (!row) { progress.uncertain = true; throw new Error("Could not confirm the story."); }
        progress.postId = row.id;
        if (audience === "only_with") {
          await progress.write("recipients", () => supabase.from("story_shared_with").insert(
            Array.from(new Set(people.map((p) => p.id))).map((id) => ({ story_id: row.id, user_id: id }))));
        }
        const handles = Array.from(new Set((caption.match(/@([A-Za-z0-9_.]{2,30})/g) || []).map((h) => h.slice(1).toLowerCase())));
        if (handles.length) {
          const { data: ppl, error: lookupError } = await supabase.from("profiles").select("id").in("username", handles).neq("id", uid);
          if (lookupError) throw lookupError;
          const rows = ((ppl ?? []) as { id: string }[]).map((p) => ({ story_id: row.id, mentioned_user_id: p.id, visible: true }));
          if (rows.length) await progress.write("mentions", () => supabase.from("story_mentions").insert(rows));
        }
        if (draftId) await progress.write("delete-draft", () => supabase.from("story_drafts").delete().eq("id", draftId));
        await progress.check();
      };
      publication.current = { progress, run };
      setPublicationStatus({ postId: null, uncertain: false, locked: true, published: false });
    }
    try {
      await publication.current.run();
      publishedRef.current = true;
      setPublicationStatus({ postId: publication.current.progress.postId, uncertain: false, locked: true, published: true });
      try { router.push("/home"); } catch { setError("Your story was shared. Open Home to view it."); }
    } catch (failure) {
      const progress = publication.current?.progress;
      setPublicationStatus({ postId: progress?.postId ?? null, uncertain: progress?.uncertain ?? false, locked: !!progress?.postId || !!progress?.uncertain, published: false });
      setError((progress?.uncertain
        ? "We could not confirm the last save. Check your stories before sharing again. Your draft remains open here; keep this page open. "
        : progress?.postId
          ? "Your story exists, but sharing did not finish. Retry finishes this same story. Your draft remains open here; keep this page open. "
          : "Your draft remains open here; keep this page open. ") + publicationError(failure));
      if (!progress?.postId && !progress?.uncertain) publication.current = null;
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!uid || !mediaUrl || busyRef.current || publication.current) return;
    busyRef.current = true;
    setBusy("draft");
    setError(null);
    let saved = false;
    try {
      const payload = {
        user_id: uid, media_url: mediaUrl, media_type: mediaType,
        caption: caption.trim() || null, audience,
        shared_with: people.map((p) => p.id), duration_sec: durationSec,
      };
      const r = draftId
        ? await supabase.from("story_drafts").update(payload).eq("id", draftId).select("id").single()
        : await supabase.from("story_drafts").insert(payload).select("id").single();
      if (r.error || !r.data) throw r.error || new Error("Could not confirm the saved draft.");
      saved = true;
      setDraftId(null); setMediaUrl(null); setCaption(""); setPeople([]); setAudience("everyone");
      await loadDrafts(uid);
    } catch (failure) { setError((saved ? "Draft saved, but the draft list could not reload. " : "Your draft remains open here; keep this page open. ") + publicationError(failure)); }
    finally { busyRef.current = false; setBusy(null); }
  }

  return (
    <div className="mx-auto w-full max-w-[560px] px-4 pb-16">
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex items-center gap-2 border-b border-ink/10 bg-white/75 px-4 py-2.5 backdrop-blur-md">
        <Link href="/home" className="rounded-full p-2 text-ink/60 hover:bg-black/5" aria-label="Back"><ArrowLeft size={18} /></Link>
        <p className="flex-1 font-display text-[17px] text-ink">New story</p>
        <Link href="/archive" className="rounded-full bg-black/5 px-3 py-1.5 text-[12px] font-semibold text-ink/70">Archive</Link>
      </div>

      <fieldset disabled={!!busy || publicationStatus.locked} className="contents">
      {drafts.length > 0 && !mediaUrl ? (
        <div className="mb-5">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Drafts</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {drafts.map((d) => (
              <div key={d.id} className="relative w-20 shrink-0">
                <button onClick={() => applyDraft(d)} className="block aspect-[9/14] w-full overflow-hidden rounded-lg border border-ink/10 bg-ink/5">
                  {d.media_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    d.media_type === "video" ? <video src={d.media_url} muted className="h-full w-full object-cover" /> : <img src={d.media_url} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </button>
                <button onClick={async () => {
                  if (busyRef.current) return;
                  busyRef.current = true; setBusy("delete"); setError(null);
                  try {
                    const { error: deleteError } = await supabase.from("story_drafts").delete().eq("id", d.id);
                    if (deleteError) throw deleteError;
                    if (uid) await loadDrafts(uid);
                  } catch (failure) { setError("Could not confirm the draft list. " + publicationError(failure)); }
                  finally { busyRef.current = false; setBusy(null); }
                }}
                  className="absolute -right-1 -top-1 rounded-full bg-white p-1 text-ink/50 shadow" aria-label="Delete draft"><X size={11} /></button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!mediaUrl ? (
        <button onClick={() => fileRef.current?.click()} disabled={busy === "upload"}
          className="flex aspect-[9/14] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-ink/15 text-ink/45 hover:border-ink/30">
          <ImagePlus size={26} />
          <span className="text-[13px] font-semibold">{busy === "upload" ? "Uploading" : "Add a photo or video"}</span>
        </button>
      ) : (
        <>
        <div className="relative aspect-[9/14] w-full overflow-hidden rounded-2xl bg-ink">
          {mediaType === "video" ? (
            <video src={mediaUrl} controls playsInline className="h-full w-full object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl} alt="" className="h-full w-full object-contain" />
          )}
          {/* The chosen look, drawn exactly as the viewer draws it. */}
          {filterId ? (() => { const f = STORY_FILTERS.find((x) => x.id === filterId); return f ? (
            <div className="pointer-events-none absolute inset-0" style={{ backdropFilter: filterCss(filterId), WebkitBackdropFilter: filterCss(filterId) }}>
              {f.layers.map((l, i) => <div key={i} className="absolute inset-0" style={{ backgroundColor: l.color, opacity: l.opacity }} />)}
            </div>) : null; })() : null}
          <button onClick={() => { setMediaUrl(null); setDraftId(null); }} className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white" aria-label="Remove media"><X size={14} /></button>
        </div>
        {mediaType === "image" ? (
          <div className="mt-3">
            {STORY_FILTER_FAMILIES.map((fam) => (
              <div key={fam.key} className="mb-2">
                <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink/40">{fam.label}</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {(fam.key === "classic" ? [{ id: null as string | null, label: "None", layers: [] as { color: string; opacity: number }[], css: undefined as string | undefined }, ...STORY_FILTERS.filter((f) => f.family === fam.key)] : STORY_FILTERS.filter((f) => f.family === fam.key)).map((f) => {
                    const on = filterId === f.id;
                    return (
                      <button key={f.id ?? "none"} type="button" onClick={() => setFilterId(f.id)} className="flex w-[64px] shrink-0 flex-col items-center gap-1">
                        <span className={"relative block h-[64px] w-[64px] overflow-hidden rounded-xl border-2 " + (on ? "border-pearl" : "border-transparent")}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={mediaUrl} alt="" className="h-full w-full object-cover" style={{ filter: filterCss(f.id) }} />
                          {f.layers.map((l, i) => <span key={i} className="absolute inset-0" style={{ backgroundColor: l.color, opacity: l.opacity }} />)}
                        </span>
                        <span className={"text-[11px] " + (on ? "font-semibold text-ink" : "text-ink/50")}>{f.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        </>
      )}
      <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }} />

      <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={120} placeholder="Write a caption"
        className="mt-4 w-full rounded-lg border border-ink/15 px-3 py-2.5 text-[14px] text-ink outline-none focus:border-ink/40" />

      <p className="mb-1.5 mt-4 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Audience</p>
      <div className="grid grid-cols-2 gap-1.5">
        {AUD.map((a) => (
          <button key={a.key} onClick={() => setAudience(a.key)}
            className={"flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-[13px] " + (audience === a.key ? "border-ink bg-black/[0.03] font-semibold text-ink" : "border-ink/10 text-ink/70")}>
            {a.label}{audience === a.key ? <Check size={14} /> : null}
          </button>
        ))}
      </div>

      {audience === "only_with" ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink/40"><Users size={13} /> Share with</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people"
            className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/40" />
          {results.map((r) => (
            <button key={r.id} onClick={() => { if (!people.some((p) => p.id === r.id)) setPeople([...people, r]); setQ(""); setResults([]); }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/5">
              <span className="text-[13px] text-ink">{r.full_name} <VerifiedBadge userId={r.id} size={12} /> <span className="text-ink/40">@{r.username}</span></span>
              <Plus size={13} className="ml-auto text-ink/40" />
            </button>
          ))}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {people.map((p) => (
              <span key={p.id} className="flex items-center gap-1 rounded-full bg-black/5 px-2.5 py-1 text-[12px] text-ink">
                {p.full_name}
                <VerifiedBadge userId={p.id} size={11} />
                <button onClick={() => setPeople(people.filter((x) => x.id !== p.id))} aria-label="Remove"><X size={11} /></button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      </fieldset>
      {error ? <p role="alert" className="mt-3 text-[13px] text-red-700">{error}</p> : null}
      <div className="mt-5 flex gap-2">
        <button onClick={saveDraft} disabled={!mediaUrl || !!busy || publicationStatus.locked}
          className="flex-1 rounded-md border border-ink/15 py-2.5 text-sm font-semibold text-ink/70 disabled:opacity-40">
          {busy === "draft" ? "Saving" : draftId ? "Update draft" : "Save as draft"}
        </button>
        <button onClick={publish} disabled={!mediaUrl || audience === "only_with" && people.length === 0 || !!busy || publicationStatus.published || publicationStatus.uncertain}
          className="flex-1 rounded-md bg-pearl py-2.5 text-sm font-semibold text-ink disabled:opacity-40">
          {busy === "publish" ? "Posting" : publicationStatus.postId ? "Retry" : "Share to story"}
        </button>
      </div>
    </div>
  );
}

export function StoryComposer() {
  return (
    <Suspense fallback={<p className="py-24 text-center text-sm text-ink/40">Opening</p>}>
      <ComposerInner />
    </Suspense>
  );
}