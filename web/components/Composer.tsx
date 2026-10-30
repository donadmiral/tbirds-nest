"use client";

import { useEffect, useRef, useState } from "react";
import { checkUploadableBytes } from "@/lib/media";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { BarChart3, Camera } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import { ImagePlus, X, Globe, Users, AtSign, BadgeCheck, Lightbulb, Tag, Image as ImageIcon, FileText, Feather, Video, ChevronLeft, ChevronRight, SlidersHorizontal, Plus, Music, ArrowRight } from "lucide-react";
import { ProductPicker, type ProductCard } from "@/components/ProductPicker";
import { createClient } from "@/lib/supabase/client";
import { VerifiedBadge, getTierColor } from "@/components/VerifiedBadge";
import { PostMediaEditor, PostDraftPreview, capturePostCover } from "./PostMediaEditor";
import compose from "./PostComposer.module.css";
import type { PostMediaEditRecipe } from "@/components/VideoPlayer";

import { PublicationAttempt, publicationError } from "@/lib/publication";


import SoundtrackPicker from "./SoundtrackPicker";
import { postLookRecipe } from "../../shared/postMediaEditing";
import type {SoundtrackSelection} from "../../shared/soundtrack";
import { MUSIC_CATALOG_ENABLED } from "../../shared/musicAvailability";
import { StoryCapture } from './StoryCapture';

type Media = { file: File; preview: string; width: number; height: number; isVideo: boolean; alt: string; tags?: MediaTagDraft[]; edit?: PostMediaEditRecipe | null; coverFile?:File|null; coverPreview?:string|null };
type MediaTagDraft = { user_id: string; nx: number; ny: number; full_name: string | null; username: string | null; avatar_url: string | null };
type PostKind = "post" | "media" | "video" | "article" | "listing" | "poll" | "innovation";

// The same row as the phone: Post, Article and Listing are kinds of thing;
// Innovation is a kind with its own tint. Photo, video and poll are tools.
const KINDS: { key: PostKind; label: string; icon: typeof ImagePlus; href?: string }[] = [
  { key: "post", label: "Post", icon: Feather },
  { key: "article", label: "Article", icon: FileText, href: "/write" },
  { key: "listing", label: "Listing", icon: Tag, href: "/market/new" },
  { key: "innovation", label: "Innovation", icon: Lightbulb },
];
const TOOLS: { key: PostKind; label: string; icon: typeof ImagePlus }[] = [
  { key: "media", label: "Photo", icon: ImageIcon },
  { key: "video", label: "Video", icon: Video },
  { key: "poll", label: "Poll", icon: BarChart3 },
];

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

