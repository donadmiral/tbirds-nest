"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Camera, Check, ChevronRight, Cloud, Contrast, Droplets, Globe2, ImagePlus, Palette, Plus, Scan, SlidersHorizontal, Sun, Thermometer, Type, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { SaveToMemory } from "@/components/SaveToMemory";
import { STORY_FILTERS, STORY_FILTER_FAMILIES, filterCss, type StoryTextSticker, type StoryMediaTransform } from "@/lib/stories";
import { searchPeople, type AccessPerson } from "@/lib/memoryAlbum";
import { publicationError } from "@/lib/publication";
import { checkUploadableBytes } from "@/lib/media";
import { hydrateStoryDraftMedia } from "@/lib/contentMedia";
import { canonicalContentMedia } from "../../shared/contentMedia";
import { loadPostStorySticker } from "@/lib/storyPostShare";
import { StoryTiming } from "@/components/StoryTiming";
import { StoryCapture } from "@/components/StoryCapture";
import { publishStoryClipQueue, readStoryClipQueue, type StoryClipQueue } from "@/lib/storyClipQueue";
import { StoryEditor } from "@/components/StoryEditor";
import { StoryDrawStudio } from "@/components/StoryDrawStudio";
import { storyDrawing, replaceStoryDrawing, type StoryDrawStroke } from "@/lib/storyDrawing";
import { StoryStickerPreview } from "@/components/StoryStickerPreview";
import { AdjustOverlay, BgLayer, DrawSvg } from "@/components/StoryEngine";
import studio from "./StoryStudio.module.css";
import { StoryAudioEditor } from "@/components/StoryAudioEditor";
import { MUSIC_CATALOG_ENABLED } from "../../shared/musicAvailability";
import type { StoryAudioDraft } from "@/lib/storyAudio";

type Draft = {
  id: string; user_id: string; media_url: string | null; media_type: string; caption: string | null;
  audience: string; shared_with: string[]; duration_sec: number | null; created_at: string;
  preview_media_url?: string | null;
  preview_stickers?: StoryTextSticker[];
  audio_draft?: StoryAudioDraft | null; allow_replies?: boolean;
  filter_id?: string | null; stickers_json?: StoryTextSticker[]; media_transform?: StoryMediaTransform | null; text_background?: { colors: string[] } | null;
};

