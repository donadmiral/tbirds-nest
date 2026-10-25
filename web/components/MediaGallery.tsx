"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, X, Maximize2, Minimize2, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { VideoPlayer, type PostMediaEditRecipe } from "@/components/VideoPlayer";
import { STORY_FILTERS, filterCss } from "@/lib/stories";
import { AdjustOverlay } from "@/components/StoryEngine";
import { VerifiedBadge, getTierColor } from "@/components/VerifiedBadge";
import { Comments } from "@/components/Comments";
import { PostMenu } from "@/components/PostMenu";
import { RichText } from "@/components/RichText";
import { displayImageUrl, srcSetFor } from "@/lib/media";
import { dataSaverEnabled } from "@/lib/mediaPrefs";
import { createClient } from "@/lib/supabase/client";
import { hydratePostMedia } from "@/lib/contentMedia";
import { orderTimeout } from "../../shared/orderRequest";
import { usePostInteractions } from "@/lib/usePostInteractions";
import { COMMENT_COUNT_UPDATED, refreshCommentCount, type CommentCountUpdate } from "@/lib/commentCounts";

type MediaItem = { id: string; url: string; media_type: string | null; width?: number | null; height?: number | null; alt_text?: string | null; is_sensitive?: boolean | null; edit?: PostMediaEditRecipe | null };

// post_media.edit recipes come from a small authorized side query when older feed rows omit them.
// Legacy media carries a placeholder id; only real media ids are ever sent to the media tables.
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function editStyle(e: PostMediaEditRecipe | null | undefined): React.CSSProperties {
  if (!e) return {};
  const sc = typeof e.scale === "number" && e.scale > 0 ? e.scale : 1; const nx = typeof e.translateNX === "number" ? e.translateNX : 0; const ny = typeof e.translateNY === "number" ? e.translateNY : 0;
  const st: React.CSSProperties = { objectFit: e.fit === "contain" ? "contain" : "cover" };
  if (sc !== 1 || nx !== 0 || ny !== 0) st.transform = "translate(" + (nx * 100) + "%, " + (ny * 100) + "%) scale(" + sc + ")";
  return st;
}

