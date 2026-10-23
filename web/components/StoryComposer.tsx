"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, ImagePlus, Plus, Trash2, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { STORY_FILTERS, STORY_FILTER_FAMILIES, filterCss, type StoryTextSticker, type StoryMediaTransform } from "@/lib/stories";
import { searchPeople, type AccessPerson } from "@/lib/memoryAlbum";
import { publicationError } from "@/lib/publication";
import { checkUploadableBytes } from "@/lib/media";
import { hydrateStoryDraftMedia } from "@/lib/contentMedia";
import { StoryEditor } from "@/components/StoryEditor";
import { StoryAudioEditor } from "@/components/StoryAudioEditor";
import type { StoryAudioDraft } from "@/lib/storyAudio";

type Draft = {
  id: string; user_id: string; media_url: string | null; media_type: string; caption: string | null;
  audience: string; shared_with: string[]; duration_sec: number | null; created_at: string;
  preview_media_url?: string | null;
  audio_draft?: StoryAudioDraft | null;
  filter_id?: string | null; stickers_json?: StoryTextSticker[]; media_transform?: StoryMediaTransform | null; text_background?: { colors: string[] } | null;
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const localPreview = useRef<string | null>(null);
  const replacePreview = (url: string | null) => {
    if (localPreview.current) URL.revokeObjectURL(localPreview.current);
    localPreview.current = url?.startsWith("blob:") ? url : null;
    setPreviewUrl(url);
  };
  const [mediaType, setMediaType] = useState<"image" | "video" | "text">("image");
  const [audioDraft, setAudioDraft] = useState<StoryAudioDraft | null>(null);
  const videoPreview = useRef<HTMLVideoElement | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [caption, setCaption] = useState("");
  const [stickers, setStickers] = useState<StoryTextSticker[]>([]);
  const [transform, setTransform] = useState<StoryMediaTransform>({ scale: 1, translateNX: 0, translateNY: 0 });
  const [background, setBackground] = useState({ colors: ["#0B1E3D", "#594D71"] });
  const [editorKey, setEditorKey] = useState(0);
  const [filterId, setFilterId] = useState<string | null>(null);
  const [audience, setAudience] = useState("everyone");
  const [people, setPeople] = useState<AccessPerson[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AccessPerson[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const publishedRef = useRef(false);
  const [publicationStatus, setPublicationStatus] = useState<{ postId: string | null; uncertain: boolean; locked: boolean; published: boolean }>({ postId: null, uncertain: false, locked: false, published: false });
  const publication = useRef<{ requestId: string; payload: Record<string, unknown> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const draftRequest = useRef(0);
  const appliedRouteDraft = useRef<string | null>(null);

  const mountedRef = useRef(true);
  const ownerRef = useRef<string | null>(null);
  const ownerVersion = useRef(0);
  const authEventVersion = useRef(0);
  const cancellations = useRef(new Set<() => void>());
  const metadataCleanup = useRef<(() => void) | null>(null);

  useEffect(() => { if (videoPreview.current) videoPreview.current.volume = Math.max(0, Math.min(1, (transform.mix?.orig ?? 100) / 100)); }, [transform.mix?.orig, previewUrl]);

  const isCurrent = (owner: string, version: number) => mountedRef.current && ownerRef.current === owner && ownerVersion.current === version;
  const assertOwner = (owner: string, version: number) => {
    if (!isCurrent(owner, version)) throw new Error("The account changed. Open this story from its original account.");
  };
  const runBounded = <T,>(work: PromiseLike<T>, timeout = 15000): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    let cancel: () => void;
    return new Promise<T>((resolve, reject) => {
      cancel = () => reject(new Error("This story operation was cancelled."));
      cancellations.current.add(cancel);
      timer = setTimeout(() => reject(new Error("The request took too long. Please try again.")), timeout);
      Promise.resolve(work).then(resolve, reject);
    }).finally(() => { clearTimeout(timer); cancellations.current.delete(cancel); });
  };
  const checkOwner = async (owner: string, version: number) => {
    assertOwner(owner, version);
    const { data, error: sessionError } = await runBounded(supabase.auth.getSession());
    assertOwner(owner, version);
    if (sessionError || data.session?.user.id !== owner) throw new Error("Return to the account that started this story to finish it.");
  };

  useEffect(() => {
    mountedRef.current = true;
    const cancelPending = () => {
      cancellations.current.forEach(cancel => cancel());
      cancellations.current.clear();
      metadataCleanup.current?.();
      metadataCleanup.current = null;
    };
    const setOwner = (next: string | null) => {
      if (!mountedRef.current) return;
      if (ownerRef.current !== next) {
        const previous = ownerRef.current;
        ownerVersion.current += 1;
        ownerRef.current = next;
        draftRequest.current += 1;
        cancelPending();
        busyRef.current = false;
        publication.current = null;
        publishedRef.current = false;
        appliedRouteDraft.current = null;
        setDrafts([]); setDraftId(null); setMediaUrl(null); replacePreview(null); setMediaType("image");
        setCaption(""); setAudioDraft(null); setPeople([]); setAudience("everyone"); setFilterId(null); setDurationSec(null);
        setStickers([]); setTransform({ scale: 1, translateNX: 0, translateNY: 0 }); setEditorKey(k => k + 1);
        if (previous) { try { sessionStorage.removeItem("platinum:story-publish:" + previous); } catch {} }
        setQ(""); setResults([]); setBusy(null);
        setPublicationStatus({ postId: null, uncertain: false, locked: false, published: false });
        setError(previous && next ? "Account changed. Choose a story for this account." : null);
      }
      setUid(next);
      if (!next) router.push("/login");
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventVersion.current += 1;
      setOwner(session?.user.id ?? null);
    });
    const initialVersion = authEventVersion.current;
    runBounded(supabase.auth.getSession()).then(({ data, error: sessionError }) => {
      if (!mountedRef.current || authEventVersion.current !== initialVersion) return;
      if (sessionError) throw sessionError;
      setOwner(data.session?.user.id ?? null);
    }).catch(() => {
      if (!mountedRef.current || authEventVersion.current !== initialVersion) return;
      setError("Your account could not be loaded. Refresh to try again.");
    });
    return () => {
      mountedRef.current = false;
      ownerVersion.current += 1;
      authEventVersion.current += 1;
      cancelPending();
      subscription.unsubscribe();
      if (localPreview.current) URL.revokeObjectURL(localPreview.current);
      localPreview.current = null;
    };
  }, [supabase, router]);

  useEffect(() => {
    if (!uid) return;
    try {
      const raw = sessionStorage.getItem("platinum:story-publish:" + uid);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.requestId !== "string" || !saved.payload || typeof saved.payload !== "object") throw new Error();
      const p = saved.payload;
      publication.current = saved;
      setAudioDraft(p.audio_draft ?? null);
      setMediaUrl(p.media_url ?? null); setMediaType(p.media_type);
      setCaption(p.caption ?? ""); setAudience(p.audience); setFilterId(p.filter_id);
      setStickers(p.stickers_json ?? []); setTransform(p.media_transform ?? { scale: 1, translateNX: 0, translateNY: 0 });
      if (p.text_background) setBackground(p.text_background);
      setPeople((p.shared_with ?? []).map((id: string) => ({ id, full_name: "Selected recipient", username: null, avatar_url: null })));
      setDraftId(p.draft_id ?? null); setEditorKey(k => k + 1);
      setPublicationStatus({ postId: null, uncertain: true, locked: true, published: false });
      setError("A previous share needs confirmation. Retry safely to confirm the same story.");
    } catch { setError("The pending story could not be restored. Check your stories before starting another."); }
  }, [uid]);

  useEffect(() => {
    const origin = params.get("join"), stickerId = params.get("sticker");
    if (!uid || !origin || !stickerId || publication.current) return;
    let cancelled = false;
    const version = ownerVersion.current;
    void runBounded(supabase.from("stories").select("stickers_json").eq("id", origin).single()).then(({ data, error: readError }) => {
      if (cancelled || !isCurrent(uid, version)) return;
      if (readError) throw readError;
      const source = (data?.stickers_json as StoryTextSticker[] | undefined)?.find(s => s.id === stickerId && s.kind === "addyours");
      if (!source) throw new Error("This Add Yours prompt is no longer available.");
      setStickers(list => list.some(s => s.addYoursOriginStoryId === origin && s.addYoursOriginStickerId === stickerId) ? list : [...list, { ...source, id: crypto.randomUUID(), addYoursOriginStoryId: origin, addYoursOriginStickerId: stickerId }]);
    }).catch(failure => { if (!cancelled && isCurrent(uid, version)) setError(publicationError(failure)); });
    return () => { cancelled = true; };
  }, [uid, params, supabase]);

  const loadDrafts = async (owner: string, version: number) => {
    assertOwner(owner, version);
    const { data, error: draftError } = await runBounded(supabase.from("story_drafts").select("*")
      .eq("user_id", owner).order("created_at", { ascending: false }).limit(12));
    assertOwner(owner, version);
    if (draftError) throw draftError;
    if ((data ?? []).some(row => row.user_id !== owner)) throw new Error("The draft owner could not be confirmed.");
    // Keep canonical references for publication; signed previews never enter a draft write.
    const rows = (data ?? []) as Draft[];
    const previews = await runBounded(hydrateStoryDraftMedia(rows, supabase));
    assertOwner(owner, version);
    setDrafts(rows.map((row, index) => ({ ...row, preview_media_url: previews[index]?.media_url ?? null })));
  };
  useEffect(() => {
    if (!uid) return;
    const version = ownerVersion.current;
    void loadDrafts(uid, version).catch((failure) => { if (isCurrent(uid, version)) setError("Could not load drafts. " + publicationError(failure)); });
  }, [uid]);

  useEffect(() => {
    const d = params.get("draft");
    if (d && d !== appliedRouteDraft.current && drafts.length) {
      const row = drafts.find((x) => x.id === d);
      if (row) { appliedRouteDraft.current = d; void applyDraft(row); }
    }
  }, [params, drafts]);

  useEffect(() => {
    let cancelled = false;
    const version = ownerVersion.current;
    setResults([]);
    if (!q.trim() || !uid) return;
    const t = setTimeout(() => {
      runBounded(searchPeople(q)).then(rows => { if (!cancelled && isCurrent(uid, version)) setResults(rows); })
        .catch(() => { if (!cancelled && isCurrent(uid, version)) setError("People could not be loaded. Try searching again."); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, uid]);

  async function applyDraft(d: Draft) {
    if (!uid || busyRef.current || publication.current || !isCurrent(uid, ownerVersion.current) || d.user_id !== uid) return;
    const owner = uid, version = ownerVersion.current;
    const request = ++draftRequest.current;
    busyRef.current = true;
    setBusy("draft-load");
    setError(null);
    setPeople([]);
    setFilterId(d.filter_id ?? null);
    setStickers(d.stickers_json ?? []); setTransform(d.media_transform ?? { scale: 1, translateNX: 0, translateNY: 0 });
    if (d.text_background) setBackground(d.text_background);
    setEditorKey(k => k + 1);
    setAudioDraft(d.audio_draft ?? null);
    setDraftId(d.id);
    setMediaUrl(d.media_url);
    setMediaType(d.media_type === "video" ? "video" : d.media_type === "text" ? "text" : "image");
    setDurationSec(d.duration_sec);
    setCaption(d.caption ?? "");
    setAudience(d.audience);
    try {
      const [preview] = await runBounded(hydrateStoryDraftMedia([d], supabase));
      assertOwner(owner, version);
      if (draftRequest.current !== request) return;
      replacePreview(preview?.media_url ?? null);
      if (d.shared_with?.length) {
        const { data, error: peopleError } = await runBounded(supabase.from("profiles").select("id, full_name, username, avatar_url").in("id", d.shared_with));
        assertOwner(owner, version);
        if (peopleError) throw peopleError;
        const requested = new Set(d.shared_with);
        const found = new Set((data ?? []).map(person => person.id));
        if (requested.size !== found.size || [...requested].some(id => !found.has(id))) throw new Error("Some selected recipients are no longer available.");
        if (isCurrent(owner, version) && draftRequest.current === request) setPeople((data ?? []) as AccessPerson[]);
      }
    } catch (failure) { if (isCurrent(owner, version) && draftRequest.current === request) setError("Could not load this draft’s recipients. Choose them again before sharing. " + publicationError(failure)); }
    finally { if (isCurrent(owner, version) && draftRequest.current === request) { busyRef.current = false; setBusy(null); } }
  }

  async function pickFile(f: File) {
    if (!uid || busyRef.current || publication.current || !isCurrent(uid, ownerVersion.current)) return;
    const owner = uid, version = ownerVersion.current;
    busyRef.current = true;
    setBusy("upload");
    setError(null);
    try {
      if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) throw new Error("Choose a photo or video.");
      const bad = await runBounded(checkUploadableBytes(f));
      if (bad) throw new Error(bad);
      await checkOwner(owner, version);
      const isVideo = f.type.startsWith("video/");
      const ext = (f.name.split(".").pop() || (isVideo ? "mp4" : "jpg")).toLowerCase();
      const path = uid + "/" + crypto.randomUUID() + "." + ext;
      const { error: upErr } = await runBounded(supabase.storage.from("story-media").upload(path, f, { contentType: f.type, upsert: false }), 120000);
      assertOwner(owner, version);
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("story-media").getPublicUrl(path);
      setMediaUrl(pub.publicUrl);
      replacePreview(URL.createObjectURL(f));
      setMediaType(isVideo ? "video" : "image");
      setDurationSec(null);
      if (isVideo) {
        const duration = await new Promise<number | null>((resolve) => {
          const video = document.createElement("video");
          const url = URL.createObjectURL(f);
          let finished = false;
          const finish = (value: number | null) => { if (finished) return; finished = true; clearTimeout(timer); video.onloadedmetadata = null; video.onerror = null; video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); metadataCleanup.current = null; resolve(value); };
          const timer = setTimeout(() => finish(null), 5000);
          metadataCleanup.current = () => finish(null);
          video.preload = "metadata";
          video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? Math.max(1, Math.round(video.duration)) : null);
          video.onerror = () => finish(null);
          video.src = url;
        });
        assertOwner(owner, version);
        setDurationSec(duration);
      }
    } catch (failure) { if (isCurrent(owner, version)) setError(publicationError(failure)); }
    finally { if (isCurrent(owner, version)) { busyRef.current = false; setBusy(null); } }
  }

  async function publish() {
    if (!uid || (!mediaUrl && mediaType !== "text") || busyRef.current || publishedRef.current || !isCurrent(uid, ownerVersion.current)) return;
    const owner = uid, version = ownerVersion.current;
    if (audience === "only_with" && people.length === 0) { setError("Choose at least one person to share with."); return; }
    if (mediaType === "text" && !stickers.length) { setError("Add text or a sticker to your story."); return; }
    busyRef.current = true; setBusy("publish"); setError(null);
    if (!publication.current) {
      publication.current = { requestId: crypto.randomUUID(), payload: {
        media_url: mediaUrl, media_type: mediaType, caption: caption.trim() || null,
        audience, filter_id: filterId, stickers_json: stickers, media_transform: transform,
        text_background: mediaType === "text" ? background : null,
        duration_sec: mediaType === "video" ? Math.min(60, (transform.trimEnd ?? durationSec ?? 10) - (transform.trimStart ?? 0)) : null,
        shared_with: people.map(p => p.id), draft_id: draftId, audio_draft: audioDraft,
      } };
    }
    const attempt = publication.current;
    setPublicationStatus({ postId: null, uncertain: false, locked: true, published: false });
    try {
      sessionStorage.setItem("platinum:story-publish:" + owner, JSON.stringify(attempt));
      await checkOwner(owner, version);
      const { data: authenticated, error: authError } = await runBounded(supabase.auth.getUser());
      assertOwner(owner, version);
      if (authError || authenticated.user?.id !== owner) throw new Error("Sign in to the account that started this story.");
      const { data, error: writeError } = await runBounded(supabase.rpc("publish_story_v2", {
        p_expected_user: owner, p_request_id: attempt.requestId, p_story: attempt.payload,
      }));
      assertOwner(owner, version);
      if (writeError) throw writeError;
      if (typeof data !== "string") throw new Error("The server did not confirm the story. Retry safely.");
      sessionStorage.removeItem("platinum:story-publish:" + owner);
      publishedRef.current = true;
      setPublicationStatus({ postId: data, uncertain: false, locked: true, published: true });
      router.push("/home");
    } catch (failure) {
      if (!isCurrent(owner, version)) return;
      const code = failure && typeof failure === "object" && "code" in failure ? String(failure.code) : "";
      const rejected = /^(22|23|28|42|P0)[0-9A-Z]{3}$/.test(code);
      if (rejected) { publication.current = null; try { sessionStorage.removeItem("platinum:story-publish:" + owner); } catch {} }
      setPublicationStatus({ postId: null, uncertain: !rejected, locked: !rejected, published: false });
      setError((rejected ? "Your story was not shared. Your edits are still here. " : "We could not confirm sharing. Retry safely to confirm this same story. ") + publicationError(failure));
    } finally { if (isCurrent(owner, version)) { busyRef.current = false; setBusy(null); } }
  }

  async function saveDraft() {
    if (!uid || (!mediaUrl && mediaType !== "text") || busyRef.current || publication.current || !isCurrent(uid, ownerVersion.current)) return;
    const owner = uid, version = ownerVersion.current;
    busyRef.current = true;
    setBusy("draft");
    setError(null);
    let saved = false;
    try {
      await checkOwner(owner, version);
      const payload = {
        user_id: uid, media_url: mediaUrl, media_type: mediaType,
        caption: caption.trim() || null, audience,
        shared_with: people.map((p) => p.id), duration_sec: durationSec, audio_draft: audioDraft,
        filter_id: filterId, stickers_json: stickers, media_transform: transform, text_background: mediaType === "text" ? background : null,
      };
      const r = draftId
        ? await runBounded(supabase.from("story_drafts").update(payload).eq("id", draftId).eq("user_id", owner).select("id").single())
        : await runBounded(supabase.from("story_drafts").insert(payload).select("id").single());
      assertOwner(owner, version);
      if (r.error || !r.data) throw r.error || new Error("Could not confirm the saved draft.");
      saved = true;
      setDraftId(null); setMediaUrl(null); setMediaType("image"); setCaption(""); setAudioDraft(null); setPeople([]); setAudience("everyone"); setFilterId(null); setDurationSec(null); setStickers([]); setEditorKey(k => k + 1); setTransform({ scale: 1, translateNX: 0, translateNY: 0 });
      await loadDrafts(owner, version);
    } catch (failure) { if (isCurrent(owner, version)) setError((saved ? "Draft saved, but the draft list could not reload. " : "Your draft remains open here; keep this page open. ") + publicationError(failure)); }
    finally { if (isCurrent(owner, version)) { busyRef.current = false; setBusy(null); } }
  }

  async function deleteDraft(d: Draft) {
    if (!uid || busyRef.current || d.user_id !== uid || !isCurrent(uid, ownerVersion.current)) return;
    const owner = uid, version = ownerVersion.current;
    busyRef.current = true; setBusy("delete"); setError(null);
    try {
      await checkOwner(owner, version);
      const { data, error: deleteError } = await runBounded(supabase.from("story_drafts").delete().eq("id", d.id).eq("user_id", owner).select("id").maybeSingle());
      assertOwner(owner, version);
      if (deleteError || !data) throw deleteError || new Error("The draft deletion could not be confirmed.");
      await loadDrafts(owner, version);
    } catch (failure) { if (isCurrent(owner, version)) setError("Could not confirm the draft list. " + publicationError(failure)); }
    finally { if (isCurrent(owner, version)) { busyRef.current = false; setBusy(null); } }
  }

  return (
    <div className="mx-auto w-full max-w-[560px] px-4 pb-16">
      <div className="sticky top-0 z-20 -mx-4 mb-4 flex items-center gap-2 border-b border-ink/10 bg-white/75 px-4 py-2.5 backdrop-blur-md">
        <Link href="/home" className="rounded-full p-2 text-muted hover:bg-black/5" aria-label="Back"><ArrowLeft size={18} /></Link>
        <p className="flex-1 font-display text-[17px] text-ink">New story</p>
        <Link href="/archive" className="rounded-full bg-black/5 px-3 py-1.5 text-[12px] font-semibold text-secondary">Archive</Link>
      </div>

      <fieldset disabled={!uid || !!busy || publicationStatus.locked} className="contents">
      {drafts.length > 0 && !mediaUrl && mediaType !== "text" ? (
        <div className="mb-5">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Drafts</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {drafts.map((d) => (
              <div key={d.id} className="relative w-20 shrink-0">
                <button onClick={() => applyDraft(d)} className="block aspect-[9/14] w-full overflow-hidden rounded-lg border border-ink/10 bg-ink/5">
                  {d.media_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    d.media_type === "video" ? <video src={d.preview_media_url ?? undefined} muted className="h-full w-full object-cover" /> : <img src={d.preview_media_url ?? undefined} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </button>
                <button onClick={() => deleteDraft(d)}
                  className="absolute -right-1 -top-1 rounded-full bg-white p-1 text-muted shadow" aria-label="Delete draft"><X size={11} /></button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!mediaUrl && mediaType !== "text" ? (
        <><button onClick={() => fileRef.current?.click()} disabled={busy === "upload"}
          className="flex aspect-[9/14] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-ink/15 text-ink/45 hover:border-ink/30">
          <ImagePlus size={26} />
          <span className="text-[13px] font-semibold">{busy === "upload" ? "Uploading" : "Add a photo or video"}</span>
        </button><button type="button" onClick={() => setMediaType("text")} className="mt-3 w-full rounded-lg border border-ink/15 p-3 text-sm text-ink">Create a text story</button></>
      ) : (
        <>
        <StoryEditor key={editorKey} value={stickers} onChange={setStickers}>
          {mediaType === "text" ? <div className="h-full w-full" style={{ background: `linear-gradient(160deg,${background.colors.join(",")})` }} /> : mediaType === "video" ? (
            <video ref={videoPreview} src={previewUrl ?? undefined} controls playsInline className="h-full w-full object-contain" onTimeUpdate={e => { const v = e.currentTarget; if (transform.trimEnd && v.currentTime >= transform.trimEnd) { v.pause(); v.currentTime = transform.trimStart ?? 0; } }} onPlay={e => { if (e.currentTarget.currentTime < (transform.trimStart ?? 0)) e.currentTarget.currentTime = transform.trimStart ?? 0; }} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl ?? undefined} alt="" className="h-full w-full object-contain" />
          )}
          {/* The chosen look, drawn exactly as the viewer draws it. */}
          {filterId ? (() => { const f = STORY_FILTERS.find((x) => x.id === filterId); return f ? (
            <div className="pointer-events-none absolute inset-0" style={{ backdropFilter: filterCss(filterId), WebkitBackdropFilter: filterCss(filterId) }}>
              {f.layers.map((l, i) => <div key={i} className="absolute inset-0" style={{ backgroundColor: l.color, opacity: l.opacity }} />)}
            </div>) : null; })() : null}
          <button onClick={() => { setMediaUrl(null); replacePreview(null); setMediaType("image"); setDraftId(null); setAudioDraft(null); setStickers([]); setTransform({ scale: 1, translateNX: 0, translateNY: 0 }); setEditorKey(k => k + 1); }} className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white" aria-label="Remove media"><X size={14} /></button>
        </StoryEditor>
        {uid && <StoryAudioEditor key={uid} owner={uid} value={audioDraft} onChange={setAudioDraft} mix={transform.mix ?? {}} onMixChange={mix => setTransform(t => ({ ...t, mix }))} isVideo={mediaType === "video"} disabled={!!busy || publicationStatus.locked} onBusyChange={active => { busyRef.current = active; setBusy(active ? "audio-upload" : null); if (active) videoPreview.current?.pause(); }} />}
        {mediaType === "video" && durationSec ? <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted"><label>Start, seconds<input type="number" min={0} max={Math.max(0, durationSec - 1)} value={transform.trimStart ?? 0} onChange={e => { const start = Math.max(0, Math.min(durationSec - 1, Number(e.target.value))); setTransform(t => ({ ...t, trimStart: start, trimEnd: Math.min(durationSec, start + 60) })); }} className="mt-1 w-full rounded-lg border border-ink/15 p-2 text-ink" /></label><label>End, seconds<input type="number" min={(transform.trimStart ?? 0) + 1} max={Math.min(durationSec, (transform.trimStart ?? 0) + 60)} value={transform.trimEnd ?? Math.min(durationSec, 60)} onChange={e => setTransform(t => ({ ...t, trimEnd: Math.max((t.trimStart ?? 0) + 1, Math.min(durationSec, (t.trimStart ?? 0) + 60, Number(e.target.value))) }))} className="mt-1 w-full rounded-lg border border-ink/15 p-2 text-ink" /></label></div> : null}
        {mediaType === "image" ? (
          <div className="mt-3">
            {STORY_FILTER_FAMILIES.map((fam) => (
              <div key={fam.key} className="mb-2">
                <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted">{fam.label}</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {(fam.key === "classic" ? [{ id: null as string | null, label: "None", layers: [] as { color: string; opacity: number }[], css: undefined as string | undefined }, ...STORY_FILTERS.filter((f) => f.family === fam.key)] : STORY_FILTERS.filter((f) => f.family === fam.key)).map((f) => {
                    const on = filterId === f.id;
                    return (
                      <button key={f.id ?? "none"} type="button" onClick={() => setFilterId(f.id)} className="flex w-[64px] shrink-0 flex-col items-center gap-1">
                        <span className={"relative block h-[64px] w-[64px] overflow-hidden rounded-xl border-2 " + (on ? "border-pearl" : "border-transparent")}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={previewUrl ?? undefined} alt="" className="h-full w-full object-cover" style={{ filter: filterCss(f.id) }} />
                          {f.layers.map((l, i) => <span key={i} className="absolute inset-0" style={{ backgroundColor: l.color, opacity: l.opacity }} />)}
                        </span>
                        <span className={"text-[11px] " + (on ? "font-semibold text-ink" : "text-muted")}>{f.label}</span>
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

      <p className="mb-1.5 mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted">Audience</p>
      <div className="grid grid-cols-2 gap-1.5">
        {AUD.map((a) => (
          <button key={a.key} onClick={() => setAudience(a.key)}
            className={"flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-[13px] " + (audience === a.key ? "border-ink bg-black/[0.03] font-semibold text-ink" : "border-ink/10 text-secondary")}>
            {a.label}{audience === a.key ? <Check size={14} /> : null}
          </button>
        ))}
      </div>

      {audience === "only_with" ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted"><Users size={13} /> Share with</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people"
            className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/40" />
          {results.map((r) => (
            <button key={r.id} onClick={() => { setPeople(current => current.some(p => p.id === r.id) ? current : [...current, r]); setQ(""); setResults([]); }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/5">
              <span className="text-[13px] text-ink">{r.full_name} <VerifiedBadge userId={r.id} size={12} /> <span className="text-muted">@{r.username}</span></span>
              <Plus size={13} className="ml-auto text-muted" />
            </button>
          ))}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {people.map((p) => (
              <span key={p.id} className="flex items-center gap-1 rounded-full bg-black/5 px-2.5 py-1 text-[12px] text-ink">
                {p.full_name}
                <VerifiedBadge userId={p.id} size={11} />
                <button onClick={() => setPeople(current => current.filter((x) => x.id !== p.id))} aria-label="Remove"><X size={11} /></button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      </fieldset>
      {error ? <p role="alert" className="mt-3 text-[13px] text-red-700">{error}</p> : null}
      <div className="mt-5 flex gap-2">
        <button onClick={saveDraft} disabled={!uid || (!mediaUrl && mediaType !== "text") || !!busy || publicationStatus.locked}
          className="flex-1 rounded-md border border-ink/15 py-2.5 text-sm font-semibold text-secondary disabled:opacity-40">
          {busy === "draft" ? "Saving" : draftId ? "Update draft" : "Save as draft"}
        </button>
        <button onClick={publish} disabled={!uid || (!mediaUrl && mediaType !== "text") || audience === "only_with" && people.length === 0 || !!busy || publicationStatus.published}
          className="flex-1 rounded-md bg-pearl py-2.5 text-sm font-semibold text-on-pearl disabled:opacity-40">
          {busy === "publish" ? "Posting" : publicationStatus.postId || publicationStatus.uncertain ? "Retry safely" : "Share to story"}
        </button>
      </div>
    </div>
  );
}

export function StoryComposer() {
  return (
    <Suspense fallback={<p className="py-24 text-center text-sm text-muted">Opening</p>}>
      <ComposerInner />
    </Suspense>
  );
}