type Clip = {
  id: string; mediaUrl: string | null; previewUrl: string | null; mediaType: "image" | "video" | "text";
  durationSec: number | null; caption: string; stickers: StoryTextSticker[]; transform: StoryMediaTransform;
  background: { colors: string[] }; filterId: string | null; audioDraft: StoryAudioDraft | null; draftId: string | null;
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
  const localPreviews = useRef(new Set<string>());
  const [clips, setClips] = useState<Clip[]>([]);
  const [activeClipId, setActiveClipId] = useState("primary");
  const activeClip = useRef({ id: activeClipId, mediaUrl }); activeClip.current = { id: activeClipId, mediaUrl };
  const clipQueue = useRef<StoryClipQueue | null>(null);
  const [sharedIds, setSharedIds] = useState<string[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [timingOpen, setTimingOpen] = useState(false);
  const [drawSession, setDrawSession] = useState<{ owner: string; version: number; clipId: string; mediaUrl: string | null; strokes: StoryDrawStroke[] } | null>(null);
  const [clock, setClock] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const draftSaveIds = useRef(new Map<string, string>());
  const [allowReplies, setAllowReplies] = useState(true);
  const [failedUploads, setFailedUploads] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState({ index: 0, total: 0 });
  const replacePreview = (url: string | null) => {
    if (url?.startsWith("blob:")) localPreviews.current.add(url);
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
  const [adjustKey, setAdjustKey] = useState<'bri' | 'con' | 'warm' | 'tint' | 'sat' | 'fade' | 'vig'>('bri');
  const [compareOriginal, setCompareOriginal] = useState(false);
  const editSnapshot = useRef<{ transform: StoryMediaTransform; filterId: string | null } | null>(null);
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
  const appliedRoutePost = useRef<string | null>(null);
  const [postLoadRetry, setPostLoadRetry] = useState(0);
  const [postLoadFailed, setPostLoadFailed] = useState(false);

  const snapshotClip = (): Clip => ({ id: activeClipId, mediaUrl, previewUrl, mediaType, durationSec, caption, stickers, transform, background, filterId, audioDraft, draftId });
  const currentClips = (): Clip[] => {
    const current = snapshotClip();
    if (!mediaUrl && mediaType !== "text") return clips;
    return clips.some(clip => clip.id === activeClipId) ? clips.map(clip => clip.id === activeClipId ? current : clip) : [...clips, current];
  };
  const activateClip = (clip: Clip) => {
    setDrawSession(null);
    activeClip.current = { id: clip.id, mediaUrl: clip.mediaUrl };
    videoPreview.current?.pause(); setActiveClipId(clip.id); setMediaUrl(clip.mediaUrl); replacePreview(clip.previewUrl); setMediaType(clip.mediaType);
    setDurationSec(clip.durationSec); setCaption(clip.caption); setStickers(clip.stickers); setTransform(clip.transform); setBackground(clip.background);
    setFilterId(clip.filterId); setAudioDraft(MUSIC_CATALOG_ENABLED ? clip.audioDraft : null); setDraftId(clip.draftId); setClock(clip.transform.trimStart || 0); setEditorKey(k => k + 1);
  };
  const chooseClip = (id: string) => { if (busyRef.current || publication.current) return; const all = currentClips(); const next = all.find(clip => clip.id === id); if (!next) return; setClips(all); activateClip(next); };
  const removeClip = (id: string) => {
    if (busyRef.current || publication.current) return;
    const all = currentClips(), removed = all.find(clip => clip.id === id), next = all.filter(clip => clip.id !== id);
    if (removed?.previewUrl?.startsWith("blob:")) { URL.revokeObjectURL(removed.previewUrl); localPreviews.current.delete(removed.previewUrl); }
    setClips(next);
    if (id === activeClipId) { setDrawSession(null); if (next.length) activateClip(next[0]); else { setMediaUrl(null); replacePreview(null); setMediaType("image"); setStickers([]); setAudioDraft(null); setDraftId(null); setComposeStep("edit"); setActiveClipId("primary"); } }
  };
  const clipFromPayload = (id: string, payload: Record<string, unknown>): Clip => ({
    id, mediaUrl: payload.media_url as string || null, previewUrl: null, mediaType: payload.media_type as Clip['mediaType'], durationSec: payload.duration_sec as number || null,
    caption: payload.caption as string || '', stickers: payload.stickers_json as StoryTextSticker[] || [], transform: payload.media_transform as StoryMediaTransform || { scale: 1, translateNX: 0, translateNY: 0, fit: 'contain' },
    background: payload.text_background as Clip['background'] || { colors: ['#111518','#41474F'] }, filterId: payload.filter_id as string || null, audioDraft: payload.audio_draft as StoryAudioDraft || null, draftId: payload.draft_id as string || null,
  });

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
        clipQueue.current = null; draftSaveIds.current.clear(); setClips([]); setActiveClipId("primary"); setSharedIds([]); setFailedUploads([]); setCameraOpen(false); setMusicOpen(false); setTimingOpen(false); setDrawSession(null); setAllowReplies(true);
        localPreviews.current.forEach(url => URL.revokeObjectURL(url)); localPreviews.current.clear();
        publishedRef.current = false;
        appliedRouteDraft.current = null;
        appliedRoutePost.current = null; setPostLoadFailed(false);
        setComposeStep("edit"); setEditToolsOpen(false); setAudienceOpen(false); setDrafts([]); setDraftId(null); setMediaUrl(null); replacePreview(null); setMediaType("image");
        setCaption(""); setAudioDraft(null); setPeople([]); setAudience("everyone"); setFilterId(null); setDurationSec(null);
        setStickers([]); setTransform({ scale: 1, translateNX: 0, translateNY: 0, fit: "contain" }); setEditorKey(k => k + 1);
        if (previous) { try { sessionStorage.removeItem("platinum:story-publish:" + previous); sessionStorage.removeItem("platinum:story-batch:" + previous); } catch {} }
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
      localPreviews.current.forEach(url => URL.revokeObjectURL(url)); localPreviews.current.clear();
      localPreview.current = null;
    };
  }, [supabase, router]);

  useEffect(() => {
    if (!uid) return;
    const owner = uid, version = ownerVersion.current;
    let cancelled = false;
    try {
      const batchRaw = sessionStorage.getItem("platinum:story-batch:" + uid);
      const legacyRaw = sessionStorage.getItem("platinum:story-publish:" + uid);
      if (!batchRaw && !legacyRaw) return;
      const batch = batchRaw ? readStoryClipQueue(batchRaw) : (() => { const saved = JSON.parse(legacyRaw!); return readStoryClipQueue(JSON.stringify({ version: 1, clips: [{ clipId: 'primary', ...saved }] })); })();
      clipQueue.current = batch;
      const pending = batch.clips.filter(clip => !clip.storyId);
      setSharedIds(batch.clips.flatMap(clip => clip.storyId ? [clip.storyId] : []));
      if (!pending.length) { publishedRef.current = true; setPublicationStatus({ postId: batch.clips[0].storyId!, uncertain: false, locked: true, published: true }); return; }
      publication.current = batch.editable ? null : pending[0];
      const restored = pending.map(clip => clipFromPayload(clip.clipId, clip.payload));
      setClips(restored); activateClip(restored[0]);
      const first = pending[0].payload;
      setAudience(first.audience as string || 'everyone'); setAllowReplies(first.allow_replies !== false);
      setPeople(((first.shared_with || []) as string[]).map(id => ({ id, full_name: "Selected recipient", username: null, avatar_url: null })));
      setComposeStep("share"); setPublicationStatus({ postId: null, uncertain: !batch.editable, locked: !batch.editable, published: false });
      setError(batch.editable ? "Your remaining clips are ready to review. Clips already shared will not be posted again." : "A previous share needs confirmation. Retry safely to continue the same clips.");
      void runBounded(hydrateStoryDraftMedia(restored.map(clip => ({ id: clip.id, user_id: owner, media_url: clip.mediaUrl, media_type: clip.mediaType, stickers_json: clip.stickers })) as Draft[], supabase)).then(rows => {
        if (cancelled || !isCurrent(owner, version)) return;
        const previews = new Map(restored.map((clip, index) => [clip.id, { mediaUrl: clip.mediaUrl, previewUrl: rows[index]?.media_url ?? null }]));
        setClips(current => current.map(clip => { const preview = previews.get(clip.id); return preview?.mediaUrl === clip.mediaUrl ? { ...clip, previewUrl: preview.previewUrl } : clip; }));
        const selected = previews.get(activeClip.current.id);
        if (selected?.mediaUrl === activeClip.current.mediaUrl) replacePreview(selected.previewUrl);
      }).catch(() => { if (!cancelled && isCurrent(owner, version)) setError("The pending share is kept, but its previews could not load. Retry safely to confirm it."); });
    } catch { setError("The pending story could not be restored. Check your stories before starting another."); }
    return () => { cancelled = true; };
  }, [uid]);

  useEffect(() => {
    const postId = params.get('post');
    if (!uid || !postId || params.get('draft') || params.get('join') || appliedRoutePost.current === postId) return;
    if (clipQueue.current || publication.current || busyRef.current || mediaUrl || mediaType === 'text') {
      setError('Finish your current story before adding this post.');
      return;
    }
    const owner = uid, version = ownerVersion.current;
    let cancelled = false, finished = false;
    const check = () => { assertOwner(owner, version); if (cancelled) throw new Error('This post preview was cancelled.'); };
    busyRef.current = true; setBusy('post-load'); setPostLoadFailed(false); setError(null);
    void runBounded(loadPostStorySticker(supabase, postId, check)).then(sticker => {
      check();
      appliedRoutePost.current = postId;
      setMediaType('text'); setMediaUrl(null); replacePreview(null); setDurationSec(null);
      setStickers([sticker]); setBackground({ colors: ['#111518', '#41474F'] });
      setTransform({ scale: 1, translateNX: 0, translateNY: 0, fit: 'contain' });
      setFilterId(null); setAudioDraft(null); setDraftId(null); setCaption('');
      setClips([]); setActiveClipId('primary'); setComposeStep('edit'); setEditorKey(k => k + 1);
    }).catch(failure => {
      if (!cancelled && isCurrent(owner, version)) { setPostLoadFailed(true); setError(publicationError(failure)); }
    }).finally(() => {
      finished = true;
      if (!cancelled && isCurrent(owner, version)) { busyRef.current = false; setBusy(null); }
    });
    return () => { cancelled = true; if (!finished && isCurrent(owner, version)) { busyRef.current = false; setBusy(current => current === 'post-load' ? null : current); } };
  }, [uid, params, supabase, postLoadRetry]);

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
    setDrafts(rows.map((row, index) => ({ ...row, preview_media_url: previews[index]?.media_url ?? null, preview_stickers: previews[index]?.stickers_json ?? [] })));
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
    setClips([]); setActiveClipId("primary");
    busyRef.current = true;
    setBusy("draft-load");
    setError(null);
    setPeople([]);
    setFilterId(d.filter_id ?? null);
    setStickers(d.preview_stickers ?? []); setTransform(d.media_transform ?? { scale: 1, translateNX: 0, translateNY: 0, fit: "contain" });
    if (d.text_background) setBackground(d.text_background);
    setEditorKey(k => k + 1);
    setAudioDraft(MUSIC_CATALOG_ENABLED ? d.audio_draft ?? null : null); setAllowReplies(d.allow_replies !== false);
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

  async function pickFiles(files: File[]) {
    if (!uid || busyRef.current || publication.current || !isCurrent(uid, ownerVersion.current)) return;
    const owner = uid, version = ownerVersion.current, before = currentClips();
    const completedCount = clipQueue.current?.clips.filter(clip => !!clip.storyId).length || 0;
    const slots = 10 - before.length - completedCount;
    if (!files.length) return;
    if (slots < files.length) { setError(`A story can contain up to 10 clips. Choose at most ${slots} more.`); throw new Error('Too many story clips.'); }
    busyRef.current = true; setBusy("upload"); setError(null); setFailedUploads([]);
    const added: Clip[] = [], failed: File[] = [];
    let lastFailure: unknown = null;
    try {
      for (let index = 0; index < files.length; index++) {
        const f = files[index]; setUploadProgress({ index: index + 1, total: files.length });
        try {
          if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) throw new Error("Choose a photo or video.");
          const bad = await runBounded(checkUploadableBytes(f)); if (bad) throw new Error(bad);
          await checkOwner(owner, version);
          const isVideo = f.type.startsWith("video/");
          let duration: number | null = null;
          if (isVideo) {
            duration = await new Promise<number | null>(resolve => {
              const video = document.createElement("video"), url = URL.createObjectURL(f); let finished = false;
              const finish = (value: number | null) => { if (finished) return; finished = true; clearTimeout(timer); video.onloadedmetadata = null; video.onerror = null; video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); metadataCleanup.current = null; resolve(value); };
              const timer = setTimeout(() => finish(null), 7000); metadataCleanup.current = () => finish(null);
              video.preload = "metadata"; video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null); video.onerror = () => finish(null); video.src = url;
            });
            assertOwner(owner, version);
          }
          const ext = (f.name.split(".").pop() || (isVideo ? "mp4" : "jpg")).toLowerCase(), path = owner + "/" + crypto.randomUUID() + "." + ext;
          const { error: upErr } = await runBounded(supabase.storage.from("story-media").upload(path, f, { contentType: f.type, upsert: false }), 120000);
          assertOwner(owner, version); if (upErr) throw upErr;
          const { data: pub } = supabase.storage.from("story-media").getPublicUrl(path);
          const preview = URL.createObjectURL(f); localPreviews.current.add(preview);
          added.push({ id: crypto.randomUUID(), mediaUrl: pub.publicUrl, previewUrl: preview, mediaType: isVideo ? 'video' : 'image', durationSec: duration, caption: '', stickers: [], transform: { scale: 1, translateNX: 0, translateNY: 0, fit: 'contain', ...(isVideo && duration ? { trimStart: 0, trimEnd: Math.min(60, duration) } : {}) }, background: { colors: ['#111518','#41474F'] }, filterId: null, audioDraft: null, draftId: null });
        } catch (failure) { assertOwner(owner, version); failed.push(f); lastFailure = failure; }
      }
      assertOwner(owner, version);
      if (added.length) { const next = [...before, ...added]; setClips(next); activateClip(added[0]); setComposeStep('edit'); }
      setFailedUploads(failed);
      if (failed.length) { setError(`${failed.length} ${failed.length === 1 ? 'clip needs' : 'clips need'} another upload attempt. Your prepared clips are kept. ${publicationError(lastFailure)}`); if (!added.length) throw lastFailure; }
    } finally { if (isCurrent(owner, version)) { busyRef.current = false; setBusy(null); } }
  }
  async function pickFile(file: File) { await pickFiles([file]); }

  async function publish() {
    const all = currentClips();
    if (!uid || !all.length || busyRef.current || publishedRef.current || !isCurrent(uid, ownerVersion.current)) return;
    const owner = uid, version = ownerVersion.current;
    if (audience === "only_with" && people.length === 0) { setError("Choose at least one person to share with."); return; }
    const empty = all.findIndex(clip => clip.mediaType === "text" && !clip.stickers.some(s => s.text.trim() || s.kind === 'post' && s.postId));
    if (empty >= 0) { activateClip(all[empty]); setComposeStep('edit'); setError(`Add text or a sticker to clip ${empty + 1}.`); return; }
    if (!clipQueue.current || clipQueue.current.editable) {
      const confirmed = clipQueue.current?.clips.filter(clip => !!clip.storyId) || [];
      clipQueue.current = { version: 1, clips: [...confirmed, ...all.map(clip => ({ clipId: clip.id, requestId: crypto.randomUUID(), payload: {
        media_url: clip.mediaUrl, media_type: clip.mediaType, caption: clip.caption.trim() || null, audience, allow_replies: allowReplies,
        filter_id: clip.filterId, stickers_json: canonicalContentMedia(clip.stickers, process.env.NEXT_PUBLIC_SUPABASE_URL!), media_transform: clip.transform, text_background: clip.mediaType === "text" ? clip.background : null,
        duration_sec: clip.mediaType === "video" ? Math.round(Math.max(1, Math.min(60, (clip.transform.trimEnd ?? clip.durationSec ?? 10) - (clip.transform.trimStart ?? 0)))) : null,
        shared_with: people.map(p => p.id), draft_id: clip.draftId, audio_draft: MUSIC_CATALOG_ENABLED ? clip.audioDraft : null,
      } }))] };
    }
    const batch = clipQueue.current;
    publication.current = batch.clips.find(clip => !clip.storyId) || null;
    busyRef.current = true; setBusy("publish"); setError(null); setClips(all);
    setPublicationStatus({ postId: null, uncertain: false, locked: true, published: false });
    try {
      const ids = await publishStoryClipQueue(batch, {
        check: () => checkOwner(owner, version),
        persist: queue => sessionStorage.setItem("platinum:story-batch:" + owner, JSON.stringify(queue)),
        send: async attempt => {
          const { data: authenticated, error: authError } = await runBounded(supabase.auth.getUser()); assertOwner(owner, version);
          if (authError || authenticated.user?.id !== owner) throw new Error("Sign in to the account that started this story.");
          const { data, error: writeError } = await runBounded(supabase.rpc("publish_story_v2", { p_expected_user: owner, p_request_id: attempt.requestId, p_story: attempt.payload }));
          assertOwner(owner, version); if (writeError) throw writeError; if (typeof data !== 'string') throw new Error('The server did not confirm the story. Retry safely.'); return data;
        },
        confirmed: () => setSharedIds(batch.clips.flatMap(clip => clip.storyId ? [clip.storyId] : [])),
      });
      assertOwner(owner, version); sessionStorage.removeItem("platinum:story-publish:" + owner); sessionStorage.removeItem("platinum:story-batch:" + owner);
      publishedRef.current = true; setSharedIds(ids); setPublicationStatus({ postId: ids[0], uncertain: false, locked: true, published: true });
    } catch (failure) {
      if (!isCurrent(owner, version)) return;
      const code = failure && typeof failure === "object" && "code" in failure ? String(failure.code) : "";
      const rejected = /^(22|23|28|42|P0)[0-9A-Z]{3}$/.test(code), confirmed = new Set(batch.clips.filter(clip => clip.storyId).map(clip => clip.clipId));
      if (rejected) {
        batch.editable = true; publication.current = null;
        const remaining = all.filter(clip => !confirmed.has(clip.id)); setClips(remaining); if (remaining.length) activateClip(remaining[0]);
        try { sessionStorage.setItem("platinum:story-batch:" + owner, JSON.stringify(batch)); sessionStorage.removeItem("platinum:story-publish:" + owner); } catch {}
      }
      setPublicationStatus({ postId: null, uncertain: !rejected, locked: !rejected, published: false });
      setError(`${confirmed.size ? `${confirmed.size} clips are already shared. ` : ''}${rejected ? 'The remaining clips were not shared. Review them and try again. ' : 'Sharing needs confirmation. Retry safely to continue without duplicate clips. '}${publicationError(failure)}`);
    } finally { if (isCurrent(owner, version)) { busyRef.current = false; setBusy(null); } }
  }

  async function saveDraft() {
    const all = currentClips();
    if (!uid || !all.length || busyRef.current || publication.current || !isCurrent(uid, ownerVersion.current)) return;
    const owner = uid, version = ownerVersion.current;
    busyRef.current = true; setBusy("draft"); setError(null);
    const snapshots = all.map(clip => ({ ...clip }));
    let saved = false;
    try {
      for (const clip of snapshots) {
        await checkOwner(owner, version);
        const id = clip.draftId || draftSaveIds.current.get(clip.id) || crypto.randomUUID();
        draftSaveIds.current.set(clip.id, id);
        const payload = { id, user_id: owner, media_url: clip.mediaUrl, media_type: clip.mediaType, caption: clip.caption.trim() || null, audience, allow_replies: allowReplies, shared_with: people.map(p => p.id), duration_sec: clip.durationSec, ...(MUSIC_CATALOG_ENABLED ? { audio_draft: clip.audioDraft } : {}), filter_id: clip.filterId, stickers_json: canonicalContentMedia(clip.stickers, process.env.NEXT_PUBLIC_SUPABASE_URL!), media_transform: clip.transform, text_background: clip.mediaType === "text" ? clip.background : null };
        const { data, error: saveError } = await runBounded(supabase.from("story_drafts").upsert(payload, { onConflict: "id" }).select("id,user_id").single());
        assertOwner(owner, version); if (saveError || !data || data.user_id !== owner) throw saveError || new Error('Could not confirm the saved draft.');
        clip.draftId = id; if (clip.id === activeClipId) setDraftId(id);
      }
      saved = true; setClips([]); draftSaveIds.current.clear(); clipQueue.current = null; setSharedIds([]);
      try { sessionStorage.removeItem("platinum:story-batch:" + owner); sessionStorage.removeItem("platinum:story-publish:" + owner); } catch {}
      setComposeStep("edit"); setDraftId(null); setMediaUrl(null); replacePreview(null); setMediaType("image"); setCaption(""); setAudioDraft(null); setPeople([]); setAudience("everyone"); setFilterId(null); setDurationSec(null); setStickers([]); setActiveClipId('primary'); setEditorKey(k => k + 1); setTransform({ scale: 1, translateNX: 0, translateNY: 0, fit: "contain" });
      await loadDrafts(owner, version);
    } catch (failure) { if (isCurrent(owner, version)) { if (!saved) setClips(snapshots); setError((saved ? "Your drafts are saved, but the list could not refresh. " : "Your clips remain open. Retry saving to update the same drafts. ") + publicationError(failure)); } }
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
  const openDraw = () => {
    if (!uid || !hasMedia || busyRef.current || publication.current) return;
    videoPreview.current?.pause(); setPreviewPlaying(false);
    setDrawSession({ owner: uid, version: ownerVersion.current, clipId: activeClipId, mediaUrl, strokes: storyDrawing(stickers) });
  };
  const applyDrawing = (strokes: StoryDrawStroke[]) => {
    const session = drawSession;
    if (!session || !isCurrent(session.owner, session.version) || activeClip.current.id !== session.clipId || activeClip.current.mediaUrl !== session.mediaUrl || busyRef.current || publication.current) return;
    const next = replaceStoryDrawing(stickers, strokes);
    setStickers(next); setDrawSession(null);
  };
  const review = () => { videoPreview.current?.pause(); setComposeStep("share"); };
  const removeMedia = () => removeClip(activeClipId);
  const allClips = currentClips();
  const mediaStyle = { objectFit: transform.fit === "contain" ? "contain" as const : "cover" as const, transform: `translate(${(transform.translateNX || 0) * 100}%, ${(transform.translateNY || 0) * 100}%) scale(${transform.scale || 1})` };
  const mediaPreview = (reviewOnly = false) => <>
    {mediaType === "text" ? <><div className="h-full w-full" style={{ background: `linear-gradient(160deg,${background.colors.join(",")})` }} />{(() => { const photo = stickers.find(sticker => sticker.kind === 'post' && sticker.postMediaType !== 'video' && sticker.postMediaUrl)?.postMediaUrl; return photo ? <div className="pointer-events-none absolute inset-0"><img src={photo} alt="" className="h-full w-full scale-110 object-cover blur-2xl" /><div className="absolute inset-0 bg-black/50" /></div> : null; })()}</> : <>
      {transform.bg && transform.fit === "contain" ? <BgLayer bg={transform.bg} mediaUrl={mediaType === "image" ? previewUrl : null} /> : null}
      {mediaType === "video" ? <video ref={reviewOnly ? undefined : videoPreview} src={previewUrl ?? undefined} controls={false} playsInline muted={reviewOnly} preload="metadata" className="relative h-full w-full" style={mediaStyle} onLoadedMetadata={e => { const actualDuration = e.currentTarget.duration; if (!reviewOnly && !publication.current && Number.isFinite(actualDuration) && actualDuration > 0 && !durationSec) { setDurationSec(actualDuration); setTransform(t => ({ ...t, trimStart: t.trimStart ?? 0, trimEnd: t.trimEnd ?? Math.min(actualDuration, 60) })); } e.currentTarget.playbackRate = transform.speed || 1; if ((transform.trimStart || 0) > 0) e.currentTarget.currentTime = transform.trimStart || 0; }} onTimeUpdate={e => { const v = e.currentTarget; setClock(v.currentTime); if (!v.paused && transform.trimEnd && v.currentTime >= transform.trimEnd) { v.pause(); v.currentTime = transform.trimStart ?? 0; } }} onPause={() => setPreviewPlaying(false)} onPlay={e => { setPreviewPlaying(true); e.currentTarget.playbackRate = transform.speed || 1; if (e.currentTarget.currentTime < (transform.trimStart ?? 0) || transform.trimEnd && e.currentTarget.currentTime >= transform.trimEnd) e.currentTarget.currentTime = transform.trimStart ?? 0; }} /> :
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl ?? undefined} alt="" className="relative h-full w-full" style={mediaStyle} />}
      {!compareOriginal && filterId ? (() => { const f = STORY_FILTERS.find(x => x.id === filterId); return f ? <div className="pointer-events-none absolute inset-0" style={{ opacity: (transform.filterAmt ?? 100) / 100, backdropFilter: filterCss(filterId), WebkitBackdropFilter: filterCss(filterId) }}>{f.layers.map((layer, i) => <div key={i} className="absolute inset-0" style={{ backgroundColor: layer.color, opacity: layer.opacity }} />)}</div> : null; })() : null}
      <AdjustOverlay adjust={compareOriginal ? null : transform.adjust} />
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
  const togglePreview = () => { const video = videoPreview.current; if (!video) return; if (video.paused) void video.play().catch(() => setError('This preview could not play. Try again.')); else video.pause(); };
  return <div className={`${studio.composer} ${hasMedia && composeStep === 'edit' && !publicationStatus.published ? studio.editing : ''}`}>
    {cameraOpen ? <StoryCapture onClose={() => setCameraOpen(false)} onGallery={() => fileRef.current?.click()} onCapture={pickFile} /> : null}
    <header className={studio.composerHeader}>
      {composeStep === "share" && !publicationStatus.published ? <button type="button" onClick={() => setComposeStep("edit")} className={studio.icon} aria-label="Back to story editing"><ArrowLeft size={20} /></button> : <Link href="/home" className={studio.icon} aria-label="Back to home"><ArrowLeft size={20} /></Link>}
      <h1 className={studio.composerTitle}>{publicationStatus.published ? "Story shared" : composeStep === "share" ? "Share story" : "Your story"}</h1>
      <Link href="/archive" className={studio.quietLink}>Archive</Link>
    </header>
    {publicationStatus.published && publicationStatus.postId && uid ? <section className="mx-4 space-y-4 rounded-2xl bg-[#faf6ee] p-5 text-[#0B1E3D]"><p role="status" className="text-lg font-semibold">{sharedIds.length > 1 ? `${sharedIds.length} moments are shared.` : 'Your moment is shared.'}</p><p className="text-sm text-[#69717a]">Keep them in a memory book to revisit later.</p>{(sharedIds.length ? sharedIds : [publicationStatus.postId]).map((id,index) => <div key={id}>{sharedIds.length > 1 ? <p className="mb-2 text-sm font-medium">Clip {index + 1}</p> : null}<SaveToMemory storyId={id} ownerId={uid} inline /></div>)}<Link href="/home" className="block rounded-full bg-[#0B1E3D] px-4 py-3 text-center text-sm font-semibold text-white">Done</Link></section> : null}
    {!publicationStatus.published ? <>
      {busy === 'post-load' ? <p role="status" className="px-5 py-4 text-center text-sm text-white/80">Preparing this post for your story…</p> : null}
      {postLoadFailed ? <button type="button" className={studio.button} disabled={!!busy} onClick={() => setPostLoadRetry(value => value + 1)}>Retry loading post</button> : null}
      <fieldset disabled={!uid || !!busy || publicationStatus.locked} className="contents">
        {!hasMedia ? <>
          {drafts.length ? <section className="px-4"><h2 className={studio.sectionTitle}>Your drafts</h2><div className={studio.drafts}>{drafts.map(draft => <div key={draft.id} className={studio.draft}><button type="button" aria-label="Continue saved story" onClick={() => void applyDraft(draft)} className={studio.draftMedia}>{draft.preview_media_url ? draft.media_type === "video" ? <video src={draft.preview_media_url} muted playsInline preload="metadata" /> :
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.preview_media_url} alt="" /> : "Aa"}</button><button type="button" onClick={() => void deleteDraft(draft)} className={studio.draftRemove} aria-label="Delete draft"><X size={15} /></button></div>)}</div></section> : null}
          <section className={studio.capture}><span className="mb-1 flex h-20 w-20 items-center justify-center rounded-full border border-white/20 bg-white/5"><ImagePlus size={32} strokeWidth={1.3} /></span><h2 className={studio.captureTitle}>A moment worth sharing.</h2><p className={studio.captureHint}>Choose a photo or video, then make it your own.</p><button type="button" onClick={() => setCameraOpen(true)} className={studio.primary}><Camera size={20} />Open camera</button><button type="button" onClick={() => fileRef.current?.click()} disabled={busy === "upload"} className={studio.button}><ImagePlus size={18} />{busy === "upload" ? "Uploading…" : "Add photo or video"}</button><button type="button" onClick={() => { setMediaType("text"); setComposeStep("edit"); }} className={studio.button}><Type size={18} />Create with text</button></section>
        </> : <>
          <div hidden={composeStep !== "edit"}><StoryEditor key={editorKey} onOpenDraw={openDraw} onTogglePreview={mediaType === "video" ? togglePreview : undefined} previewPlaying={previewPlaying} clips={allClips.map(clip => ({ id: clip.id, selected: clip.id === activeClipId, thumbnail: clip.mediaType === "text" ? "Aa" : clip.mediaType === "video" ? <video src={clip.previewUrl ?? undefined} playsInline muted preload="metadata" /> : <img src={clip.previewUrl ?? undefined} alt="" /> }))} onSelectClip={chooseClip} onRemoveClip={removeClip} onAddClip={allClips.length + (clipQueue.current?.clips.filter(c => c.storyId).length || 0) < 10 ? () => fileRef.current?.click() : undefined} onOpenMusic={MUSIC_CATALOG_ENABLED || mediaType === "video" ? () => { videoPreview.current?.pause(); setMusicOpen(true); } : undefined} onOpenTiming={mediaType === "video" ? () => setTimingOpen(true) : undefined} duration={durationSec || 15} clock={mediaType === "video" ? clock : undefined} value={stickers} onChange={setStickers} onNext={review} onOpenEdit={() => { videoPreview.current?.pause(); editSnapshot.current = { transform, filterId }; setEditTab("adjust"); setEditToolsOpen(true); }} onClose={removeMedia} audience={audienceLabel} onAudience={() => setAudienceOpen(true)} thumbnail={mediaType === "text" ? "Aa" : mediaType === "video" ? <video src={previewUrl ?? undefined} playsInline muted preload="metadata" /> :
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl ?? undefined} alt="" />}>{mediaPreview()}</StoryEditor></div>
          {composeStep === "share" ? <section className={studio.share}>
            <div className={studio.sharePreview} aria-label="Story preview"><div data-story-stage style={{ position: "absolute", width: 390, height: 693.33, transform: "scale(0.348718)", transformOrigin: "top left" }}>{mediaPreview(true)}<DrawSvg stickers={stickers} /><div className="pointer-events-none absolute inset-0">{stickers.filter(sticker => sticker.kind !== "drawing").map(sticker => <span key={sticker.id} style={{ position: "absolute", maxWidth: "80%", left: `${sticker.nx * 100}%`, top: `${sticker.ny * 100}%`, transform: `translate(-50%, -50%) rotate(${sticker.rotation}rad) scale(${sticker.scale})` }}><StoryStickerPreview sticker={sticker} /></span>)}</div></div></div>
            <p className="mb-5 text-center text-sm text-white/80">{allClips.length} {allClips.length === 1 ? 'story clip' : 'story clips'}</p>
            {allClips.length > 1 ? <div className={`${studio.filmstrip} mb-5`}>{allClips.map((clip,index) => <button type="button" key={clip.id} className={studio.thumb} aria-current={clip.id === activeClipId} aria-label={`Review story clip ${index+1}`} onClick={() => chooseClip(clip.id)}>{clip.mediaType === 'text' ? 'Aa' : clip.mediaType === 'video' ? <video src={clip.previewUrl || undefined} playsInline muted preload="metadata" /> : <img src={clip.previewUrl || undefined} alt="" />}</button>)}</div> : null}
            <h2 className="border-t border-white/15 pt-5 text-base font-semibold">Who can see this?</h2>
            <div className={studio.shareAudience}>{[{ key: 'everyone', label: 'Everyone', icon: Globe2 }, { key: 'close_friends', label: 'Close friends', icon: Users }, { key: 'only_with', label: 'Choose people', icon: Users }].map(option => <button type="button" key={option.key} aria-pressed={audience === option.key} onClick={() => { setAudience(option.key); if (option.key === 'only_with') setAudienceOpen(true); }}><option.icon size={23} />{option.label}<span className={studio.radio} /></button>)}</div>
            <button type="button" onClick={() => setAudienceOpen(true)} className="mb-3 min-h-11 text-xs text-white/65">{audience === 'followers' ? 'Audience: Followers · ' : ''}More audience options</button>
            <label className={studio.shareToggle}>Allow replies<input type="checkbox" aria-label="Allow story replies" checked={allowReplies} onChange={e => setAllowReplies(e.target.checked)} /></label>
            <label className={studio.field}>Add a caption for this clip<textarea value={caption} maxLength={120} onChange={e => setCaption(e.target.value)} placeholder="Add a caption…" /></label>
            <p className={studio.note}>Your story is available for 24 hours. You can keep it in a memory book after sharing.</p>
          </section> : null}
        </>}
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ""; void pickFiles(files).catch(() => {}); }} />
        {audienceOpen ? <div className={studio.overlay} onClick={e => { if (e.target === e.currentTarget) setAudienceOpen(false); }}><section role="dialog" aria-modal="true" aria-label="Story audience" className={studio.sheet}><div className={studio.handle} /><div className={studio.sheetHeader}><h2 className={studio.sheetTitle}>Who can see this?</h2><button type="button" className={studio.primary} onClick={() => setAudienceOpen(false)}>Done</button></div>{audienceControls}<p className={studio.note}>Choose the audience for this story.</p></section></div> : null}
        {editToolsOpen ? <div className={`${studio.overlay} ${editTab === "adjust" ? studio.adjustOverlay : ""}`} onClick={e => { if (e.target === e.currentTarget) setEditToolsOpen(false); }}><section role="dialog" aria-modal="true" aria-label="Edit story media" className={studio.sheet}><div className={studio.handle} /><div className={`${studio.sheetHeader} ${editTab === "adjust" ? studio.adjustHeader : ""}`}><button type="button" className={studio.button} onClick={() => { if (editSnapshot.current) { setTransform(editSnapshot.current.transform); setFilterId(editSnapshot.current.filterId); } setCompareOriginal(false); setEditToolsOpen(false); }}>Cancel</button><h2 className={studio.sheetTitle}>{editTab === "adjust" ? "Adjust" : "Edit story"}</h2><button type="button" className={studio.primary} onClick={() => { setCompareOriginal(false); setEditToolsOpen(false); }}>Done</button></div>
          {mediaType === "text" ? <><h3 className={studio.sectionTitle}>Canvas color</h3><div className={studio.row}>{[["#0B1E3D", "#594D71"], ["#4A413A", "#BBA186"], ["#50634D", "#C5CEB4"], ["#A76854", "#F3B49E"], ["#111518", "#41474F"]].map(colors => <button type="button" key={colors[0]} aria-label={`Canvas ${colors.join(" to ")}`} aria-pressed={background.colors[0] === colors[0]} onClick={() => setBackground({ colors })} className={studio.swatch} style={{ background: `linear-gradient(140deg,${colors.join(",")})` }} />)}</div></> : <>
            {mediaType === 'video' ? <button type="button" className={`${studio.button} mb-4 w-full`} onClick={() => { setEditToolsOpen(false); setTimingOpen(true); }}>Timing & layers<ArrowRight size={17} /></button> : null}
            <div role="tablist" aria-label="Media tools" className={studio.tabs}>{([['look','Filters'],['adjust','Adjust'],['frame',mediaType === "video" ? 'Frame & trim' : 'Frame']] as const).map(([id,label]) => <button type="button" key={id} role="tab" aria-selected={editTab === id} onClick={() => setEditTab(id)} className={studio.tab}>{label}</button>)}</div>
            {editTab === "look" ? <>{STORY_FILTER_FAMILIES.map(family => <div key={family.key}><h3 className={studio.sectionTitle}>{family.label}</h3><div className={studio.filterList}>{(family.key === "classic" ? [{ id: null as string | null, label: "Original", layers: [] as { color: string; opacity: number }[] }, ...STORY_FILTERS.filter(f => f.family === family.key)] : STORY_FILTERS.filter(f => f.family === family.key)).map(filter => <button type="button" key={filter.id ?? "none"} onClick={() => setFilterId(filter.id)} aria-pressed={filterId === filter.id} className={studio.filter}><span className={studio.filterImage}>{mediaType === "video" ? <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#d7c8b0] to-[#50634D]" style={{ filter: filterCss(filter.id) }}><SlidersHorizontal size={20} /></span> :
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl ?? undefined} alt="" style={{ filter: filterCss(filter.id) }} />}{filter.layers.map((layer, i) => <span key={i} className="absolute inset-0" style={{ backgroundColor: layer.color, opacity: layer.opacity }} />)}</span>{filter.label}</button>)}</div></div>)}{filterId ? <label className={studio.field}>Intensity<input aria-label="Filter intensity" type="range" min={0} max={100} value={transform.filterAmt ?? 100} onChange={e => setTransform(t => ({ ...t, filterAmt: Number(e.target.value) }))} /></label> : null}</> : null}
            {editTab === "adjust" ? <><div className={studio.adjustCategories} role="tablist" aria-label="Adjustment category">{([['bri','Light',Sun],['con','Contrast',Contrast],['warm','Warmth',Thermometer],['sat','Color',Palette],['tint','Tint',Droplets],['fade','Fade',Cloud],['vig','Vignette',Scan]] as const).map(([key,label,Icon]) => <button type="button" key={key} role="tab" aria-selected={adjustKey === key} onClick={() => setAdjustKey(key)}><span><Icon size={23} /></span>{label}</button>)}</div><label className={studio.adjustSlider}><span>{transform.adjust?.[adjustKey] || 0}</span><input aria-label={`Adjust ${adjustKey}`} type="range" min={adjustKey === "fade" || adjustKey === "vig" ? 0 : -100} max={100} value={transform.adjust?.[adjustKey] || 0} onChange={e => setTransform(t => ({ ...t, adjust: { ...t.adjust, [adjustKey]: Number(e.target.value) } }))} /></label><div className={studio.compareRow}><button type="button" className={studio.button} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setCompareOriginal(true); }} onPointerUp={() => setCompareOriginal(false)} onPointerCancel={() => setCompareOriginal(false)} onBlur={() => setCompareOriginal(false)} onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setCompareOriginal(true); } }} onKeyUp={() => setCompareOriginal(false)}>Hold to compare</button><button type="button" className={studio.button} onClick={() => setTransform(t => ({ ...t, adjust: null }))}>Reset</button></div></> : null}
            {editTab === "frame" ? <><div className={studio.row}><button type="button" className={studio.button} aria-pressed={transform.fit === "contain"} onClick={() => setTransform(t => ({ ...t, fit: "contain" }))}>Fit full image</button><button type="button" className={studio.button} aria-pressed={transform.fit !== "contain"} onClick={() => setTransform(t => ({ ...t, fit: "cover" }))}>Fill canvas</button></div><label className={studio.field}>Zoom<input aria-label="Media zoom" type="range" min={1} max={3} step={.05} value={transform.scale} onChange={e => setTransform(t => ({ ...t, scale: Number(e.target.value) }))} /></label>{([['translateNX','Horizontal position'],['translateNY','Vertical position']] as const).map(([key,label]) => <label key={key} className={studio.field}>{label}<input aria-label={label} type="range" min={-.5} max={.5} step={.01} value={transform[key]} onChange={e => setTransform(t => ({ ...t, [key]: Number(e.target.value) }))} /></label>)}
              {mediaType === "video" && durationSec ? <><div className="grid grid-cols-2 gap-3"><label className={studio.field}>Start, seconds<input type="number" min={0} max={Math.max(0, durationSec - 1)} value={transform.trimStart ?? 0} onChange={e => { const start = Math.max(0, Math.min(durationSec - 1, Number(e.target.value))); setTransform(t => ({ ...t, trimStart: start, trimEnd: Math.min(durationSec, start + 60) })); }} /></label><label className={studio.field}>End, seconds<input type="number" min={(transform.trimStart ?? 0) + 1} max={Math.min(durationSec, (transform.trimStart ?? 0) + 60)} value={transform.trimEnd ?? Math.min(durationSec, 60)} onChange={e => setTransform(t => ({ ...t, trimEnd: Math.max((t.trimStart ?? 0) + 1, Math.min(durationSec, (t.trimStart ?? 0) + 60, Number(e.target.value))) }))} /></label></div><label className={studio.field}>Playback speed<select value={transform.speed || 1} onChange={e => setTransform(t => ({ ...t, speed: Number(e.target.value) }))}>{[.5,1,1.5,2].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label></> : null}
              <button type="button" className={studio.button} onClick={() => setTransform(t => ({ ...t, scale: 1, translateNX: 0, translateNY: 0, fit: "contain" }))}>Reset frame</button>
            </> : null}
          </>}

        </section></div> : null}
        {drawSession && uid === drawSession.owner && ownerVersion.current === drawSession.version && activeClipId === drawSession.clipId && mediaUrl === drawSession.mediaUrl ? <StoryDrawStudio key={drawSession.owner + ':' + drawSession.version + ':' + drawSession.clipId + ':' + (drawSession.mediaUrl || '')} scopeKey={drawSession.owner + ':' + drawSession.version + ':' + drawSession.clipId + ':' + (drawSession.mediaUrl || '')} strokes={drawSession.strokes} onApply={applyDrawing} onCancel={() => setDrawSession(null)}>
          {mediaPreview(true)}<div className="pointer-events-none absolute inset-0">{stickers.filter(sticker => sticker.kind !== 'drawing').map(sticker => <span key={sticker.id} style={{ position: 'absolute', maxWidth: '80%', left: `${sticker.nx * 100}%`, top: `${sticker.ny * 100}%`, transform: `translate(-50%, -50%) rotate(${sticker.rotation}rad) scale(${sticker.scale})` }}><StoryStickerPreview sticker={sticker} /></span>)}</div>
        </StoryDrawStudio> : null}
        {musicOpen && uid ? <div className={studio.overlay} onClick={e => { if (e.target === e.currentTarget && !busy) setMusicOpen(false); }}><section role="dialog" aria-modal="true" aria-label={MUSIC_CATALOG_ENABLED ? "Story music" : "Original video sound"} className={studio.sheet}><div className={studio.handle} /><div className={studio.sheetHeader}><button type="button" className={studio.icon} aria-label="Close sound controls" onClick={() => setMusicOpen(false)} disabled={!!busy}><X size={20} /></button><h2 className={studio.sheetTitle}>{MUSIC_CATALOG_ENABLED ? "Music" : "Video sound"}</h2></div><StoryAudioEditor key={uid + activeClipId} owner={uid} value={audioDraft} onChange={setAudioDraft} mix={transform.mix ?? {}} onMixChange={mix => setTransform(t => ({ ...t, mix }))} isVideo={mediaType === "video"} disabled={!!busy || publicationStatus.locked} onBusyChange={active => { busyRef.current = active; setBusy(active ? "audio-upload" : null); if (active) videoPreview.current?.pause(); }} /></section></div> : null}
        {timingOpen && mediaType === 'video' ? <StoryTiming url={previewUrl} duration={durationSec || 15} start={transform.trimStart || 0} end={transform.trimEnd ?? Math.min(durationSec || 15, 60)} clock={clock} playing={previewPlaying} stickers={stickers} audioTitle={MUSIC_CATALOG_ENABLED ? audioDraft?.title : undefined} onClose={() => setTimingOpen(false)} onToggle={() => { const video = videoPreview.current; if (!video) return; if (video.paused) void video.play().catch(() => {}); else video.pause(); }} onSeek={time => { const video = videoPreview.current; if (video) { video.pause(); video.currentTime = time; setClock(time); } }} onTrim={(start,end) => setTransform(t => ({ ...t, trimStart: start, trimEnd: end }))} onChange={setStickers} /> : null}
      </fieldset>
      {error ? <p role="alert" className={`${studio.error} px-5`}>{error}</p> : null}
      {busy === "upload" || busy === "draft-load" ? <p role="status" className="px-5 py-4 text-center text-sm text-[#d9c5a7]">{busy === "upload" ? `Preparing clip ${uploadProgress.index} of ${uploadProgress.total}…` : "Opening your draft…"}</p> : null}
      {failedUploads.length ? <button type="button" className={studio.button} disabled={!!busy} onClick={() => void pickFiles(failedUploads).catch(() => {})}>Retry {failedUploads.length} remaining uploads</button> : null}
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