export function Composer({ ownerId, onPosted, quote, onQuoteDone, initialKind }: { ownerId: string; onPosted: (postId?: string) => void; quote?: QuoteTarget | null; onQuoteDone?: () => void; initialKind?: PostKind }) {
  const [supabase] = useState(() => createClient());
  const mounted = useRef(true), authenticatedOwner = useRef<string | undefined>(ownerId), renderedOwner = useRef(ownerId), ownerGeneration = useRef(0);
  renderedOwner.current = ownerId;
  const draftKey = DRAFT_KEY + ':' + ownerId;
  const [draftLoaded, setDraftLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [pending, setPending] = useState(false);
  const [postConfirmed,setPostConfirmed]=useState(false);
  const publishing = useRef(false);
  const preparingFiles = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const publication = useRef<{ progress: PublicationAttempt; run: () => Promise<string> } | null>(null);
  const [publicationLocked, setPublicationLocked] = useState(false);
  const [publicationStatus, setPublicationStatus] = useState<{ postId: string | null; uncertain: boolean }>({ postId: null, uncertain: false });
  const [open, setOpen] = useState(false);
  const [myAvatar, setMyAvatar] = useState<string | null>(null);
  const [myName,setMyName]=useState("You");
  const [selectedMedia,setSelectedMedia]=useState(0);
  const [review,setReview]=useState(false);
  const [uploadProgress,setUploadProgress]=useState({completed:0,total:0,phase:""});
  const [text, setText] = useState("");
  const [items, setItems] = useState<Media[]>([]);
  const itemsRef = useRef(items); itemsRef.current = items;
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]["key"]>("everyone");
  const [commentPolicy, setCommentPolicy] = useState<"everyone" | "following" | "followers" | "mentioned" | "off">("everyone");
  const [sensitiveMark, setSensitiveMark] = useState(false);
  const [inno, setInno] = useState(false);
  const [innoField, setInnoField] = useState<string | null>(null);
  const [innoStage, setInnoStage] = useState<string | null>(null);
  const [articleTitle, setArticleTitle] = useState("");
  const [products, setProducts] = useState<ProductCard[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [threadTo, setThreadTo] = useState<string | null>(null);
  const [pollOn, setPollOn] = useState(false);
  // Tag people on a photo: open the tagger for one item, click where the person is, pick them.
  const [tagIdx, setTagIdx] = useState<number | null>(null);
  const [soundtrack,setSoundtrack]=useState<SoundtrackSelection|null>(null);
  const [musicOpen,setMusicOpen]=useState(false);
  const [cameraOpen,setCameraOpen]=useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [tagAt, setTagAt] = useState<{ nx: number; ny: number } | null>(null);
  const [tagQ, setTagQ] = useState("");
  const [tagHits, setTagHits] = useState<any[]>([]);
  useEffect(() => {
    if (tagAt === null) return;
    const q = tagQ.trim().replace(/^@/, "");
    let dead = false;
    const t = window.setTimeout(async () => {
      const sb = createClient();
      const base = sb.from("profiles").select("id, full_name, username, avatar_url, is_verified, verified_tier").limit(20);
      const { data } = q ? await base.or("username.ilike." + q + "%,full_name.ilike.%" + q + "%") : await base.order("last_seen", { ascending: false });
      if (!dead) setTagHits(data || []);
    }, 160);
    return () => { dead = true; window.clearTimeout(t); };
  }, [tagQ, tagAt]);
  const addTag = (p: any) => {
    if (tagIdx === null || !tagAt) return;
    setItems((prev) => prev.map((it, i) => i !== tagIdx ? it : { ...it, tags: [...(it.tags || []).filter((t) => t.user_id !== p.id), { user_id: p.id, nx: tagAt.nx, ny: tagAt.ny, full_name: p.full_name ?? null, username: p.username ?? null, avatar_url: p.avatar_url ?? null, ...(p.is_verified ? { verified_tier: p.verified_tier ?? null } : {}) } as any] }));
    setTagAt(null); setTagQ(""); setTagHits([]);
  };
  const removeTag = (i: number, uid: string) => setItems((prev) => prev.map((it, x) => x !== i ? it : { ...it, tags: (it.tags || []).filter((t) => t.user_id !== uid) }));
  // "kind" is a view over the flags that already existed, not a new source of
  // truth: picking one sets the flags, so every downstream check still works.
  const [kind, setKindState] = useState<PostKind>("post");
  const setKind = (k: PostKind) => {
    if (publicationLocked) return;
    setKindState(k);
    setPollOn(k === "poll");
    setInno(k === "innovation");
    if (k === "video") setKind("media");
    // Picking media should do the obvious thing and ask for the files. The
    // timeout lets the dialog mount first, otherwise the click lands on
    // nothing on the first open.
    if (k === "media" && items.length === 0) setTimeout(() => fileRef.current?.click(), 60);
    if (k !== "article") setArticleTitle("");
  };
  const [pollOpts, setPollOpts] = useState<string[]>(["", ""]);
  const [pollDays, setPollDays] = useState(1);
  const [postCategory, setPostCategory] = useState("");
  const [preview, setPreview] = useState<{ url: string; domain?: string; title?: string; description?: string; image_url?: string } | null>(null);
  const previewOff = useRef<string | null>(null);

  useEffect(() => {
    function onThread(e: Event) { setThreadTo((e as CustomEvent).detail?.id ?? null); }
    window.addEventListener("pc-thread-post", onThread);
    return () => window.removeEventListener("pc-thread-post", onThread);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id;
      if (next !== authenticatedOwner.current) { ownerGeneration.current++; authenticatedOwner.current = next; setOpen(false); setCameraOpen(false); }
    });
    return () => {
      mounted.current = false; ownerGeneration.current++; subscription.unsubscribe();
      itemsRef.current.forEach(item => { URL.revokeObjectURL(item.preview); if (item.coverPreview) URL.revokeObjectURL(item.coverPreview); });
    };
  }, [supabase]);
  useEffect(() => {
    let active = true;
    supabase.from("profiles").select("avatar_url,full_name,username").eq("id", ownerId).maybeSingle().then(({ data:p })=>{if(active&&mounted.current&&authenticatedOwner.current===ownerId){setMyAvatar(p?.avatar_url??null);setMyName(p?.full_name||p?.username||"You");}});
    return () => { active = false; };
  }, [supabase, ownerId]);

  useEffect(() => {
    let active = true;
    const url = (text.match(/https?:\/\/\S+/) || [])[0] ?? null;
    if (!url) { setPreview(null); return; }
    if (previewOff.current === url) { setPreview(null); return; }
    if (preview?.url === url) return;
    setPreview(null);
    const t = setTimeout(async () => {
      try {
        const { data, error: e } = await supabase.functions.invoke("link-preview", { body: { url } });
        if (active && mounted.current && authenticatedOwner.current === ownerId && previewOff.current !== url && !e && data && !data.error && data.url === url) setPreview(data);
      } catch { /* no preview, fine */ }
    }, 800);
    return () => { active = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, ownerId]);
  const [mentions, setMentions] = useState<MentionHit[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (quote) { setOpen(true); taRef.current?.focus(); }
  }, [quote]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as { text?: string };
        if (d.text) { setText(d.text); setOpen(true); }
      }
    } catch { /* fresh start */ }
    setDraftLoaded(true);
  }, [draftKey]);
  useEffect(() => {
    if (!draftLoaded || authenticatedOwner.current !== ownerId) return;
    try {
      if (text.trim()) localStorage.setItem(draftKey, JSON.stringify({ text }));
      else localStorage.removeItem(draftKey);
    } catch { /* quota */ }
  }, [text, draftLoaded, draftKey, ownerId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !cameraOpen && editIdx===null && tagIdx===null && !publishing.current) { setOpen(false); if (!publication.current) setError(null); onQuoteDone?.(); } }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onQuoteDone, editIdx, tagIdx, cameraOpen]);

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
    if (pollOn || publication.current || publishing.current || preparingFiles.current) return;
    if (!list) return;
    preparingFiles.current = true;
    setPreparing(true);
    const generation = ownerGeneration.current;
    const current = () => mounted.current && authenticatedOwner.current === ownerId && renderedOwner.current === ownerId && ownerGeneration.current === generation;
    const next = [...items];
    try {
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
      if (!current()) return;
      next.push({ file: f, preview: URL.createObjectURL(f), width, height, isVideo, alt: "", edit:{aspectRatio:4/5} });
    }
    if (!current()) return;
    setItems(next);
    setSelectedMedia(Math.max(0,items.length));setReview(false);
    setOpen(true);
    } finally { preparingFiles.current = false; if (current()) setPreparing(false); else next.slice(items.length).forEach(item=>URL.revokeObjectURL(item.preview)); }
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
    const generation = ownerGeneration.current;
    const current = () => mounted.current && !!ownerId && renderedOwner.current === ownerId && authenticatedOwner.current === ownerId && ownerGeneration.current === generation;
    if (!current()) return;
    if (publishing.current || preparingFiles.current || publication.current?.progress.uncertain || (!content && items.length === 0)) return;
    if (pollOn && pollOpts.map((x) => x.trim()).filter(Boolean).length < 2) {
      setError("Add at least two poll options before posting.");
      return;
    }
    publishing.current = true;
    setPostConfirmed(false);
    if (!publication.current) setUploadProgress({completed:0,total:items.length,phase:'Preparing your post'});
    setPending(true);
    setError(null);
    if (!publication.current) {
      const author = ownerId;
      const stablePostId = crypto.randomUUID();
      const mediaIds = items.map(() => crypto.randomUUID());
      const tagIds = items.map(item => (item.tags || []).map(() => crypto.randomUUID()));
      const pollIds = pollOpts.map(() => crypto.randomUUID());
      const pollEnds = new Date(Date.now() + pollDays * 86400000).toISOString();
      const saveRows = async (table: string, rows: any[], conflict = 'id') => {
        const { error } = await supabase.from(table).upsert(rows, { onConflict: conflict, ignoreDuplicates: true });
        return { data: rows, error };
      };
      const progress = new PublicationAttempt(async () => {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (!current() || sessionError || data.session?.user.id !== author) throw new Error("Return to the account that started this post to finish it.");
      });
      const media: { url: string; media_type: string; sort_order: number; width?: number; height?: number }[] = [];
      // Retain this exact draft and each confirmed step for a retry.
      const run = async (): Promise<string> => {
        await progress.check();
        const uid = author;

        for (let i = media.length; i < items.length; i++) {
          const p = items[i];
          setUploadProgress({completed:i,total:items.length,phase:`Uploading ${p.isVideo?"video":"photo"} ${i+1} of ${items.length}`});
          const ext = (p.file.name.split(".").pop() || (p.isVideo ? "mp4" : "jpg")).toLowerCase();
          const path = uid + "/" + stablePostId + "_" + i + "." + ext;
          const bad = await checkUploadableBytes(p.file);
          if (bad) throw new Error(bad);
          await progress.check();
          const { error: upErr } = await supabase.storage.from("post-media").upload(path, p.file, { contentType: p.file.type, upsert: false });
          await progress.check();
          if (upErr) {
            throw new Error("Upload failed on \u201C" + p.file.name + "\u201D: " + upErr.message);
          }
          const { data: pub } = supabase.storage.from("post-media").getPublicUrl(path);
          const {soundtrack:previousSoundtrack,...savedRecipe}=p.edit??{};
          const chosenSoundtrack=i===0&&soundtrack?soundtrack:previousSoundtrack;
          let recipe: PostMediaEditRecipe = {...savedRecipe,...(MUSIC_CATALOG_ENABLED&&chosenSoundtrack?{soundtrack:chosenSoundtrack}:{})};
          if(p.isVideo) {
            const cover=p.coverFile?await prepareImageCover(p.coverFile):await capturePostCover(p.preview,recipe.coverAt??recipe.trimStart??0);
            const coverPath=uid+"/"+stablePostId+"_"+i+"_cover.jpg";
            await progress.check();
            const {error:coverError}=await supabase.storage.from("post-media").upload(coverPath,cover,{contentType:"image/jpeg",upsert:false});
            await progress.check();
            if(coverError)throw new Error("The video cover could not upload. Retry this post.");
            recipe={...recipe,coverUrl:supabase.storage.from("post-media").getPublicUrl(coverPath).data.publicUrl};
          }
          media.push({ url: pub.publicUrl, media_type: p.isVideo ? "video" : "image", sort_order: i, ...(Object.keys(recipe).length ? { edit: recipe } : {}), ...(p.width ? { width: p.width } : {}), ...(p.height ? { height: p.height } : {}), ...(p.alt.trim() ? { alt_text: p.alt.trim() } : {}) });
        }

        setUploadProgress({completed:items.length,total:items.length,phase:"Publishing your post"});
        const insertData: Record<string, unknown> = {
          id: stablePostId,
          user_id: uid,
          content: content || null,
          audience,
          comment_policy: commentPolicy,
          is_exclusive: false,
          channel: inno ? "innovation" : null,
        };
        if (inno && innoField) insertData.innovation_field = innoField;
        if (inno && innoStage) insertData.innovation_stage = innoStage;
        // A title makes it an article, whether or not it is also an innovation
        // post. This used to be gated on inno, so an article written without that
        // toggle silently lost its title on save.
        if (articleTitle.trim()) {
          insertData.article_title = articleTitle.trim();
          insertData.read_minutes = Math.max(1, Math.round((content.split(/\s+/).length || 0) / 200));
        }
        if (quote) insertData.quoted_post_id = quote.id;
        if (threadTo) insertData.thread_parent_id = threadTo;
        if (postCategory) insertData.category = postCategory;
        const currentLink = (text.match(/https?:\/\/\S+/) || [])[0] ?? null;
        if (preview && preview.url === currentLink) insertData.link_url = preview.url;

        progress.postId = stablePostId;
        const [newPost] = await progress.writeIdempotent("post", () => saveRows("posts", [insertData]));
        if (!newPost) { progress.uncertain = true; throw new Error("Could not confirm the post."); }
        progress.postId = newPost.id;

        if (products.length > 0) {
          await progress.writeIdempotent("products", () => supabase.rpc("set_post_products", {
            p_post_id: newPost.id,
            p_products: products.map((c, i) => ({ ...c, sort_order: i })),
          }));
        }

        if (pollOn) {
          const labels = pollOpts.map((x) => x.trim()).filter(Boolean);
          if (labels.length >= 2) {
            await progress.writeIdempotent("poll", () => saveRows("post_polls", [{ post_id: newPost.id, ends_at: pollEnds }], "post_id"));
            await progress.writeIdempotent("poll-options", () => saveRows("post_poll_options", labels.map((label, i) => ({ id: pollIds[i], post_id: newPost.id, label, sort_order: i }))));
          }
        }
        if (media.length > 0) {
          const rows = media.map((m,i) => ({ id: mediaIds[i], post_id: newPost.id, is_sensitive: sensitiveMark, ...m }));
          const inserted = await progress.writeIdempotent("media", () => saveRows("post_media", rows));
          if (!inserted || inserted.length !== media.length) { progress.uncertain = true; throw new Error("Could not confirm every media attachment."); }
          {
            // Tagged people, anchored to the media row each tag was placed on.
            const tagRows: any[] = [];
            items.forEach((it, i) => { const row = (inserted || []).find((r: any) => r.sort_order === i); (it.tags || []).forEach((t,j) => { if (row) tagRows.push({ id: tagIds[i][j], post_id: newPost.id, media_id: row.id, user_id: t.user_id, nx: t.nx, ny: t.ny }); }); });
            if (tagRows.length) await progress.writeIdempotent("media-tags", () => saveRows("post_media_tags", tagRows));
          }
        }

        await progress.check();
        return newPost.id;
      };
      publication.current = { progress, run };
      setPublicationLocked(true);
    }
    try {
      const postId = await publication.current.run();
      if (!current()) return;
      publication.current = null;
      setPostConfirmed(true);
      setPublicationLocked(false);
      setPublicationStatus({ postId: null, uncertain: false });
      items.forEach((p) => { URL.revokeObjectURL(p.preview); if(p.coverPreview)URL.revokeObjectURL(p.coverPreview); });
      try { localStorage.removeItem(draftKey); } catch { /* fine */ }
      setText("");
      setItems([]);setSoundtrack(null);setMusicOpen(false);setSelectedMedia(0);setReview(false);
      setAudience("everyone");
      setProducts([]);
      setPickerOpen(false);
      setInno(false);
      setInnoField(null);
      setInnoStage(null);
      setArticleTitle("");
      setOpen(false);
      setThreadTo(null);
      setPreview(null);
      previewOff.current = null;
      setPollOn(false);
      setPollOpts(["", ""]);
      setPollDays(1);
      setPostCategory("");
      try { onQuoteDone?.(); } catch { /* The post is already confirmed. */ }
      try { onPosted(postId); } catch { /* Parent refresh failure must not report a failed publication. */ }
    } catch (failure) {
      if (!current()) return;
      const progress = publication.current?.progress;
      setPublicationStatus({ postId: progress?.postId ?? null, uncertain: progress?.uncertain ?? false });
      const prefix = progress?.uncertain
        ? "We could not confirm the last save. Check your profile before posting again. Your draft remains open here; keep this page open. "
        : progress?.postId
          ? "Your post is not fully confirmed. Keep this page open; retry continues this same post. "
          : "Your draft remains open here; keep this page open. ";
      setError(prefix + publicationError(failure));
    } finally {
      publishing.current = false;
      if (current()) setPending(false);
    }
  }

  // A page can open the composer already set to a kind: the ads wizard's
  // format tiles land on home with ?compose=.
  useEffect(() => {
    if (!initialKind) return;
    setOpen(true);
    setKind(initialKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKind]);

  useEffect(()=>{if(!open)return;const before=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.body.style.overflow=before;};},[open]);
  const selected=items[Math.min(selectedMedia,Math.max(0,items.length-1))];
  const moveMedia=(direction:number)=>{const from=Math.min(selectedMedia,items.length-1),to=from+direction;if(to<0||to>=items.length)return;setItems(prev=>{const next=[...prev];[next[from],next[to]]=[next[to],next[from]];return next;});setSelectedMedia(to);};
  const removeMedia=()=>{const at=Math.min(selectedMedia,items.length-1);const item=items[at];if(item){URL.revokeObjectURL(item.preview);if(item.coverPreview)URL.revokeObjectURL(item.coverPreview);}setItems(prev=>prev.filter((_,i)=>i!==at));setSelectedMedia(Math.max(0,at-1));};
  const readyToPublish=!pending&&!preparing&&!publicationStatus.uncertain&&(!!text.trim()||items.length>0);
  const publishAction=()=>{if(publicationLocked||review)return post();else{setReview(true);taRef.current?.blur();}};
  const remaining = MAX_CHARS - text.length;
  const chip = (on: boolean) => "rounded-full px-2.5 py-1 text-[12px] transition-colors duration-[140ms] " + (on ? "bg-surface-elevated font-semibold text-ink" : "bg-surface text-muted hover:text-ink");

  if (!open) {
    if(pending||publicationLocked)return <section className={compose.progress} aria-live="polite"><div className={compose.progressHeading}><span>{pending?(uploadProgress.phase||'Preparing your post'):'Your post needs attention'}</span>{uploadProgress.total>0?<span>{uploadProgress.completed}/{uploadProgress.total}</span>:null}</div><div className={compose.progressBar}><span style={{width:`${uploadProgress.total?uploadProgress.completed/uploadProgress.total*100:0}%`}}/></div><p>{pending?'Keep this feed open until your post is confirmed.':'Open your draft to review and finish the same post.'}</p><button type="button" className={compose.continue} onClick={()=>setOpen(true)}>{pending?'View upload progress':'Review post'}</button></section>;
    // The collapsed state is a card, not a text field: the prompt line opens
    // the composer, and the row under it opens it already set to a kind of
    // post, so choosing "Poll" is one click rather than two.
    const start = (k?: PostKind) => () => {
      setPostConfirmed(false);
      setOpen(true);
      if (k) setKind(k);
    };
    const action = "flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[12px] text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink sm:flex-row sm:gap-2 sm:text-[13px]";
    return (
      <div className="mb-4 rounded-2xl border border-ink/10 bg-white px-5 pb-3 pt-4">
        {postConfirmed?<div className={compose.posted} role="status"><span>Your post has been shared.</span><button type="button" aria-label="Dismiss post confirmation" onClick={()=>setPostConfirmed(false)}><X size={18}/></button></div>:null}
        <button onClick={start()} className="flex w-full items-center gap-3 text-left">
          {myAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={myAvatar} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
          ) : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy text-white"><span className="h-2 w-2 rounded-full bg-pearl" /></span>}
          <span className="text-[16px] text-muted">What&apos;s on your mind?</span>
        </button>
        <div className="mt-3 grid grid-cols-5 items-center gap-1 border-t border-ink/8 pt-2.5">
          <button onClick={start("media")} className={action}><ImageIcon size={16} className="text-pearl-muted" /> Photo</button>
          <button onClick={()=>{setPostConfirmed(false);setOpen(true);setPollOn(false);setCameraOpen(true);}} className={action} aria-label="Open post camera and lenses"><Camera size={16} className="text-pearl-muted"/>Camera</button>
          <button onClick={start("article")} className={action}><FileText size={16} className="text-pearl-muted" /> Article</button>
          <button onClick={start("poll")} className={action}><BarChart3 size={16} className="text-pearl-muted" /> Poll</button>
          <button onClick={start()} className="min-h-11 min-w-0 rounded-full bg-pearl px-2 py-1.5 text-[13px] font-bold text-on-pearl transition-opacity duration-[140ms] hover:opacity-90">Post</button>
        </div>
      </div>
    );
  }

  return (
    <div className={compose.backdrop} onClick={(e) => { if (e.target === e.currentTarget && !publishing.current) { setOpen(false); if (!publication.current) setError(null); onQuoteDone?.(); } }}>
      <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        role="dialog" aria-modal="true" aria-label={review?"Review post":"New post"} className={compose.dialog}
      >
      <header className={compose.header}><button disabled={pending} className={compose.cancel} onClick={()=>{if(review&&!publicationLocked)setReview(false);else{setOpen(false);onQuoteDone?.();}}}>{review&&!publicationLocked?"Edit":"Cancel"}</button><h2>{pending?"Sharing your moment":review?"Review post":"New post"}</h2><button className={compose.primary} onClick={publishAction} disabled={!readyToPublish}>{pending?"Posting…":publicationLocked?"Retry":review?"Post":"Review"}</button></header>
      {pending?<section aria-live="polite" className={compose.progress}><div className={compose.progressHeading}><span>{uploadProgress.phase||"Preparing your post"}</span>{uploadProgress.total>0?<span>{uploadProgress.completed}/{uploadProgress.total}</span>:null}</div><div className={compose.progressBar}><span style={{width:`${uploadProgress.total?uploadProgress.completed/uploadProgress.total*100:0}%`}}/></div><div className={compose.uploadFiles}>{items.map((item,index)=><div className={compose.uploadFile} key={item.preview}>{item.isVideo&&!item.coverPreview?<span className={compose.uploadThumb}>▶</span>:<img className={compose.uploadThumb} src={item.coverPreview||item.preview} alt=""/>}<span>{item.file.name||`${item.isVideo?'Video':'Photo'} ${index+1}`}</span><strong>{index<uploadProgress.completed?'Uploaded':index===uploadProgress.completed?'Uploading':'Waiting'}</strong></div>)}</div><p>Keep this feed open until your post is confirmed.</p><button type="button" className={compose.continue} onClick={()=>setOpen(false)}>Continue browsing this feed <ArrowRight size={17}/></button></section>:null}
      {review&&!pending?<p className={compose.reviewHint}>Ready to share with {AUDIENCES.find(a=>a.key===audience)?.label.toLowerCase()}? Check your photos, caption and settings, then select Post.</p>:null}
      <fieldset disabled={publicationLocked} className="contents">
      {/* What am I making? The kinds used to be icon-only toggles in the footer,
          so nothing named them and nothing showed which one was active. Naming
          them here means the answer is visible before you start typing, and
          switching kind is one click rather than hunting a tooltip. */}
      {!review && !quote && !threadTo ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-ink/8 pb-3">
          {KINDS.map((k) => {
            const on = k.key === kind || (k.key === "post" && (kind === "media" || kind === "video" || kind === "poll"));
            const gold = k.key === "innovation";
            const cls = "flex h-[34px] items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-semibold transition-colors duration-[140ms] " +
              (gold
                ? (on ? "border-pearl bg-pearl text-on-pearl" : "border-pearl bg-pearl/15 text-accent hover:bg-pearl/20")
                : (on ? "border-navy bg-navy text-white" : "border-ink/10 bg-surface text-ink/70 hover:text-ink"));
            if (k.href) return <a key={k.key} href={k.href} className={cls}><k.icon size={14} />{k.label}</a>;
            return (
              <button key={k.key} onClick={() => setKind(k.key)} className={cls}>
                <k.icon size={14} />
                {k.label}
              </button>
            );
          })}
          <span className="mx-1 h-5 w-px bg-ink/10" aria-hidden />
          {TOOLS.map((t) => (
            <button key={t.key} onClick={() => setKind(t.key)} title={t.label} aria-label={t.label}
              className={"flex h-9 w-9 items-center justify-center rounded-xl border transition-colors duration-[140ms] " + (kind === t.key ? "border-[#BFDBFE] bg-[#EFF6FF] text-ink" : "border-ink/10 bg-surface text-muted hover:text-ink")}>
              <t.icon size={17} />
            </button>
          ))}
          <Link
            href="/market/new"
            className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-muted transition-colors duration-[140ms] hover:bg-surface hover:text-ink"
          >
            <Tag size={14} /> Sell an item
          </Link>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {quote ? (
        <div className="mb-3 rounded-lg border border-ink/10 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted">Quoting {quote.author}</p>
          <p className="mt-0.5 line-clamp-2 text-[13px] text-ink/70">{quote.text}</p>
        </div>
      ) : null}
      <div className={compose.author}>{myAvatar?<img src={myAvatar} alt=""/>:<span className={compose.avatar}/>}<div><div className={compose.authorName}>{myName}</div><div className={compose.audience}><Globe size={12}/><select aria-label="Post audience" value={audience} onChange={e=>setAudience(e.target.value as typeof audience)}>{AUDIENCES.map(a=><option key={a.key} value={a.key}>{a.label}</option>)}</select></div></div></div>
      {kind==="article"||inno?<input value={articleTitle} onChange={e=>setArticleTitle(e.target.value)} placeholder="Article title (optional)" className="mb-2 w-full rounded-xl bg-surface px-3 py-3 text-base font-semibold text-ink outline-none"/>:null}
      <textarea ref={taRef} readOnly={review} value={text} onChange={e=>onTextChange(e.target.value)} onPaste={onPaste} placeholder={inno?"Share your innovation":"Write a caption…"} rows={3} autoFocus className={compose.caption}/>
      {mentions.length > 0 ? (
        <div className="absolute z-20 w-64 overflow-hidden rounded-lg border border-ink/10 bg-navy shadow-2xl">
          {mentions.map((u) => (
            <button key={u.id} onClick={() => pickMention(u)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-[140ms] hover:bg-surface-elevated">
              {u.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayImageUrl(u.avatar_url, 100) ?? u.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-xs font-semibold text-porcelain">{(u.full_name ?? "?").charAt(0)}</span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-ink">{u.full_name}</span>
                <span className="block truncate text-[12px] text-muted">@{u.username}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {dragOver ? <p className="ml-14 text-[12px] text-accent">Drop photos or videos to attach</p> : null}
      {inno ? (
        <div className="ml-14 mt-2 flex flex-wrap items-center gap-1.5">
          {INNO_FIELDS.map((f) => (
            <button key={f} onClick={() => setInnoField(innoField === f ? null : f)} className={chip(innoField === f)}>{f}</button>
          ))}
          <span className="mx-1 text-muted">|</span>
          {INNO_STAGES.map((g) => (
            <button key={g} onClick={() => setInnoStage(innoStage === g ? null : g)} className={chip(innoStage === g)}>{g}</button>
          ))}
        </div>
      ) : null}
      {selected?<section className={compose.media}><PostDraftPreview key={selected.preview+JSON.stringify(selected.edit)} item={selected} soundtrack={soundtrack} active={!cameraOpen&&!musicOpen&&editIdx===null}/><span className={compose.mediaCount}>{Math.min(selectedMedia+1,items.length)} / {items.length}</span>{!review?<><div className={compose.mediaActions}><button onClick={()=>setEditIdx(Math.min(selectedMedia,items.length-1))}><SlidersHorizontal size={16}/>Edit {selected.isVideo?'video':'photo'}</button>{!selected.isVideo?<button onClick={()=>setTagIdx(Math.min(selectedMedia,items.length-1))}><Users size={16}/>Tag people</button>:null}<button aria-label="Move media earlier" disabled={selectedMedia===0} onClick={()=>moveMedia(-1)}><ChevronLeft size={17}/></button><button aria-label="Move media later" disabled={selectedMedia>=items.length-1} onClick={()=>moveMedia(1)}><ChevronRight size={17}/></button><button aria-label="Remove selected media" onClick={removeMedia}><X size={17}/></button></div></>:null}<div className={compose.thumbs} style={{marginTop:review?12:0}}>{items.map((item,i)=><button key={item.preview} className={compose.thumb} aria-label={`Select media ${i+1}`} aria-pressed={selectedMedia===i} onClick={()=>setSelectedMedia(i)}>{item.isVideo?(item.coverPreview?<img src={item.coverPreview} alt=""/>:<video src={item.preview+'#t=0.1'} muted preload="metadata"/>):<img src={item.preview} alt=""/>}<span className={compose.number}>{i+1}</span></button>)}{!review&&items.length<MAX_MEDIA?<button className={compose.add} aria-label="Add more media" onClick={()=>fileRef.current?.click()}><Plus size={23}/></button>:null}</div></section>:null}
      {items.length?<button type="button" className={compose.soundtrack} onClick={()=>setMusicOpen(true)}><Music size={18}/><span>Music</span><span>{soundtrack?`${soundtrack.durationSec.toFixed(1)}s excerpt`:'Add a soundtrack'}</span><ChevronRight size={17}/></button>:null}
      {editIdx!==null&&items[editIdx]?<PostMediaEditor key={items[editIdx].preview} item={items[editIdx]} index={editIdx} total={items.length} onClose={()=>setEditIdx(null)} onSave={(edit,coverFile,coverPreview,applyAll)=>{setItems(prev=>prev.map((item,i)=>i===editIdx?{...item,edit,coverFile,coverPreview}:applyAll?{...item,edit:{...item.edit,...postLookRecipe(edit)}}:item));setEditIdx(null);}}/>:null}
      {tagIdx !== null && items[tagIdx] ? (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4" onClick={() => { setTagIdx(null); setTagAt(null); }}>
          <div className="relative max-h-[92vh] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={items[tagIdx].preview} alt="" className="max-h-[80vh] max-w-[92vw] select-none rounded-xl object-contain" draggable={false}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTagAt({ nx: Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width)), ny: Math.max(0.02, Math.min(0.98, (e.clientY - r.top) / r.height)) }); }} />
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-[12.5px] font-bold text-white">{tagAt ? "Who is this?" : "Click where the person is"}</div>
            {(items[tagIdx].tags || []).map((t) => (
              <span key={t.user_id} className="absolute" style={{ left: "calc(" + t.nx * 100 + "% - 5px)", top: "calc(" + t.ny * 100 + "% - 5px)" }}>
                <span className="block h-2.5 w-2.5 rounded-full border-2 border-white bg-[#C9BFB0]" />
                <span className="absolute left-[-6px] top-3.5 flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#0B1E3D]/90 py-0.5 pl-2 pr-1 text-[12px] font-bold text-white">{t.full_name || t.username}{(t as any).verified_tier ? <VerifiedBadge tier={(t as any).verified_tier} size={12} /> : null}
                  <button type="button" onClick={() => removeTag(tagIdx, t.user_id)} className="rounded-full p-0.5 hover:bg-white/20"><X size={12} /></button>
                </span>
              </span>
            ))}
            {tagAt ? (
              <div className="absolute inset-x-0 bottom-0 max-h-[55%] overflow-auto rounded-b-xl bg-white p-3 shadow-2xl">
                <input autoFocus value={tagQ} onChange={(e) => setTagQ(e.target.value)} placeholder="Search by name or handle" className="w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] outline-none focus:border-ink/40" />
                <div className="mt-1">
                  {tagHits.map((p) => (
                    <button key={p.id} type="button" onClick={() => addTag(p)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-ink/5">
                      {p.avatar_url ? <img src={p.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" /> : <span className="h-8 w-8 rounded-full bg-ink/10" />}
                      <span className="min-w-0"><span className="flex items-center gap-1 text-[14px] font-bold text-ink"><span className="truncate" style={p.is_verified && getTierColor(p.verified_tier) ? { color: getTierColor(p.verified_tier) as string } : undefined}>{p.full_name || p.username}</span>{p.is_verified ? <VerifiedBadge tier={p.verified_tier} size={13} /> : null}</span>{p.username ? <span className="block text-[12px] text-muted">@{p.username}</span> : null}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <button type="button" onClick={() => { setTagIdx(null); setTagAt(null); }} className="absolute -right-2 -top-2 rounded-full bg-white p-1.5 text-ink shadow"><X size={16} /></button>
          </div>
        </div>
      ) : null}
      {items.filter((m) => !m.isVideo).length > 0 ? (
        <details className={compose.alt}><summary>Accessibility · image descriptions</summary><div className="mt-3 flex flex-col gap-2">
          {items.map((m, i) => m.isVideo ? null : (
            <span key={m.preview} className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.preview} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
              <input value={m.alt}
                onChange={(e) => setItems((list) => list.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))}
                placeholder="Describe this image, helps people using screen readers"
                maxLength={500}
                className="min-w-0 flex-1 rounded-md bg-surface px-3 py-1.5 text-[12px] text-ink placeholder:text-muted outline-none transition-colors duration-[140ms] focus:bg-surface-elevated"
              />
            </span>
          ))}
        </div></details>
      ) : null}
      {pollOn ? (
        <div className="ml-14 mt-3 flex flex-col gap-1.5 rounded-lg border border-ink/10 p-3">
          {pollOpts.map((o, i) => (
            <input key={i} value={o}
              onChange={(e) => setPollOpts((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder={"Option " + (i + 1) + (i > 1 ? ", optional" : "")}
              maxLength={60}
              className="w-full rounded-md bg-surface px-3 py-2 text-[13.5px] text-ink placeholder:text-muted outline-none transition-colors duration-[140ms] focus:bg-surface-elevated"
            />
          ))}
          <span className="flex items-center gap-2 pt-1">
            {pollOpts.length < 4 ? (
              <button onClick={() => setPollOpts((l) => [...l, ""])} className="text-[12px] font-semibold text-pearl-muted hover:underline">Add option</button>
            ) : null}
            <select value={pollDays} onChange={(e) => setPollDays(Number(e.target.value))} className="ml-auto rounded-md bg-surface px-2 py-1 text-[12px] text-ink outline-none">
              <option value={1} className="bg-navy">1 day</option>
              <option value={3} className="bg-navy">3 days</option>
              <option value={7} className="bg-navy">7 days</option>
            </select>
            <button onClick={() => { setPollOn(false); setPollOpts(["", ""]); }} className="text-[12px] text-muted hover:underline">Remove poll</button>
          </span>
        </div>
      ) : null}
      {threadTo ? (
        <p className="ml-14 mt-3 flex items-center gap-2 rounded-md bg-surface px-3 py-2 text-[12px] text-ink/70">
          Adding to your thread
          <button onClick={() => setThreadTo(null)} className="ml-auto text-accent hover:underline">Cancel</button>
        </p>
      ) : null}
      {preview ? (
        <span className="ml-14 mt-3 flex items-center gap-3 overflow-hidden rounded-lg border border-ink/10 p-2.5">
          {preview.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.image_url} alt="" className="h-12 w-12 shrink-0 rounded-md bg-surface object-cover" />
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-muted">{preview.domain ?? ""}</span>
            <span className="line-clamp-2 block text-[13px] font-semibold text-ink">{preview.title ?? preview.url}</span>
          </span>
          <button onClick={() => { previewOff.current = preview.url; setPreview(null); }} title="Remove preview" className="shrink-0 rounded-full p-1 text-muted transition-colors duration-[140ms] hover:bg-surface hover:text-ink"><X size={14} /></button>
        </span>
      ) : null}
      {pickerOpen ? <div className="ml-14 mt-3"><ProductPicker selected={products} onChange={setProducts} onClose={() => setPickerOpen(false)} /></div> : null}
      {!pickerOpen && products.length > 0 ? (
        <div className="ml-14 mt-3 flex flex-wrap gap-1.5">
          {products.map((c) => (
            <span key={c.id} className="flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[11px] text-ink/80">
              <Tag size={10} className="text-accent" /> {c.title}
              <button onClick={() => setProducts(products.filter((x) => x.id !== c.id))} className="text-muted hover:text-ink"><X size={11} /></button>
            </span>
          ))}
        </div>
      ) : null}
      {error && publicationLocked && !publicationStatus.postId ? <button type="button" onClick={() => { publication.current=null; setPublicationLocked(false); setError(null); }} className="ml-14 mt-2 text-sm underline">Edit draft</button> : null}
      {error ? <p role="alert" className="ml-14 mt-3 text-[13px] text-danger">{error}{publicationStatus.postId ? <> <Link target="_blank" rel="noopener noreferrer" href={"/post/" + publicationStatus.postId} className="underline">View post</Link></> : null}</p> : null}
      </div>
      {!review?<div className={compose.tools}><button className={compose.tool} onClick={()=>fileRef.current?.click()} disabled={items.length>=MAX_MEDIA}><ImagePlus size={19}/>Media</button><button type="button" className={compose.tool} aria-label="Open post camera and lenses" disabled={items.length>=MAX_MEDIA||preparing} onClick={()=>{setPollOn(false);setCameraOpen(true);}}><Camera size={19}/>Camera</button><button className={compose.tool} disabled={!items.length} onClick={()=>setMusicOpen(true)}><Music size={19}/>Music</button><button className={compose.tool} onClick={()=>setPickerOpen(v=>!v)}><Tag size={18}/>Products{products.length?` · ${products.length}`:''}</button><button className={compose.tool} disabled={items.length>0} onClick={()=>setPollOn(v=>!v)}><BarChart3 size={18}/>{pollOn?'Remove poll':'Poll'}</button><input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={e=>{void addFiles(e.target.files);e.target.value='';}}/></div>:null}
      </fieldset>
      {cameraOpen?<StoryCapture purpose="post" onCapture={async file=>{await addFiles([file]);}} onClose={()=>setCameraOpen(false)} onGallery={()=>{setCameraOpen(false);fileRef.current?.click();}}/>:null}
      {musicOpen?<SoundtrackPicker value={soundtrack} use="post" ownerId={ownerId} originalAudio={selected?.isVideo} onChange={setSoundtrack} onClose={()=>setMusicOpen(false)} renderPreview={(selection,active)=>selected?<PostDraftPreview item={selected} soundtrack={selection} active={active} autoPlay/>:null}/>:null}
      <div className={compose.settings}>
        <select disabled={publicationLocked||review} value={postCategory} onChange={(e) => setPostCategory(e.target.value)} title="Category" className="max-w-[120px] rounded-full bg-surface px-3 py-1.5 text-[12.5px] text-ink/80 outline-none">
          <option value="" className="bg-navy">Category</option>
          {CATEGORIES.filter((c) => c.key !== "innovation").map((c) => (
            <option key={c.key} value={c.key} className="bg-navy">{c.label}</option>
          ))}
        </select>
        <select disabled={publicationLocked||review} value={audience}
          onChange={(e) => setAudience(e.target.value as typeof audience)}
          className="rounded-full bg-surface px-3 py-1.5 text-[12.5px] text-ink/80 outline-none"
        >
          {AUDIENCES.map((a) => (
            <option key={a.key} value={a.key} className="bg-navy">{a.label}</option>
          ))}
        </select>
        <select disabled={publicationLocked||review} value={commentPolicy} onChange={(e) => setCommentPolicy(e.target.value as typeof commentPolicy)} title="Who can comment" className="rounded-full bg-surface px-3 py-1.5 text-[12.5px] text-ink/80 outline-none">
          <option value="everyone" className="bg-navy">Comments: everyone</option>
          <option value="following" className="bg-navy">Comments: people I follow</option>
          <option value="followers" className="bg-navy">Comments: my followers</option>
          <option value="mentioned" className="bg-navy">Comments: mentioned only</option>
          <option value="off" className="bg-navy">Comments off</option>
        </select><span className="ml-auto text-[11px] text-muted">{items.length?`${items.length} of ${MAX_MEDIA} files`:''}{remaining<=200?` · ${remaining} characters left`:''}</span>
      </div>
      </div>
    </div>
  );
}

async function prepareImageCover(file:File):Promise<Blob> {
  const bad=await checkUploadableBytes(file);if(bad)throw new Error(bad);
  const image=await createImageBitmap(file);try{const scale=Math.min(1,1200/image.width);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const ctx=canvas.getContext('2d');if(!ctx)throw new Error("The cover could not be prepared.");ctx.drawImage(image,0,0,canvas.width,canvas.height);return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("The cover could not be prepared.")),"image/jpeg",.9));}finally{image.close();}
}
