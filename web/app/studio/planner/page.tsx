"use client";

import { errorMessage } from "@/lib/errors";

import { StudioLoadError } from "../LoadError";

import { StudioRailPortal } from "@/components/StudioRailPortal";
import { StudioDialog } from "@/components/StudioDialog";
import styles from "@/components/StudioWorkspace.module.css";
import { Panel } from "@/components/ui";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { CalendarClock, Image as ImageIcon, Plus, Send, Tag, Trash2, X, AlertTriangle, CheckCircle2, FileText, Users, Eye, ArrowLeft, ArrowRight } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import { createClient } from "@/lib/supabase/client";
import { can, cancelScheduled, deleteScheduled, listScheduled, myListings, publishNow, savePost, uploadStudioMedia, type ScheduledPost } from "@/lib/studio";
import { useUploadPreview } from "@/lib/useUploadPreview";
import { useStudio } from "@/components/StudioShell";
import { useCurrentTime } from "@/lib/useCurrentTime";
import { withTimeout } from "@/lib/withTimeout";
import { parseStudioLocalDate } from "../../../../shared/studioValidation";

type Draft = { id: string | null; content: string; body: string; category: string | null; community: string | null; media: ScheduledPost["media"]; products: ScheduledPost["products"]; publishAt: string };

const empty = (): Draft => ({ id: null, content: "", body: "", category: null, community: null, media: [], products: [], publishAt: "" });
const toLocalInput = (iso: string | null) => { if (!iso) return ""; const date = new Date(iso); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const dayKey = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

export default function PlannerPage() {
  const { me, accountId } = useStudio();
  const now = useCurrentTime();
  const [supabase] = useState(createClient);
  const editor = can(me?.role ?? null, "publish");
  const [rows, setRows] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"upcoming" | "drafts" | "published" | "failed">("upcoming");
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [failedUploads, setFailedUploads] = useState<File[]>([]);
  const deepLink = useRef(false);
  const initialDraft = useRef(JSON.stringify(empty()));
  const [d, setD] = useState<Draft>(empty());
  const previewSource = useMemo(() => ({ rows, draft: d }), [rows, d]);
  const mediaPreview = useUploadPreview(previewSource);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const mounted = useRef(true);
  const editorVersion = useRef(0);
  const editingId = useRef<string | null>(null);
  const loadVersion = useRef(0);
  const pendingRows = useRef(new Set<string>());
  const [listings, setListings] = useState<{ id: string; title: string; price: number; currency: string; images: string[] }[]>([]);
  const [listingsLoaded, setListingsLoaded] = useState(false);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const listingsRequest = useRef(0);
  const [communities, setCommunities] = useState<{ id: string; name: string }[]>([]);
  const [communitiesLoading, setCommunitiesLoading] = useState(true);
  const [communitiesError, setCommunitiesError] = useState<string | null>(null);
  const communitiesRequest = useRef(0);
  const [pickOpen, setPickOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [span, setSpan] = useState<"week" | "month">("month");
  const [weekStart, setWeekStart] = useState(() => { const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() - t.getDay()); return t; });

  const openNew = useCallback((when?: Date) => {
    if (working.current) return;
    ++editorVersion.current; editingId.current = null;
    const x = empty();
    if (when) { const t = new Date(when); t.setHours(10, 0, 0, 0); x.publishAt = toLocalInput(t.toISOString()); }
    initialDraft.current = JSON.stringify(x); setD(x); setFailedUploads([]); setEditorError(null); setOpen(true);
  }, []);
  const openEdit = useCallback((r: ScheduledPost) => {
    if (working.current) return;
    ++editorVersion.current; editingId.current = r.id;
    const draft = { id: r.id, content: r.content || "", body: r.body || "", category: r.category, community: r.community_id, media: r.media || [], products: r.products || [], publishAt: toLocalInput(r.publish_at) };
    initialDraft.current = JSON.stringify(draft); setD(draft); setFailedUploads([]); setEditorError(null); setOpen(true);
  }, []);
  const consumeRequestedAction = useCallback((loadedRows: ScheduledPost[]) => {
    if (deepLink.current) return;
    const params = new URLSearchParams(window.location.search);
    deepLink.current = true;
    if (params.get("filter") === "failed") setTab("failed");
    const id = params.get("edit");
    if (id) {
      const row = loadedRows.find(item => item.id === id);
      if (row && editor && !["published", "publishing"].includes(row.status)) openEdit(row);
      else setLoadError(row ? "This post cannot be edited in its current state or role." : "That draft is not in the latest 100 loaded posts. Refresh or open it from the publishing queue.");
    } else if (params.get("compose") === "1" && editor) openNew();
  }, [editor, openEdit, openNew]);

  const load = useCallback(() => {
    const request = ++loadVersion.current;
    const current = () => mounted.current && request === loadVersion.current;
    return withTimeout(listScheduled()).then(next => {
      if (!current()) return;
      setRows(next); setLoaded(true); setLoadError(null);
      consumeRequestedAction(next);
    }).catch(() => { if (current()) setLoadError("The planner could not be refreshed. Please try again."); })
      .finally(() => { if (current()) setLoading(false); });
  }, [consumeRequestedAction]);
  useEffect(() => { const requests = loadVersion, edits = editorVersion; mounted.current = true; void load(); return () => { mounted.current = false; ++requests.current; ++edits.current; }; }, [load]);
  const loadListings = useCallback(() => {
    const request = ++listingsRequest.current;
    return withTimeout(myListings()).then(data => {
      if (request !== listingsRequest.current) return;
      setListings(data); setListingsLoaded(true); setListingsError(null);
    }).catch(() => {
      if (request === listingsRequest.current) setListingsError("Products could not be loaded. Please try again.");
    }).finally(() => {
      if (request === listingsRequest.current) setListingsLoading(false);
    });
  }, []);
  const loadCommunities = useCallback(() => {
    const request = ++communitiesRequest.current;
    return withTimeout(supabase.rpc("get_communities", { p_query: null, p_limit: 60 })).then(({ data, error }) => {
      if (error) throw error;
      if (request !== communitiesRequest.current) return;
      setCommunities(((data as { id: string; name: string; my_role: string | null }[]) ?? [])
        .filter(c => c.my_role === "owner" || c.my_role === "moderator").map(c => ({ id: c.id, name: c.name })));
      setCommunitiesError(null);
    }).catch(() => {
      if (request === communitiesRequest.current) setCommunitiesError("Communities could not be loaded. Please try again.");
    }).finally(() => {
      if (request === communitiesRequest.current) setCommunitiesLoading(false);
    });
  }, [supabase]);
  useEffect(() => {
    const pendingListings = listingsRequest;
    const pendingCommunities = communitiesRequest;
    void loadListings();
    void loadCommunities();
    return () => { ++pendingListings.current; ++pendingCommunities.current; };
  }, [loadListings, loadCommunities]);

  const shown = useMemo(() => rows.filter(r =>
    tab === "upcoming" ? ["scheduled", "publishing", "failed"].includes(r.status)
    : tab === "drafts" ? ["draft", "cancelled"].includes(r.status)
    : tab === "failed" ? r.status === "failed" : r.status === "published"), [rows, tab]);

  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => { const x = new Date(weekStart); x.setDate(x.getDate() + i); return x; }), [weekStart]);

  // The month grid always starts on a Sunday and always renders whole weeks, so
  // the calendar keeps its shape instead of reflowing as months change length.
  const month = useMemo(() => {
    const first = new Date(weekStart.getFullYear(), weekStart.getMonth(), 1);
    const start = new Date(first);
    start.setDate(start.getDate() - start.getDay());
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const x = new Date(start);
      x.setDate(x.getDate() + i);
      cells.push(x);
      if (i >= 34 && x.getMonth() !== weekStart.getMonth() && x.getDay() === 6) break;
    }
    return cells;
  }, [weekStart]);
  const byDay = useMemo(() => {
    const m: Record<string, ScheduledPost[]> = {};
    rows.filter(r => r.publish_at && r.status !== "cancelled").forEach(r => { const k = dayKey(new Date(r.publish_at!)); (m[k] ||= []).push(r); });
    return m;
  }, [rows]);

  const closeEditor = () => {
    if (working.current) return;
    if (JSON.stringify(d) !== initialDraft.current || failedUploads.length) { setDiscardOpen(true); return; }
    ++editorVersion.current; setOpen(false);
  };
  const attachFiles = async (files: File[]) => {
    if (!files.length || working.current) return;
    working.current = true;
    const run = editorVersion.current;
    const current = () => mounted.current && run === editorVersion.current;
    setBusy(true); setEditorError(null);
    const failed: File[] = [];
    try {
      for (const file of files.slice(0, 4 - d.media.length)) {
        if (!current()) return;
        try { const media = await uploadStudioMedia(file); if (current()) setD(value => ({ ...value, media: [...value.media, media].slice(0,4) })); }
        catch { failed.push(file); }
      }
      if (current()) { setFailedUploads(failed); if (failed.length) setEditorError(`${failed.length} ${failed.length === 1 ? "file could" : "files could"} not be uploaded. Retry or remove them before publishing.`); }
    } finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const attach = async (files: FileList | null) => { if (files?.length) await attachFiles(Array.from(files)); };
  const moveMedia = (from: number, to: number) => setD(value => { const media = [...value.media]; const [item] = media.splice(from,1); media.splice(to,0,item); return { ...value, media }; });

  const toggleListing = (l: typeof listings[number]) => {
    setD(x => {
      const has = x.products.some(p => p.listing_id === l.id);
      return { ...x, products: has ? x.products.filter(p => p.listing_id !== l.id) : [...x.products, { title: l.title, price: l.price, currency: l.currency, image_url: l.images?.[0] || null, listing_id: l.id, cta_label: "View listing" }] };
    });
  };

  const save = async (mode: "draft" | "schedule" | "now") => {
    if (working.current || !editor || failedUploads.length) return;
    if (!d.content.trim() && !d.body.trim() && d.media.length === 0) { setEditorError("Write something or add media first."); return; }
    const publishDate = mode === "schedule" ? parseStudioLocalDate(d.publishAt) : null;
    if (mode === "schedule" && (!publishDate || publishDate.getTime() <= Date.now())) { setEditorError("Choose a valid future date and time."); return; }
    working.current = true;
    const run = editorVersion.current;
    const current = () => mounted.current && run === editorVersion.current;
    setBusy(true);
    try {
      const id = await savePost({ ownerId: accountId, id: editingId.current, content: d.content.trim() || null, body: d.body.trim() || null, category: d.category, community: d.community, media: d.media, products: d.products, publishAt: publishDate?.toISOString() || null });
      if (!current()) return;
      editingId.current = id; setD(x => ({ ...x, id }));
      if (mode === "now") {
        const postId = await publishNow(id);
        if (!postId) throw new Error("Your draft was saved, but publishing failed. You can correct it and retry here.");
      }
      if (!current()) return;
      setOpen(false); setD(empty()); editingId.current = null;
      await load();
    } catch (e: unknown) { if (current()) { setEditorError(errorMessage(e, "The save was not confirmed. Retry to check the same request.")); await load(); } }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };

  const remove = async (r: ScheduledPost) => {
    if (pendingRows.current.has(r.id)) return;
    if (!confirm("Delete this " + (r.status === "published" ? "record" : r.status) + "?")) return;
    pendingRows.current.add(r.id);
    try { await deleteScheduled(r.id); await load(); } catch (e: unknown) { alert(errorMessage(e, "Could not delete.")); }
    finally { pendingRows.current.delete(r.id); }
  };
  const cancel = async (r: ScheduledPost) => {
    if (pendingRows.current.has(r.id)) return;
    pendingRows.current.add(r.id);
    try { await cancelScheduled(r.id); await load(); } catch (e: unknown) { alert(errorMessage(e, "Could not cancel.")); }
    finally { pendingRows.current.delete(r.id); }
  };

  const statusChip = (s: ScheduledPost["status"]) =>
    s === "scheduled" ? "bg-pearl/15 text-accent" : s === "published" ? "bg-success/15 text-success" : s === "failed" ? "bg-danger/15 text-danger" : "bg-surface text-muted";

  const railRows = useMemo(() => {
    const soon = now === null ? null : now + 7 * 86400000;
    const upcoming = rows
      .filter((r) => now !== null && r.status === "scheduled" && r.publish_at && new Date(r.publish_at).getTime() >= now)
      .sort((a, b) => new Date(a.publish_at!).getTime() - new Date(b.publish_at!).getTime());
    return {
      next: upcoming.slice(0, 3),
      thisWeek: upcoming.filter((r) => soon !== null && new Date(r.publish_at!).getTime() <= soon).length,
      drafts: rows.filter((r) => r.status === "draft").length,
      failed: rows.filter((r) => r.status === "failed").length,
    };
  }, [rows, now]);

  return (
    <div className="max-w-[960px]">
      {mediaPreview.error ? <div role="alert" className="mb-3 text-sm text-danger">{mediaPreview.error} <button onClick={mediaPreview.retry} className="underline">Retry</button></div> : null}
      <StudioRailPortal>
        <>
          {railRows.failed > 0 || railRows.drafts > 0 || railRows.thisWeek > 0 ? (
            <Panel title="Your queue">
              <div className="flex flex-col gap-2">
                {railRows.thisWeek > 0 ? (
                  <div className="flex items-baseline gap-2.5">
                    <span className="font-display text-[17px] leading-none text-pearl-muted">{railRows.thisWeek}</span>
                    <span className="flex-1 text-[13px] text-ink/70">going out this week</span>
                  </div>
                ) : null}
                {railRows.drafts > 0 ? (
                  <div className="flex items-baseline gap-2.5">
                    <span className="font-display text-[17px] leading-none text-pearl-muted">{railRows.drafts}</span>
                    <span className="flex-1 text-[13px] text-ink/70">{railRows.drafts === 1 ? "draft waiting" : "drafts waiting"}</span>
                  </div>
                ) : null}
                {railRows.failed > 0 ? (
                  <div className="flex items-baseline gap-2.5">
                    <span className="font-display text-[17px] leading-none text-danger">{railRows.failed}</span>
                    <span className="flex-1 text-[13px] text-ink/70">failed to publish</span>
                  </div>
                ) : null}
              </div>
            </Panel>
          ) : null}
          {railRows.next.length > 0 ? (
            <Panel title="Next out">
              <div className="flex flex-col gap-2.5">
                {railRows.next.map(r => (
                  <div key={r.id}>
                    <p className="line-clamp-1 text-[13px] text-ink">{r.content || r.body || "Media post"}</p>
                    <p className="text-[11.5px] text-muted">
                      {new Date(r.publish_at!).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </>
      </StudioRailPortal>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-[21px] leading-tight text-porcelain">Planner</h1>
          <p className="mt-1 text-[13px] text-muted">Drafts, schedule and publish. Choose a date, preview your content and schedule it for publication.</p>
        </div>
        {editor ? <button onClick={() => openNew()} className="inline-flex items-center gap-1.5 rounded-md bg-ink px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90"><Plus size={15} /> New post</button> : null}
      </div>

      <div className="mt-5 rounded-2xl border border-ink/10 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => setWeekStart(w => { const x = new Date(w); if (span === "month") x.setMonth(x.getMonth() - 1, 1); else x.setDate(x.getDate() - 7); return x; })} className="rounded-md px-2 py-1 text-[12.5px] text-ink/60 transition-colors duration-[140ms] hover:bg-surface">Previous</button>
          <span className="text-[13px] font-semibold text-ink">
            {span === "month"
              ? weekStart.toLocaleDateString(undefined, { month: "long", year: "numeric" })
              : week[0].toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " to " + week[6].toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
          <div className="ml-2 flex gap-1 rounded-full bg-surface p-1">
            {(["month", "week"] as const).map(v => (
              <button key={v} onClick={() => setSpan(v)}
                className={"rounded-full px-2.5 py-1 text-[12px] font-semibold capitalize transition-colors duration-[140ms] " + (span === v ? "bg-ink text-white" : "text-ink/60 hover:text-ink")}>
                {v}
              </button>
            ))}
          </div>
          <button
            onClick={() => { const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() - t.getDay()); setWeekStart(t); }}
            className="rounded-full border border-ink/15 px-3 py-1 text-[12px] font-semibold text-ink/65 transition-colors duration-[140ms] hover:bg-surface hover:text-ink"
          >
            Today
          </button>
          <button onClick={() => setWeekStart(w => { const x = new Date(w); if (span === "month") x.setMonth(x.getMonth() + 1, 1); else x.setDate(x.getDate() + 7); return x; })} className="rounded-md px-2 py-1 text-[12.5px] text-ink/60 transition-colors duration-[140ms] hover:bg-surface">Next</button>
        </div>
        {span === "month" ? (
          <div className="mb-1.5 grid grid-cols-7 gap-1.5">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
              <span key={d} className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{d}</span>
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-7 gap-1.5">
          {(span === "month" ? month : week).map(day => {
            const k = dayKey(day); const items = byDay[k] || []; const today = k === dayKey(new Date());
            const outside = span === "month" && day.getMonth() !== weekStart.getMonth();
            return (
              <button key={k} disabled={!editor} aria-label={`Plan content for ${day.toLocaleDateString()}. ${items.length} scheduled items.`} onClick={() => editor && openNew(day)} className={"rounded-lg border p-2 text-left transition-colors duration-[140ms] hover:bg-surface " + (span === "month" ? "min-h-[86px] " : "min-h-[110px] ") + (today ? "border-pearl/60 bg-pearl/6 " : "border-ink/10 ") + (outside ? "opacity-40" : "")}>
                <span className={"text-[11px] font-semibold " + (today ? "text-accent" : "text-muted")}>
                  {span === "month" ? day.getDate() : day.toLocaleDateString(undefined, { weekday: "short" }) + " " + day.getDate()}
                </span>
                {items.slice(0, span === "month" ? 2 : 4).map(r => (
                  <span key={r.id} className={"mt-1 block truncate rounded px-1.5 py-0.5 text-[10.5px] " + statusChip(r.status)}>
                    {new Date(r.publish_at!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} {r.content || r.body || "Media"}
                  </span>
                ))}
                {items.length > (span === "month" ? 2 : 4) ? <span className="mt-1 block text-[10.5px] text-muted">+{items.length - (span === "month" ? 2 : 4)} more</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex gap-2">
        {(["upcoming", "drafts", "published", "failed"] as const).map(t => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)} className={"rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors duration-[140ms] " + (tab === t ? "bg-ink text-white" : "bg-surface text-ink/60")}>
            {t === "upcoming" ? "Upcoming" : t === "drafts" ? "Drafts" : t === "failed" ? "Failed" : "Published"}
          </button>
        ))}
      </div>

      <StudioLoadError message={loadError} retry={() => { setLoading(true); void load(); }} busy={loading} />
      {loading && !loaded ? <p className="py-12 text-center text-sm text-muted">Loading</p>
      : !loaded ? null
      : shown.length === 0 ? <p className="py-12 text-center text-sm text-muted">{tab === "upcoming" ? "Nothing scheduled. Tap a day above to plan one." : tab === "drafts" ? "No drafts." : "Nothing published from the Planner yet."}</p>
      : shown.map(r => (
        <div key={r.id} className="mt-2.5 flex items-start gap-3.5 rounded-2xl border border-ink/10 bg-white p-3.5">
          {r.media?.[0]?.media_type !== "video" && mediaPreview.preview.rows.find(row => row.id === r.id)?.media?.[0]?.url ? (
            <Image unoptimized width={64} height={64} src={mediaPreview.preview.rows.find(row => row.id === r.id)?.media?.[0]?.url || ""} alt="" className="h-16 w-16 rounded-lg object-cover" />
          ) : <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-surface text-muted"><FileText size={20} /></span>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={"rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase " + statusChip(r.status)}>{r.status}</span>
              {r.publish_at ? <span className="flex items-center gap-1 text-[12px] text-muted"><CalendarClock size={12} /> {new Date(r.publish_at).toLocaleString()}</span> : null}
              {r.products?.length ? <span className="flex items-center gap-1 text-[12px] text-muted"><Tag size={12} /> {r.products.length} products</span> : null}
              {r.community_id ? <span className="flex items-center gap-1 text-[12px] text-muted"><Users size={12} /> community</span> : null}
            </div>
            <p className="mt-1 line-clamp-2 text-[14px] text-ink">{r.content || r.body || "Media post"}</p>
            {r.status === "failed" && r.error ? <p className="mt-1 flex items-center gap-1 text-[12px] text-danger"><AlertTriangle size={12} /> {r.error}</p> : null}
            {r.status === "published" && r.published_post_id ? <Link href={"/post/" + r.published_post_id} className="mt-1 inline-flex items-center gap-1 text-[12px] text-success"><CheckCircle2 size={12} /> View the live post</Link> : null}
          </div>
          {editor ? (
            <div className="flex shrink-0 flex-col gap-1">
              {r.status !== "published" && r.status !== "publishing" ? <button onClick={() => openEdit(r)} className="rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink">Edit</button> : null}
              {r.status === "scheduled" ? <button onClick={() => cancel(r)} className="rounded-md bg-surface px-2.5 py-1 text-[12px] text-ink/70 transition-colors duration-[140ms] hover:text-ink">Unschedule</button> : null}
              <button onClick={() => remove(r)} className="rounded-md px-2.5 py-1 text-[12px] text-danger transition-colors duration-[140ms] hover:bg-danger/10" aria-label={`Delete ${r.status} post`}><Trash2 size={13} /></button>
            </div>
          ) : null}
        </div>
      ))}

      <StudioDialog title={d.id ? "Edit planned post" : "Create content"} description="Save a draft, review your media and choose when to publish." open={open} onClose={closeEditor} busy={busy} wide>
            {editorError ? <p role="alert" className={`${styles.notice} ${styles.error} mx-4`}>{editorError}</p> : null}
            <fieldset disabled={busy} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-3">
              <label className={styles.field}>Caption<textarea value={d.content} onChange={e => setD(x => ({ ...x, content: e.target.value }))} maxLength={2000} placeholder="What do you want to say?"
                className="h-28 w-full resize-none rounded-lg border border-ink/15 px-3 py-2 text-[14.5px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" /><small>{d.content.length.toLocaleString()} / 2,000 characters</small></label>
              <label className={styles.field}>Article body (optional)<textarea value={d.body} onChange={e => setD(x => ({ ...x, body: e.target.value }))} maxLength={20000} placeholder="Longer text (optional)"
                className="mt-2 h-20 w-full resize-none rounded-lg border border-ink/15 px-3 py-2 text-[13.5px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" /></label>
              {d.media.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {d.media.map((m, i) => (
                    <span key={i} className="relative">
                      {m.media_type === "video" ? <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-ink text-[10px] text-white">video</span>
                        : mediaPreview.preview.draft.media[i]?.url ? <Image unoptimized width={64} height={64} src={mediaPreview.preview.draft.media[i].url} alt="" className="h-16 w-16 rounded-lg object-cover" /> : <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-surface text-xs text-muted">Preview</span>}
                      <button onClick={() => setD(x => ({ ...x, media: x.media.filter((_, j) => j !== i) }))} className="absolute -right-1 -top-1 rounded-full bg-ink p-1 text-white" aria-label={`Remove media ${i+1}`}><X size={11} /></button>
                      <span className="mt-2 flex justify-between gap-1"><button type="button" disabled={i === 0} aria-label={`Move media ${i+1} earlier`} onClick={() => moveMedia(i,i-1)} className="rounded border border-ink/10 p-1 disabled:opacity-30"><ArrowLeft size={13}/></button><span className="text-xs text-muted">{i+1}</span><button type="button" disabled={i === d.media.length-1} aria-label={`Move media ${i+1} later`} onClick={() => moveMedia(i,i+1)} className="rounded border border-ink/10 p-1 disabled:opacity-30"><ArrowRight size={13}/></button></span>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button onClick={() => fileRef.current?.click()} disabled={d.media.length >= 4 || busy || failedUploads.length > 0} className="inline-flex items-center gap-1.5 rounded-full bg-ink/5 px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:bg-ink/10 disabled:opacity-40"><ImageIcon size={14} /> Media</button>
                <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={e => { void attach(e.target.files); e.target.value = ""; }} />
                <button onClick={() => setPickOpen(o => !o)} className="inline-flex items-center gap-1.5 rounded-full bg-ink/5 px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 transition-colors duration-[140ms] hover:bg-ink/10"><Tag size={14} /> Products {d.products.length ? "(" + d.products.length + ")" : ""}</button>
                {communities.length || d.community ? (
                  <select aria-label="Publish destination" value={d.community || ""} onChange={e => setD(x => ({ ...x, community: e.target.value || null }))} className="rounded-full bg-ink/5 px-3 py-1.5 text-[12.5px] font-semibold text-ink/70 outline-none">
                    <option value="">Main feed</option>
                    {d.community && !communities.some(c => c.id === d.community) ? <option value={d.community}>Current community (not in this list)</option> : null}
                    {communities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : null}
              </div>
              {failedUploads.length ? <div className="mt-3 rounded-lg border border-danger/25 p-3"><p className="text-sm font-semibold">Uploads need attention</p><ul className="my-2 space-y-1 text-xs text-muted">{failedUploads.map((file,index) => <li key={file.name+index}>{file.name}<button type="button" className="ml-2 underline" onClick={() => setFailedUploads(files => files.filter((_,i) => i !== index))}>Remove</button></li>)}</ul><button type="button" className={styles.button} disabled={busy} onClick={() => void attachFiles(failedUploads)}>Retry uploads</button></div> : null}
              <StudioLoadError message={communitiesError} retry={() => { setCommunitiesLoading(true); void loadCommunities(); }} busy={communitiesLoading} />
              {pickOpen ? (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-2xl border border-ink/10 bg-surface p-2">
                  <StudioLoadError message={listingsError} retry={() => { setListingsLoading(true); void loadListings(); }} busy={listingsLoading} />
                  {listingsLoading && !listingsLoaded ? <p className="text-[12.5px] text-muted">Loading products</p>
                  : !listingsLoaded ? null
                  : listings.length === 0 ? <p className="text-[12.5px] text-muted">No active listings. Create one in Market to attach product cards.</p>
                  : listings.map(l => {
                    const on = d.products.some(p => p.listing_id === l.id);
                    return (
                      <button key={l.id} onClick={() => toggleListing(l)} className={"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-[140ms] " + (on ? "bg-ink text-white" : "hover:bg-black/5")}>
                        {l.images?.[0] ? (
                          <Image unoptimized width={32} height={32} src={l.images[0]} alt="" className="h-8 w-8 rounded object-cover" />
                        ) : <span className="h-8 w-8 rounded bg-ink/10" />}
                        <span className="flex-1 truncate">{l.title}</span>
                        <span className={on ? "text-white/70" : "text-muted"}>{l.currency} {l.price}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <p className="mb-1.5 mt-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Category</p>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map(c => (
                  <button key={c.key} onClick={() => setD(x => ({ ...x, category: x.category === c.key ? null : c.key }))}
                    className={"rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors duration-[140ms] " + (d.category === c.key ? "border-ink bg-ink text-white" : "border-ink/10 text-ink/60")}>{c.label}</button>
                ))}
              </div>
              <p className="mb-1.5 mt-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Schedule</p>
              <label className={styles.field}>Publication date and time<input type="datetime-local" value={d.publishAt} onChange={e => setD(x => ({ ...x, publishAt: e.target.value }))}
                className="rounded-lg border border-ink/15 px-3 py-2 text-[13.5px] text-ink outline-none transition-colors duration-[140ms] focus:border-ink/40" /><small>Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Scheduling requires a future date.</small></label>
            </fieldset>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink/10 px-4 py-3">
              <button type="button" className={styles.button} disabled={busy} onClick={closeEditor}>Cancel</button>
              <button type="button" className={styles.button} disabled={busy || failedUploads.length > 0} onClick={() => setPreviewOpen(true)}><Eye size={15}/>Preview</button>
              <button onClick={() => save("draft")} disabled={busy || failedUploads.length > 0} className="rounded-md bg-ink/5 px-3.5 py-2 text-[13px] font-semibold text-ink/70 transition-opacity duration-[140ms] hover:opacity-80 disabled:opacity-40">Save draft</button>
              <button onClick={() => save("schedule")} disabled={busy || !d.publishAt || failedUploads.length > 0} className="inline-flex items-center gap-1.5 rounded-md bg-ink/5 px-3.5 py-2 text-[13px] font-semibold text-ink transition-opacity duration-[140ms] hover:opacity-80 disabled:opacity-40"><CalendarClock size={14} /> Schedule</button>
              <button onClick={() => save("now")} disabled={busy || failedUploads.length > 0} className="inline-flex items-center gap-1.5 rounded-md bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-opacity duration-[140ms] hover:opacity-90 disabled:opacity-40"><Send size={14} /> {busy ? "Working" : "Publish now"}</button>
            </div>
      </StudioDialog>
      <StudioDialog title="Post preview" description="Review the content before saving or publishing." open={previewOpen} onClose={() => setPreviewOpen(false)}><div className={styles.dialogBody}><p className="mb-3 font-semibold">{me?.business_name || me?.display_name}</p><p className="whitespace-pre-wrap text-sm leading-6">{d.content}</p>{d.body ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{d.body}</p> : null}<div className="mt-4 space-y-3">{mediaPreview.preview.draft.media.map((item,index) => item.media_type === "video" ? <video key={index} src={item.url} controls preload="metadata" playsInline className="max-h-[480px] w-full rounded-lg bg-surface object-contain" /> : <Image unoptimized width={1200} height={800} style={{ height: "auto" }} key={index} src={item.url} alt={`Attached media ${index+1}`} className="max-h-[480px] w-full rounded-lg bg-surface object-contain" />)}</div>{d.products.length ? <p className="mt-4 text-sm text-muted">{d.products.length} attached product cards</p> : null}</div><footer className={styles.dialogFooter}><button className={styles.buttonPrimary} onClick={() => setPreviewOpen(false)}>Back to editing</button></footer></StudioDialog>
      <StudioDialog title="Discard unsaved changes?" open={discardOpen} onClose={() => setDiscardOpen(false)}><div className={styles.dialogBody}><p className="text-sm leading-6">Your changes have not been saved. Keep editing to save a draft, or discard the changes and return to Planner.</p></div><footer className={styles.dialogFooter}><button className={styles.button} onClick={() => setDiscardOpen(false)}>Keep editing</button><button className={`${styles.button} ${styles.buttonDanger}`} onClick={() => { ++editorVersion.current; setDiscardOpen(false); setOpen(false); setD(empty()); setFailedUploads([]); }}>Discard changes</button></footer></StudioDialog>
    </div>
  );
}