// Tagged people: a pearl people-mark with the count; tap it and the tags rise as
// navy pills anchored where each person is, each linking to the profile.
type MediaTag = { user_id: string; nx: number; ny: number; full_name: string | null; username: string | null; avatar_url: string | null; verified_tier: string | null };
function TagLayer({ tags, w, h, mode = "pins" }: { tags: MediaTag[]; w?: number; h?: number; mode?: "pins" | "list" }) {
  // Instagram's model: a round person badge on the picture; tapping it shows white pills with a pointer aimed at the
  // person, the name in its tier colour and the seal, each linking to the profile. On a video the badge opens a list.
  const [open, setOpen] = useState(false);
  if (!tags.length) return null;
  const W = w || 0, H = h || 0; const PAD = 8, PILL = 30, GAP = 6, TIP = 6;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const est = (t: MediaTag) => Math.min(Math.max(W - 2 * PAD, 60), 42 + (t.full_name || t.username || "Member").length * 7.4);
  const placed: { t: MediaTag; ax: number; ay: number; x: number; y: number; wpx: number; below: boolean }[] = [];
  if (W && H) {
    [...tags].sort((a, b) => a.ny - b.ny || a.nx - b.nx).forEach((t) => {
      const ax = clamp(t.nx * W, PAD, W - PAD); const ay = clamp(t.ny * H, PAD, H - PAD); const wpx = est(t);
      const x = clamp(ax - wpx / 2, PAD, W - PAD - wpx);
      const below = ay + TIP + 4 + PILL <= H - PAD;
      let y = below ? ay + TIP + 4 : ay - TIP - 4 - PILL;
      for (let guard = 0; guard < 12; guard++) {
        const hit = placed.find((p) => !(x + wpx < p.x || p.x + p.wpx < x) && Math.abs(y - p.y) < PILL + GAP);
        if (!hit) break; y = below ? hit.y + PILL + GAP : hit.y - PILL - GAP; if (y < PAD || y + PILL > H - PAD) break;
      }
      placed.push({ t, ax, ay, x, y, wpx, below });
    });
  }
  const name = (t: MediaTag) => {
    const tier = getTierColor(t.verified_tier);
    return (<><span className="truncate" style={tier ? { color: tier } : undefined}>{t.full_name || t.username || "Member"}</span>{t.verified_tier ? <VerifiedBadge userId={t.user_id} tier={t.verified_tier as any} size={12} /> : null}</>);
  };
  const badgeRight = placed.some((p) => p.y + PILL > H - 48 && p.x < 60) || tags.some((t) => t.ny > 0.84 && t.nx < 0.22);
  return (
    <div className="pointer-events-none absolute inset-0">
      {open && mode === "pins" && W && H ? placed.map(({ t, ax, x, y, wpx, below }) => (
        <span key={t.user_id}>
          <span className="absolute h-0 w-0 border-x-[6px] border-x-transparent" style={below ? { left: ax - TIP, top: y - TIP, borderBottom: "6px solid #fff" } : { left: ax - TIP, top: y + PILL, borderTop: "6px solid #fff" }} />
          <Link href={"/" + (t.username || "")} onClick={(e) => e.stopPropagation()} title={t.full_name || t.username || undefined}
            className="pointer-events-auto absolute flex h-[30px] items-center justify-center gap-1 rounded-lg bg-white px-2.5 text-[12.5px] font-bold text-[#0B1E3D] shadow-lg" style={{ left: x, top: y, width: wpx }}>
            {name(t)}
          </Link>
        </span>
      )) : null}
      {open && mode === "list" ? (
        <span className={"pointer-events-auto absolute bottom-12 z-10 w-56 overflow-hidden rounded-xl bg-white p-1.5 shadow-2xl " + (badgeRight ? "right-2.5" : "left-2.5")}>
          <span className="block px-2 pb-1 pt-0.5 text-[11px] font-bold uppercase tracking-wide text-[#0B1E3D]/50">In this video</span>
          {tags.map((t) => (
            <Link key={t.user_id} href={"/" + (t.username || "")} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-[#0B1E3D] hover:bg-black/[0.04]">
              {t.avatar_url ? <img src={t.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className="h-7 w-7 rounded-full bg-[#C9BFB0]" />}
              <span className="flex min-w-0 flex-1 items-center gap-1">{name(t)}</span>
            </Link>
          ))}
        </span>
      ) : null}
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} aria-label={mode === "list" ? "People in this video" : (open ? "Hide tagged people" : "Show tagged people")}
        className={"pointer-events-auto absolute bottom-2.5 flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-[140ms] " + (badgeRight ? "right-2.5 " : "left-2.5 ") + (open ? "bg-white text-[#0B1E3D]" : "bg-black/55 text-white hover:bg-black/70")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
      </button>
    </div>
  );
}

function EditPlanes({ e }: { e: PostMediaEditRecipe | null | undefined }) {
  if (!e) return null;
  const f = e.filterId ? STORY_FILTERS.find((x) => x.id === e.filterId) : null;
  const k = Math.max(0, Math.min(1, (typeof e.filterAmt === "number" ? e.filterAmt : 100) / 100));
  return (
    <>
      {f ? <div className="pointer-events-none absolute inset-0" style={{ backdropFilter: filterCss(f.id, k), WebkitBackdropFilter: filterCss(f.id, k) }}>{f.layers.map((l, i) => <div key={i} className="absolute inset-0" style={{ backgroundColor: l.color, opacity: l.opacity * k }} />)}</div> : null}
      {e.adjust ? <AdjustOverlay adjust={e.adjust} /> : null}
    </>
  );
}
type Dims = { w: number; h: number };
export type ViewerPost = {
  author_id?: string | null;
  post_id: string;
  author_name?: string | null;
  author_username?: string | null;
  author_avatar?: string | null;
  author_verified?: boolean | null;
  author_verified_tier?: string | null;
  content?: string | null;
  likes_count?: number;
  bookmarks_count?: number;
  comments_count?: number;
  reposts_count?: number;
  viewer_liked?: boolean;
  viewer_bookmarked?: boolean;
};

function fitted(w: number | null | undefined, h: number | null | undefined, availW: number, maxH: number): Dims | null {
  if (!w || !h || !availW) return null;
  const scale = Math.min(availW / w, maxH / h, 1.25);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

export function MediaGallery({ media, postId, viewsCount, post, onDoubleClick: onFeedDoubleClick }: { media: MediaItem[]; postId: string; viewsCount?: number | null; post?: ViewerPost; onDoubleClick?: (e: React.MouseEvent) => void }) {
  const [edits, setEdits] = useState<Record<string, PostMediaEditRecipe | null>>({});
  useEffect(() => {
    const need = media.filter(m => m.edit === undefined && UUID_ID.test(m.id)).map(m => m.id);
    setEdits({});
    if (!need.length) return;
    const client = createClient();
    let live = true, version = 0;
    const refresh = async () => {
      const run = ++version;
      try {
        const { data, error } = await orderTimeout(client.from("post_media").select("id, edit").eq("post_id", postId).in("id", need));
        if (error) throw error;
        const [safe] = await hydratePostMedia([{ post_id: postId, post_media: data ?? [] }], client);
        if (!live || run !== version) return;
        const next: Record<string, PostMediaEditRecipe | null> = {};
        need.forEach(id => { next[id] = null; });
        safe.post_media.forEach((row: any) => { next[row.id] = row.edit ?? null; });
        setEdits(next);
      } catch { if (live && run === version) setEdits({}); }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 240000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    const { data } = client.auth.onAuthStateChange(() => { version++; setEdits({}); queueMicrotask(() => { if (live) void refresh(); }); });
    return () => { live = false; version++; clearInterval(timer); document.removeEventListener('visibilitychange', visible); data.subscription.unsubscribe(); };
  }, [media, postId]);
  const editOf = (m: MediaItem) => (m.edit !== undefined ? m.edit : edits[m.id]) ?? null;
  const [tags, setTags] = useState<Record<string, MediaTag[]>>({});
  useEffect(() => {
    const need = media.filter(m => UUID_ID.test(m.id)).map(m => m.id);
    setTags({});
    if (!need.length) return;
    const client = createClient();
    let live = true, version = 0;
    const refresh = async () => {
      const run = ++version;
      try {
        const { data, error } = await orderTimeout(client.from("post_media_tags").select("media_id, user_id, nx, ny, profile:profiles!post_media_tags_user_id_fkey(full_name, username, avatar_url, verified_tier)").in("media_id", need));
        if (error) throw error;
        if (!live || run !== version) return;
        const next: Record<string, MediaTag[]> = {};
        need.forEach(id => { next[id] = []; });
        (data ?? []).forEach((row: any) => { const profile = row.profile || {}; (next[row.media_id] ||= []).push({ user_id: row.user_id, nx: Number(row.nx) || 0.5, ny: Number(row.ny) || 0.5, full_name: profile.full_name ?? null, username: profile.username ?? null, avatar_url: profile.avatar_url ?? null, verified_tier: profile.verified_tier ?? null }); });
        setTags(next);
      } catch { if (live && run === version) setTags({}); }
    };
    void refresh();
    const { data } = client.auth.onAuthStateChange(() => { version++; setTags({}); queueMicrotask(() => { if (live) void refresh(); }); });
    return () => { live = false; version++; data.subscription.unsubscribe(); };
  }, [media, postId]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const touchX = useRef<number | null>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const [availW, setAvailW] = useState(608);
  const [maxH, setMaxH] = useState(720);
  const [trueDims, setTrueDims] = useState<Record<string, Dims>>({});
  const [idx, setIdx] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const viewerOpen = lightbox !== null;
  const [immersive, setImmersive] = useState(false);
  // On phones and tablets the viewer has no side panel; comments open in a drawer under the picture instead.
  const [mobileComments, setMobileComments] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [reduced, setReduced] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const social = usePostInteractions(post?.post_id ?? "", { liked: !!post?.viewer_liked, bookmarked: !!post?.viewer_bookmarked,
    likesCount: post?.likes_count ?? 0, bookmarksCount: post?.bookmarks_count });
  const liked = social.liked, likeN = social.likesCount, marked = social.bookmarked;
  const [commentUpdate, setCommentUpdate] = useState<CommentCountUpdate | null>(null);
  const latestCommentUpdate = useRef<CommentCountUpdate | null>(null);
  const commentPostId = post?.post_id;
  const commentSeed = post?.comments_count;
  const commentsCount = commentUpdate?.postId === commentPostId ? commentUpdate?.count : commentSeed;
  useEffect(() => {
    if (!commentPostId) return;
    const update = (event: Event) => {
      const detail = (event as CustomEvent<CommentCountUpdate>).detail;
      if (detail?.postId !== commentPostId || !Number.isSafeInteger(detail.count) || detail.count < 0) return;
      latestCommentUpdate.current = detail;
      setCommentUpdate(detail);
    };
    window.addEventListener(COMMENT_COUNT_UPDATED, update);
    return () => window.removeEventListener(COMMENT_COUNT_UPDATED, update);
  }, [commentPostId]);
  useEffect(() => {
    if (commentPostId && latestCommentUpdate.current?.postId === commentPostId) void refreshCommentCount(createClient(), commentPostId);
  }, [commentPostId, commentSeed]);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const el = wrapRef.current;
    if (!el) return;
    setAvailW(Math.round(el.getBoundingClientRect().width) || 608);
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e && e.contentRect.width > 0) setAvailW(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    const onResize = () => setMaxH(Math.min(Math.max(280, window.innerHeight - 200), 880));
    onResize();
    window.addEventListener("resize", onResize);
    return () => { ro.disconnect(); window.removeEventListener("resize", onResize); };
  }, []);

  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);
  useEffect(() => {
    if (lightbox === null) return;
    const block = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    window.addEventListener("wheel", block, { passive: false });
    return () => window.removeEventListener("wheel", block);
  }, [lightbox]);

  useEffect(() => {
    if (!viewerOpen) return;
    const mediaRoot = wrapRef.current;
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = gap + "px";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
      // Inline media unmounts while the viewer is open. Restore its newly
      // mounted control, rather than trying to focus the disconnected opener.
      if (!mediaRoot?.isConnected) return;
      const opener = openerRef.current;
      const target = opener?.isConnected ? opener : mediaRoot.querySelector<HTMLElement>("[data-media-opener], button[aria-label='Open theater view']");
      (target ?? mediaRoot).focus({ preventScroll: true });
    };
  }, [viewerOpen]);

  useEffect(() => {
    if (!viewerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const editing = target?.closest("input, textarea, select, [contenteditable='true']");
      if (e.key === "Escape" && !document.fullscreenElement) setLightbox(null);
      else if (e.key === "ArrowRight" && !editing && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); resetZoom(); setLightbox((v) => (v === null ? v : Math.min(v + 1, media.length - 1))); }
      else if (e.key === "ArrowLeft" && !editing && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); resetZoom(); setLightbox((v) => (v === null ? v : Math.max(v - 1, 0))); }
      else if (e.key === "Tab") {
        const focusables = modalRef.current?.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]");
        if (!focusables || focusables.length === 0) return;
        const list = Array.from(focusables).filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0 && el.getClientRects().length > 0);
        if (!list.length) return;
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewerOpen, media.length, resetZoom]);

  useEffect(() => {
    // Moving to the last/first item can remove the focused arrow. Keep focus
    // inside the dialog, without resetting controls that remain mounted.
    if (viewerOpen && !modalRef.current?.contains(document.activeElement)) closeRef.current?.focus();
  }, [viewerOpen, lightbox]);

  function openViewer(next: number, opener = document.activeElement as HTMLElement | null) {
    openerRef.current = opener && wrapRef.current?.contains(opener) ? opener : null;
    resetZoom();
    setImmersive(false);
    setLightbox(next);
  }

  const measure = useCallback((id: string, w: number, h: number) => {
    if (w > 0 && h > 0) setTrueDims((r) => (r[id] && r[id].w === w && r[id].h === h ? r : { ...r, [id]: { w, h } }));
  }, []);

  if (media.length === 0) return null;
  const item = media[Math.min(idx, media.length - 1)];
  const known = trueDims[item.id] ?? (item.width && item.height ? { w: item.width, h: item.height } : null);
  const fittedDims = fitted(known?.w, known?.h, availW, maxH);
  // Video takes the whole card width and caps its height at 4:5, exactly as
  // Instagram's feed does. A tall clip is cover-cropped to that box in the
  // feed; the full frame is one click away in the viewer.
  const dims = item.media_type === "video" && availW
    ? { w: availW, h: Math.round(Math.min(known?.w && known?.h ? availW * (known.h / known.w) : availW * 1.25, availW * 1.25)) }
    : fittedDims;
  const altOf = (m: MediaItem, i: number) => m.alt_text || "Post media " + (i + 1);
  const showPanel = !!post && !immersive;

  function goTo(next: number) { resetZoom(); setLightbox(next); }
  function onTouchStart(e: React.TouchEvent) { touchX.current = e.touches[0]?.clientX ?? null; }
  function onFeedTouchEnd(e: React.TouchEvent) {
    const start = touchX.current;
    touchX.current = null;
    if (start === null || media.length < 2) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (dx < -40 && idx < media.length - 1) setIdx(idx + 1);
    else if (dx > 40 && idx > 0) setIdx(idx - 1);
  }
  function onModalTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (!pinchRef.current) { pinchRef.current = { dist, zoom }; return; }
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomAt(pinchRef.current.zoom * (dist / pinchRef.current.dist), mx, my, e.currentTarget as HTMLElement);
    } else if (e.touches.length === 1 && zoom > 1) {
      const t0 = e.touches[0];
      if (!dragRef.current) { dragRef.current = { x: t0.clientX, y: t0.clientY, px: pan.x, py: pan.y }; return; }
      setPan(clampPan({ x: dragRef.current.px + (t0.clientX - dragRef.current.x), y: dragRef.current.py + (t0.clientY - dragRef.current.y) }, zoom));
    }
  }
  function onModalTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0) dragRef.current = null;
    const start = touchX.current;
    touchX.current = null;
    if (start === null || lightbox === null || zoom > 1) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (dx < -40 && lightbox < media.length - 1) goTo(lightbox + 1);
    else if (dx > 40 && lightbox > 0) goTo(lightbox - 1);
  }
  function setZoomClamped(next: number) {
    const z = Math.min(4, Math.max(1, next));
    setZoom(z);
    if (z <= 1.01) setPan({ x: 0, y: 0 });
    else setPan((p) => clampPan(p, z));
  }
  function clampPan(p: { x: number; y: number }, z: number) {
    const pane = modalRef.current?.querySelector("[data-media-pane]") as HTMLElement | null;
    const limX = pane ? (pane.clientWidth * (z - 1)) / 2 : 400;
    const limY = pane ? (pane.clientHeight * (z - 1)) / 2 : 400;
    return { x: Math.max(-limX, Math.min(limX, p.x)), y: Math.max(-limY, Math.min(limY, p.y)) };
  }
  // Zoom anchored at the pointer: the point under the cursor stays under the
  // cursor, which is what makes it feel like leaning into the picture rather
  // than the picture growing away from you. Trackpad pinch arrives as a
  // wheel event with ctrlKey set, so it takes the same path as Ctrl+wheel.
  function zoomAt(next: number, clientX: number, clientY: number, el: HTMLElement) {
    const z = Math.max(1, Math.min(4, next));
    const r = el.getBoundingClientRect();
    const cx = clientX - (r.left + r.width / 2);
    const cy = clientY - (r.top + r.height / 2);
    const k = z / zoom;
    if (z <= 1) { resetZoom(); return; }
    setZoom(z);
    setPan(clampPan({ x: cx - (cx - pan.x) * k, y: cy - (cy - pan.y) * k }, z));
  }
  function onWheelZoom(e: React.WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const step = Math.abs(e.deltaY) < 20 ? 0.08 : 0.35;
    zoomAt(zoom * (e.deltaY < 0 ? 1 + step : 1 - step), e.clientX, e.clientY, e.currentTarget as HTMLElement);
  }
  function onDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (zoom > 1) resetZoom(); else setZoomClamped(2.2);
  }
  function onDragStart(e: React.MouseEvent) {
    if (zoom <= 1) return;
    e.preventDefault();
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  }
  function onDragMove(e: React.MouseEvent) {
    const d = dragRef.current;
    if (!d) return;
    setPan(clampPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) }, zoom));
  }
  function onDragEnd() { dragRef.current = null; }

  const arrow = "absolute top-1/2 -translate-y-1/2 rounded-full bg-ink/70 p-1.5 text-white transition-colors duration-[140ms] hover:bg-ink/90";
  const heightTransition = reduced ? "" : " transition-[height] duration-200";
  const count = (n?: number) => (n ?? 0) >= 1000 ? ((n ?? 0) / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n ?? 0);

  return (
    <div ref={wrapRef} role="group" aria-label="Post media" tabIndex={-1} className="mt-3" onDoubleClick={onFeedDoubleClick}>
      <div style={dims ? { width: dims.w + "px" } : undefined} className="relative mx-auto max-w-full overflow-hidden rounded-xl bg-black" onTouchStart={onTouchStart} onTouchEnd={onFeedTouchEnd}>
        {lightbox !== null ? (
          <div style={dims ? { height: dims.h + "px" } : undefined} className="w-full" />
        ) : (
        <div className={"flex items-center justify-center" + heightTransition}
          style={dims ? { height: dims.h + "px" } : undefined}
        >
          {item.media_type === "video" ? (
            <div style={dims ? { width: dims.w + "px", height: dims.h + "px" } : { width: "100%" }}>
              <div className="relative h-full w-full overflow-hidden"><VideoPlayer src={item.url} postId={postId} viewsCount={viewsCount}
                width={known?.w} height={known?.h}
                onDims={(w, h) => measure(item.id, w, h)}
                edit={editOf(item)}
                allowPlayback={!item.is_sensitive || !!revealed[item.id]}
                onExpand={() => openViewer(idx)}
              /><EditPlanes e={editOf(item)} /><TagLayer mode="list" tags={tags[item.id] || []} w={dims?.w} h={dims?.h} /></div>
            </div>
          ) : (
            <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={displayImageUrl(item.url, dataSaverEnabled() ? 480 : 1200)!}
              {...(dataSaverEnabled() ? {} : srcSetFor(item.url))}
              onError={(e) => { if (e.currentTarget.src !== item.url) { e.currentTarget.removeAttribute("srcset"); e.currentTarget.src = item.url; } }}
              onLoad={(e) => measure(item.id, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); openViewer(idx, e.currentTarget); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); openViewer(idx, e.currentTarget); } }}
              data-media-opener
              role="button"
              tabIndex={0}
              aria-label={"Open " + altOf(item, idx)}
              alt={altOf(item, idx)}
              loading="lazy"
              style={dims ? { width: dims.w + "px", height: dims.h + "px", ...editStyle(editOf(item)) } : editStyle(editOf(item))}
              className={"cursor-zoom-in object-contain " + (dims ? "" : "max-h-[80vh] w-full")}
            />
              <EditPlanes e={editOf(item)} />
              <TagLayer tags={tags[item.id] || []} w={dims?.w} h={dims?.h} />
            </div>
          )}
        </div>
        )}

        {item.is_sensitive && !revealed[item.id] ? (
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRevealed((r) => ({ ...r, [item.id]: true })); }}
            className="absolute inset-0 z-[6] flex flex-col items-center justify-center gap-2 bg-ink/95"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/70" aria-hidden><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
            <span className="text-[13px] font-semibold text-white">Sensitive content</span>
            <span className="text-[12px] text-white/50">The author flagged this media. Tap to show.</span>
          </button>
        ) : null}
        {media.length > 1 ? (
          <>
            {idx > 0 ? (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIdx(idx - 1); }} aria-label="Previous media" className={arrow + " left-2"}><ChevronLeft size={18} /></button>
            ) : null}
            {idx < media.length - 1 ? (
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIdx(idx + 1); }} aria-label="Next media" className={arrow + " right-2"}><ChevronRight size={18} /></button>
            ) : null}
            <span className="absolute right-2 top-2 rounded-md bg-ink/70 px-2 py-0.5 text-[11px] font-semibold text-white">{idx + 1}/{media.length}</span>
            <span className="absolute inset-x-0 bottom-0 flex justify-center">
              {media.map((m, i) => (
                <button key={m.id}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIdx(i); }}
                  aria-label={"Go to media " + (i + 1)}
                  className="flex h-8 w-7 items-center justify-center"
                >
                  <span className={"h-1.5 w-1.5 rounded-full transition-colors duration-[140ms] " + (i === idx ? "bg-pearl" : "bg-white/40")} />
                </button>
              ))}
            </span>
          </>
        ) : null}
      </div>

      {lightbox !== null ? (
        <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Media viewer"
          className="theater fixed inset-0 z-50 flex flex-col bg-[#0b0b0d]"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLightbox(null); }}
          onTouchStart={onTouchStart} onTouchMove={onModalTouchMove} onTouchEnd={onModalTouchEnd}
          onMouseMove={onDragMove} onMouseUp={onDragEnd} onMouseLeave={onDragEnd}
        >
          {/* Top bar, as in the reference: wordmark, author, Fit to screen, close. */}
          <div onClick={(e) => e.stopPropagation()} className="flex h-[56px] shrink-0 items-center gap-2 border-b border-white/10 px-3 md:h-[60px] md:gap-4 md:px-5">
            <span className="hidden items-center gap-2.5 md:flex">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="" className="h-7 w-7 rounded-full" />
              <span className="text-[15px] leading-none text-white"><span className="font-bold">Platinum</span> <span className="font-normal text-white/70">Circles</span></span>
            </span>
            {post ? (
              <Link href={"/" + (post.author_username ?? "")} className="flex min-w-0 items-center gap-2 text-white md:ml-3 md:gap-2.5">
                {post.author_avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.author_avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : null}
                <span className="flex min-w-0 items-center gap-[3px] text-[14px] font-semibold md:text-[15px]"><span className="truncate">{post.author_name}</span>{post.author_verified ? <VerifiedBadge userId={post.author_id} tier={post.author_verified_tier ?? null} size={14} /> : null}</span>
                <span className="hidden text-[13px] text-white/55 sm:inline">@{post.author_username}</span>
              </Link>
            ) : null}
            <span className="ml-auto text-[12px] font-semibold text-white/50">{lightbox + 1} / {media.length}</span>
            {post ? (
              <button onClick={() => setMobileComments((v) => !v)} aria-label={mobileComments ? "Hide comments" : "Show comments"} aria-expanded={mobileComments} className={"flex h-9 items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-semibold transition-colors duration-[140ms] lg:hidden " + (mobileComments ? "border-pearl bg-pearl/15 text-pearl" : "border-white/25 text-white hover:bg-white/10")}>
                <MessageCircle size={15} /> {count(commentsCount)}
              </button>
            ) : null}
            {post ? (
              <button onClick={() => setImmersive((v) => !v)} aria-label={immersive ? "Show comments" : "Fit to screen"} className="flex items-center gap-2 rounded-full border border-pearl/70 px-2.5 py-1.5 text-[13.5px] font-semibold text-pearl transition-colors duration-[140ms] hover:bg-pearl/10 sm:px-3.5">
                {immersive ? <Minimize2 size={15} /> : <Maximize2 size={15} />} <span className="hidden sm:inline">{immersive ? "Show comments" : "Fit to screen"}</span>
              </button>
            ) : null}
            <button ref={closeRef} onClick={() => setLightbox(null)} aria-label="Close viewer" className="flex h-9 w-9 items-center justify-center rounded-full border border-white/25 text-white transition-colors duration-[140ms] hover:bg-white/10"><X size={17} /></button>
          </div>

          <div className={"flex min-h-0 flex-1" + (mobileComments ? " max-lg:flex-col" : "")}>
          <div data-media-pane className={"relative flex min-w-0 flex-1 items-center justify-center overflow-hidden" + (mobileComments ? " max-lg:flex-none" : "")}>
            {lightbox > 0 ? (
              <button onClick={(e) => { e.stopPropagation(); goTo(lightbox - 1); }} aria-label="Previous media" className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-ink/60 p-2 text-white transition-colors duration-[140ms] hover:bg-ink/80"><ChevronLeft size={20} /></button>
            ) : null}
            {lightbox < media.length - 1 ? (
              <button onClick={(e) => { e.stopPropagation(); goTo(lightbox + 1); }} aria-label="Next media" className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-ink/60 p-2 text-white transition-colors duration-[140ms] hover:bg-ink/80"><ChevronRight size={20} /></button>
            ) : null}
            {media[lightbox].media_type === "video" ? (
              <div className={"h-full min-h-0 w-full px-2" + (mobileComments ? " max-lg:h-[40vh]" : "")} onClick={(e) => e.stopPropagation()}>
                <VideoPlayer src={media[lightbox].url} postId={postId} viewsCount={viewsCount} immersive
                  width={trueDims[media[lightbox].id]?.w ?? media[lightbox].width ?? undefined}
                  height={trueDims[media[lightbox].id]?.h ?? media[lightbox].height ?? undefined}
                  edit={editOf(media[lightbox])}
                  allowPlayback={!media[lightbox].is_sensitive || !!revealed[media[lightbox].id]}
                />
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displayImageUrl(media[lightbox].url)!}
                onError={(e) => { if (e.currentTarget.src !== media[lightbox].url) e.currentTarget.src = media[lightbox].url; }}
                alt={altOf(media[lightbox], lightbox)}
                onClick={(e) => e.stopPropagation()}
                onWheel={onWheelZoom}
                onDoubleClick={onDoubleClick}
                onMouseDown={onDragStart}
                draggable={false}
                style={{ transform: "translate(" + pan.x + "px," + pan.y + "px) scale(" + zoom + ")", transition: dragRef.current || reduced ? "none" : "transform 120ms", cursor: zoom > 1 ? "grab" : "zoom-in" }}
                className={"max-h-full max-w-full select-none object-contain [touch-action:none]" + (mobileComments ? " max-lg:max-h-[40vh]" : "")}
              />
            )}
            {media[lightbox].is_sensitive && !revealed[media[lightbox].id] ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); setRevealed((r) => ({ ...r, [media[lightbox].id]: true })); }} className="absolute inset-0 z-[6] flex flex-col items-center justify-center gap-2 bg-ink text-white">
                <span className="text-sm font-semibold">Sensitive content</span>
                <span className="text-xs text-white/60">The author flagged this media. Tap to show.</span>
              </button>
            ) : null}
            {media[lightbox].media_type === "image" ? <EditPlanes e={editOf(media[lightbox])} /> : null}
            {media[lightbox].media_type === "image" ? (
              <span className="absolute bottom-4 right-4 z-10 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => setZoomClamped(zoom - 0.5)} aria-label="Zoom out" className="rounded-md bg-ink/60 px-2.5 py-1.5 text-[13px] font-bold text-white transition-colors duration-[140ms] hover:bg-ink/80">-</button>
                <button onClick={() => resetZoom()} aria-label="Reset zoom" className="rounded-md bg-ink/60 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors duration-[140ms] hover:bg-ink/80">{Math.round(zoom * 100)}%</button>
                <button onClick={() => setZoomClamped(zoom + 0.5)} aria-label="Zoom in" className="rounded-md bg-ink/60 px-2.5 py-1.5 text-[13px] font-bold text-white transition-colors duration-[140ms] hover:bg-ink/80">+</button>
              </span>
            ) : null}
          </div>

          {media[lightbox + 1]?.media_type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(media[lightbox + 1].url, 1600)!} alt="" aria-hidden className="hidden" />
          ) : null}
          {media[lightbox - 1]?.media_type === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayImageUrl(media[lightbox - 1].url, 1600)!} alt="" aria-hidden className="hidden" />
          ) : null}

          {showPanel ? (
            <aside onClick={(e) => e.stopPropagation()} className="hidden w-[340px] shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-navy p-5 lg:flex">
              <div className="flex items-center gap-2.5">
                {post!.author_avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(post!.author_avatar, 100)!} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-sm font-semibold text-porcelain">{(post!.author_name ?? "?").charAt(0)}</span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-white">{post!.author_name}</span>
                  <span className="block truncate text-[12px] text-white/55">@{post!.author_username}</span>
                </span>
              </div>
              {post!.content ? (
                <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-white/85"><RichText text={post!.content} /></p>
              ) : null}
              <div className="-ml-2 mt-4 flex items-center gap-1 text-[13px]">
                <button onClick={() => void social.setLike(!liked)} aria-label={liked ? "Unlike" : "Like"} aria-pressed={liked} disabled={social.pending || social.uncertain} aria-busy={social.pending} className={"flex items-center gap-1.5 rounded-full px-2.5 py-2 transition-colors duration-[140ms] " + (liked ? "text-danger" : "text-white/55 hover:bg-white/10 hover:text-danger")}>
                  <Heart size={16} fill={liked ? "currentColor" : "none"} /> {count(likeN)}
                </button>
                <Link href={"/post/" + post!.post_id} className="flex items-center gap-1.5 rounded-full px-2.5 py-2 text-white/55 transition-colors duration-[140ms] hover:bg-white/10 hover:text-white">
                  <MessageCircle size={16} /> {count(commentsCount)}
                </Link>
                <span className="flex items-center gap-1.5 rounded-full px-2.5 py-2 text-white/55"><Repeat2 size={16} /> {count(post!.reposts_count)}</span>
                <button onClick={() => void social.setBookmark(!marked)} title={marked ? "Saved" : "Save"} aria-label={marked ? "Unsave post" : "Save post"} aria-pressed={marked} disabled={social.pending || social.uncertain} aria-busy={social.pending} className={"ml-auto rounded-full p-2 transition-colors duration-[140ms] " + (marked ? "text-pearl" : "text-white/55 hover:bg-white/10 hover:text-pearl")}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={marked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                </button>
                <span className="theater-menu [&>div>button:first-of-type]:text-white/60 [&>div>button:first-of-type:hover]:bg-white/10 [&>div>button:first-of-type:hover]:text-white">
                  <PostMenu postId={post!.post_id} authorId={post!.author_id ?? ""} text={post!.content ?? ""} onHidden={() => setLightbox(null)} />
                </span>
              </div>
              {social.pending ? <span role="status" className="sr-only">Updating post interactions</span> : null}
              {social.error ? <p role="alert" className="mt-2 text-sm text-white">{social.error} <button type="button" disabled={social.pending} onClick={() => void social.retry()} className="underline">Check status</button></p> : null}
              <div className="theater-comments mt-4 min-h-0 flex-1 overflow-y-auto border-t border-white/10 pt-4 [&_*]:text-white [&_input]:bg-white/10 [&_textarea]:bg-white/10">
                <Comments postId={post!.post_id} />
              </div>
              <Link href={"/post/" + post!.post_id} className="mt-3 text-center text-[12px] text-white/55 hover:text-white/70">
                Open the full post
              </Link>
            </aside>
          ) : null}
          {post && mobileComments ? (
            <div onClick={(e) => e.stopPropagation()} className="flex min-h-0 flex-1 flex-col border-t border-white/10 bg-navy lg:hidden">
              <div className="theater-comments min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3 [&_*]:text-white [&_input]:bg-white/10 [&_textarea]:bg-white/10">
                <Comments postId={post.post_id} />
              </div>
            </div>
          ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
