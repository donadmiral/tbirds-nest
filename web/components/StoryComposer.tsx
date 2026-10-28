"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Globe2, ImagePlus, Plus, SlidersHorizontal, Type, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { SaveToMemory } from "@/components/SaveToMemory";
import { STORY_FILTERS, STORY_FILTER_FAMILIES, filterCss, type StoryTextSticker, type StoryMediaTransform } from "@/lib/stories";
import { searchPeople, type AccessPerson } from "@/lib/memoryAlbum";
import { publicationError } from "@/lib/publication";
import { checkUploadableBytes } from "@/lib/media";
import { hydrateStoryDraftMedia } from "@/lib/contentMedia";
import { StoryEditor } from "@/components/StoryEditor";
import { StoryStickerPreview } from "@/components/StoryStickerPreview";
import { AdjustOverlay, BgLayer } from "@/components/StoryEngine";
import studio from "./StoryStudio.module.css";
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
  const [transform, setTransform] = useState<StoryMediaTransform>({ scale: 1, translateNX: 0, translateNY: 0, fit: "contain" });
  const [background, setBackground] = useState({ colors: ["#0B1E3D", "#594D71"] });
  const [editorKey, setEditorKey] = useState(0);
  const [composeStep, setComposeStep] = useState<"edit" | "share">("edit");
  const [editToolsOpen, setEditToolsOpen] = useState(false);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [editTab, setEditTab] = useState<"look" | "adjust" | "frame">("look");
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
        setComposeStep("edit"); setEditToolsOpen(false); setAudienceOpen(false); setDrafts([]); setDraftId(null); setMediaUrl(null); replacePreview(null); setMediaType("image");
        setCaption(""); setAudioDraft(null); setPeople([]); setAudience("everyone"); setFilterId(null); setDurationSec(null);
        setStickers([]); setTransform({ scale: 1, translateNX: 0, translateNY: 0, fit: "contain" }); setEditorKey(k => k + 1);
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
      setStickers(p.stickers_json ?? []); setTransform(p.media_transform ?? { scale: 1, translateNX: 0, translateNY: 0, fit: "contain" });
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
    setComposeStep("edit");
    busyRef.current = true;
    setBusy("draft-load");
    setError(null);
    setPeople([]);
    setFilterId(d.filter_id ?? null);
    setStickers(d.stickers_json ?? []); setTransform(d.media_transform ?? { scale: 1, translateNX: 0, translateNY: 0, fit: "contain" });
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
      setComposeStep("edit"); setDraftId(null); setMediaUrl(null); replacePreview(null); setMediaType("image"); setCaption(""); setAudioDraft(null); setPeople([]); setAudience("everyone"); setFilterId(null); setDurationSec(null); setStickers([]); setEditorKey(k => k + 1); setTransform({ scale: 1, translateNX: 0, translateNY: 0, fit: "contain" });
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

  const hasMedia = !!mediaUrl || mediaType === "text";
  const audienceLabel = AUD.find(option => option.key === audience)?.label || "Everyone";
  const review = () => { videoPreview.current?.pause(); setComposeStep("share"); };
  const removeMedia = () => { videoPreview.current?.pause(); setMediaUrl(null); replacePreview(null); setMediaType("image"); setDraftId(null); setAudioDraft(null); setStickers([]); setTransform({ scale: 1, translateNX: 0, translateNY: 0, fit: "contain" }); setEditorKey(k => k + 1); setComposeStep("edit"); };
  const mediaStyle = { objectFit: transform.fit === "contain" ? "contain" as const : "cover" as const, transform: `translate(${(transform.translateNX || 0) * 100}%, ${(transform.translateNY || 0) * 100}%) scale(${transform.scale || 1})` };
  const mediaPreview = (reviewOnly = false) => <>
    {mediaType === "text" ? <div className="h-full w-full" style={{ background: `linear-gradient(160deg,${background.colors.join(",")})` }} /> : <>
      {transform.bg && transform.fit === "contain" ? <BgLayer bg={transform.bg} mediaUrl={mediaType === "image" ? previewUrl : null} /> : null}
      {mediaType === "video" ? <video ref={reviewOnly ? undefined : videoPreview} src={previewUrl ?? undefined} controls={!reviewOnly} playsInline muted={reviewOnly} preload="metadata" className="relative h-full w-full" style={mediaStyle} onLoadedMetadata={e => { e.currentTarget.playbackRate = transform.speed || 1; if ((transform.trimStart || 0) > 0) e.currentTarget.currentTime = transform.trimStart || 0; }} onTimeUpdate={e => { const v = e.currentTarget; if (transform.trimEnd && v.currentTime >= transform.trimEnd) { v.pause(); v.currentTime = transform.trimStart ?? 0; } }} onPlay={e => { e.currentTarget.playbackRate = transform.speed || 1; if (e.currentTarget.currentTime < (transform.trimStart ?? 0)) e.currentTarget.currentTime = transform.trimStart ?? 0; }} /> :
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl ?? undefined} alt="" className="relative h-full w-full" style={mediaStyle} />}
      {filterId ? (() => { const f = STORY_FILTERS.find(x => x.id === filterId); return f ? <div className="pointer-events-none absolute inset-0" style={{ opacity: (transform.filterAmt ?? 100) / 100, backdropFilter: filterCss(filterId), WebkitBackdropFilter: filterCss(filterId) }}>{f.layers.map((layer, i) => <div key={i} className="absolute inset-0" style={{ backgroundColor: layer.color, opacity: layer.opacity }} />)}</div> : null; })() : null}
      <AdjustOverlay adjust={transform.adjust} />
    </>}
  </>;
  const audienceControls = <>
    <div className={studio.audienceGrid}>{AUD.map(option => <button type="button" key={option.key} className={studio.button} aria-pressed={audience === option.key} onClick={() => setAudience(option.key)}>{option.label}{audience === option.key ? <Check size={16} /> : null}</button>)}</div>
    {audience === "only_with" ? <div className="mt-5">
      <label className={studio.field}><span className="flex items-center gap-2"><Users size={15} />Share with</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people" /></label>
      <div className={studio.row}>{results.map(person => <button type="button" key={person.id} onClick={() => { setPeople(current => current.some(p => p.id === person.id) ? current : [...current, person]); setQ(""); setResults([]); }} className={studio.button}>{person.full_name} <VerifiedBadge userId={person.id} size={12} />@{person.username}<Plus size={14} /></button>)}</div>
      <div className={studio.row}>{people.map(person => <span key={person.id} className={studio.button}>{person.full_name}<VerifiedBadge userId={person.id} size={11} /><button type="button" aria-label={`Remove ${person.full_name || person.username} from story audience`} className="flex h-8 w-8 items-center justify-center" onClick={() => setPeople(current => current.filter(x => x.id !== person.id))}><X size={14} /></button></span>)}</div>
    </div> : null}
  </>;
  return <div className={studio.composer}>
    <header className={studio.composerHeader}>
      {composeStep === "share" && !publicationStatus.published ? <button type="button" onClick={() => setComposeStep("edit")} className={studio.icon} aria-label="Back to story editing"><ArrowLeft size={20} /></button> : <Link href="/home" className={studio.icon} aria-label="Back to home"><ArrowLeft size={20} /></Link>}
      <h1 className={studio.composerTitle}>{publicationStatus.published ? "Story shared" : composeStep === "share" ? "Share story" : "Your story"}</h1>
      <Link href="/archive" className={studio.quietLink}>Archive</Link>
    </header>
    {publicationStatus.published && publicationStatus.postId && uid ? <section className="mx-4 space-y-4 rounded-2xl bg-[#faf6ee] p-5 text-[#0B1E3D]"><p role="status" className="text-lg font-semibold">Your moment is shared.</p><p className="text-sm text-[#69717a]">Keep it in a memory book to revisit it later.</p><SaveToMemory storyId={publicationStatus.postId} ownerId={uid} inline /><Link href="/home" className="block rounded-full bg-[#0B1E3D] px-4 py-3 text-center text-sm font-semibold text-white">Done</Link></section> : null}
    {!publicationStatus.published ? <>
      <fieldset disabled={!uid || !!busy || publicationStatus.locked} className="contents">
        {!hasMedia ? <>
          {drafts.length ? <section className="px-4"><h2 className={studio.sectionTitle}>Your drafts</h2><div className={studio.drafts}>{drafts.map(draft => <div key={draft.id} className={studio.draft}><button type="button" aria-label="Continue saved story" onClick={() => void applyDraft(draft)} className={studio.draftMedia}>{draft.preview_media_url ? draft.media_type === "video" ? <video src={draft.preview_media_url} muted playsInline preload="metadata" /> :
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.preview_media_url} alt="" /> : "Aa"}</button><button type="button" onClick={() => void deleteDraft(draft)} className={studio.draftRemove} aria-label="Delete draft"><X size={15} /></button></div>)}</div></section> : null}
          <section className={studio.capture}><span className="mb-1 flex h-20 w-20 items-center justify-center rounded-full border border-white/20 bg-white/5"><ImagePlus size={32} strokeWidth={1.3} /></span><h2 className={studio.captureTitle}>A moment worth sharing.</h2><p className={studio.captureHint}>Choose a photo or video, then make it your own.</p><button type="button" onClick={() => fileRef.current?.click()} disabled={busy === "upload"} className={studio.primary}><ImagePlus size={18} />{busy === "upload" ? "Uploading…" : "Add photo or video"}</button><button type="button" onClick={() => { setMediaType("text"); setComposeStep("edit"); }} className={studio.button}><Type size={18} />Create with text</button></section>
        </> : <>
          <div hidden={composeStep !== "edit"}><StoryEditor key={editorKey} value={stickers} onChange={setStickers} onNext={review} onOpenEdit={() => { videoPreview.current?.pause(); setEditToolsOpen(true); }} onClose={removeMedia} audience={audienceLabel} onAudience={() => setAudienceOpen(true)} thumbnail={mediaType === "text" ? "Aa" : mediaType === "video" ? <video src={previewUrl ?? undefined} playsInline muted preload="metadata" /> :
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl ?? undefined} alt="" />}>{mediaPreview()}</StoryEditor></div>
          {composeStep === "share" ? <section className={studio.share}>
            <div className={studio.sharePreview} aria-label="Story preview"><div style={{ position: "absolute", width: 390, height: 693.33, transform: "scale(0.348718)", transformOrigin: "top left" }}>{mediaPreview(true)}<div className="pointer-events-none absolute inset-0">{stickers.map(sticker => <span key={sticker.id} style={{ position: "absolute", maxWidth: "80%", left: `${sticker.nx * 100}%`, top: `${sticker.ny * 100}%`, transform: `translate(-50%, -50%) rotate(${sticker.rotation}rad) scale(${sticker.scale})` }}><StoryStickerPreview sticker={sticker} /></span>)}</div></div></div>
            <button type="button" className={`${studio.shareInfo} w-full text-left`} onClick={() => setAudienceOpen(true)}><Globe2 size={23} /><span className="flex-1"><span className="block text-xs text-[#a9adb0]">Who can see this?</span><span className="mt-1 block text-sm font-semibold">{audienceLabel}</span></span><ChevronRight size={20} /></button>
            <label className={studio.field}>Add a caption<textarea value={caption} maxLength={120} onChange={e => setCaption(e.target.value)} placeholder="A moment worth sharing…" /></label>
            <p className={studio.note}>Your story is available for 24 hours. You can keep it in a memory book after sharing.</p>
          </section> : null}
        </>}
        <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) void pickFile(file); e.target.value = ""; }} />
        {audienceOpen ? <div className={studio.overlay} onClick={e => { if (e.target === e.currentTarget) setAudienceOpen(false); }}><section role="dialog" aria-modal="true" aria-label="Story audience" className={studio.sheet}><div className={studio.handle} /><div className={studio.sheetHeader}><h2 className={studio.sheetTitle}>Who can see this?</h2><button type="button" className={studio.primary} onClick={() => setAudienceOpen(false)}>Done</button></div>{audienceControls}<p className={studio.note}>Choose the audience for this story.</p></section></div> : null}
        {editToolsOpen ? <div className={studio.overlay} onClick={e => { if (e.target === e.currentTarget) setEditToolsOpen(false); }}><section role="dialog" aria-modal="true" aria-label="Edit story media" className={studio.sheet}><div className={studio.handle} /><div className={studio.sheetHeader}><h2 className={studio.sheetTitle}>Make it yours</h2><button type="button" className={studio.primary} onClick={() => setEditToolsOpen(false)}>Done</button></div>
          {mediaType === "text" ? <><h3 className={studio.sectionTitle}>Canvas color</h3><div className={studio.row}>{[["#0B1E3D", "#594D71"], ["#4A413A", "#BBA186"], ["#50634D", "#C5CEB4"], ["#A76854", "#F3B49E"], ["#111518", "#41474F"]].map(colors => <button type="button" key={colors[0]} aria-label={`Canvas ${colors.join(" to ")}`} aria-pressed={background.colors[0] === colors[0]} onClick={() => setBackground({ colors })} className={studio.swatch} style={{ background: `linear-gradient(140deg,${colors.join(",")})` }} />)}</div></> : <>
            <div role="tablist" aria-label="Media tools" className={studio.tabs}>{([['look','Filters'],['adjust','Adjust'],['frame',mediaType === "video" ? 'Frame & trim' : 'Frame']] as const).map(([id,label]) => <button type="button" key={id} role="tab" aria-selected={editTab === id} onClick={() => setEditTab(id)} className={studio.tab}>{label}</button>)}</div>
            {editTab === "look" ? <>{STORY_FILTER_FAMILIES.map(family => <div key={family.key}><h3 className={studio.sectionTitle}>{family.label}</h3><div className={studio.filterList}>{(family.key === "classic" ? [{ id: null as string | null, label: "Original", layers: [] as { color: string; opacity: number }[] }, ...STORY_FILTERS.filter(f => f.family === family.key)] : STORY_FILTERS.filter(f => f.family === family.key)).map(filter => <button type="button" key={filter.id ?? "none"} onClick={() => setFilterId(filter.id)} aria-pressed={filterId === filter.id} className={studio.filter}><span className={studio.filterImage}>{mediaType === "video" ? <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#d7c8b0] to-[#50634D]" style={{ filter: filterCss(filter.id) }}><SlidersHorizontal size={20} /></span> :
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl ?? undefined} alt="" style={{ filter: filterCss(filter.id) }} />}{filter.layers.map((layer, i) => <span key={i} className="absolute inset-0" style={{ backgroundColor: layer.color, opacity: layer.opacity }} />)}</span>{filter.label}</button>)}</div></div>)}{filterId ? <label className={studio.field}>Intensity<input aria-label="Filter intensity" type="range" min={0} max={100} value={transform.filterAmt ?? 100} onChange={e => setTransform(t => ({ ...t, filterAmt: Number(e.target.value) }))} /></label> : null}</> : null}
            {editTab === "adjust" ? <>{([['bri','Brightness'],['warm','Warmth'],['tint','Tint'],['sat','Saturation'],['fade','Fade'],['vig','Vignette']] as const).map(([key,label]) => <label key={key} className={studio.field}><span className="flex justify-between">{label}<span>{transform.adjust?.[key] || 0}</span></span><input aria-label={label} type="range" min={key === "fade" || key === "vig" ? 0 : -100} max={100} value={transform.adjust?.[key] || 0} onChange={e => setTransform(t => ({ ...t, adjust: { ...t.adjust, [key]: Number(e.target.value) } }))} /></label>)}<button type="button" className={studio.button} onClick={() => setTransform(t => ({ ...t, adjust: null }))}>Reset adjustments</button></> : null}
            {editTab === "frame" ? <><div className={studio.row}><button type="button" className={studio.button} aria-pressed={transform.fit === "contain"} onClick={() => setTransform(t => ({ ...t, fit: "contain" }))}>Fit full image</button><button type="button" className={studio.button} aria-pressed={transform.fit !== "contain"} onClick={() => setTransform(t => ({ ...t, fit: "cover" }))}>Fill canvas</button></div><label className={studio.field}>Zoom<input aria-label="Media zoom" type="range" min={1} max={3} step={.05} value={transform.scale} onChange={e => setTransform(t => ({ ...t, scale: Number(e.target.value) }))} /></label>{([['translateNX','Horizontal position'],['translateNY','Vertical position']] as const).map(([key,label]) => <label key={key} className={studio.field}>{label}<input aria-label={label} type="range" min={-.5} max={.5} step={.01} value={transform[key]} onChange={e => setTransform(t => ({ ...t, [key]: Number(e.target.value) }))} /></label>)}
              {mediaType === "video" && durationSec ? <><div className="grid grid-cols-2 gap-3"><label className={studio.field}>Start, seconds<input type="number" min={0} max={Math.max(0, durationSec - 1)} value={transform.trimStart ?? 0} onChange={e => { const start = Math.max(0, Math.min(durationSec - 1, Number(e.target.value))); setTransform(t => ({ ...t, trimStart: start, trimEnd: Math.min(durationSec, start + 60) })); }} /></label><label className={studio.field}>End, seconds<input type="number" min={(transform.trimStart ?? 0) + 1} max={Math.min(durationSec, (transform.trimStart ?? 0) + 60)} value={transform.trimEnd ?? Math.min(durationSec, 60)} onChange={e => setTransform(t => ({ ...t, trimEnd: Math.max((t.trimStart ?? 0) + 1, Math.min(durationSec, (t.trimStart ?? 0) + 60, Number(e.target.value))) }))} /></label></div><label className={studio.field}>Playback speed<select value={transform.speed || 1} onChange={e => setTransform(t => ({ ...t, speed: Number(e.target.value) }))}>{[.5,1,1.5,2].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label></> : null}
              <button type="button" className={studio.button} onClick={() => setTransform(t => ({ ...t, scale: 1, translateNX: 0, translateNY: 0, fit: "contain" }))}>Reset frame</button>
            </> : null}
          </>}
          {uid ? <details className="mt-5 border-t border-white/10 pt-4"><summary className="cursor-pointer py-2 text-sm text-white/75">Original audio & voiceover</summary><div className="rounded-2xl bg-[#faf8f4] p-3 text-[#0B1E3D] [color-scheme:light]"><StoryAudioEditor key={uid} owner={uid} value={audioDraft} onChange={setAudioDraft} mix={transform.mix ?? {}} onMixChange={mix => setTransform(t => ({ ...t, mix }))} isVideo={mediaType === "video"} disabled={!!busy || publicationStatus.locked} onBusyChange={active => { busyRef.current = active; setBusy(active ? "audio-upload" : null); if (active) videoPreview.current?.pause(); }} /></div></details> : null}
        </section></div> : null}
      </fieldset>
      {error ? <p role="alert" className={`${studio.error} px-5`}>{error}</p> : null}
      {busy === "upload" || busy === "draft-load" ? <p role="status" className="px-5 py-4 text-center text-sm text-[#d9c5a7]">{busy === "upload" ? "Preparing your story…" : "Opening your draft…"}</p> : null}
      {hasMedia && composeStep === "share" ? <div className={`${studio.share} ${studio.shareActions}`}>
        <button type="button" onClick={() => void publish()} disabled={!uid || audience === "only_with" && people.length === 0 || !!busy || publicationStatus.published} className={studio.primary}>{busy === "publish" ? "Sharing…" : publicationStatus.postId || publicationStatus.uncertain ? "Retry safely" : "Share story"}<ArrowRight size={18} /></button>
        <button type="button" onClick={() => void saveDraft()} disabled={!uid || !!busy || publicationStatus.locked} className={studio.button}>{busy === "draft" ? "Saving…" : draftId ? "Update draft" : "Save as draft"}</button>
      </div> : null}
    </> : null}
  </div>;
}

export function StoryComposer() {
  return <Suspense fallback={<p className="py-24 text-center text-sm text-muted">Opening story studio…</p>}><ComposerInner /></Suspense>;
}
