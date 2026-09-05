"use client";

import { MessageButton } from "@/components/MessageButton";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Grid3x3, Pencil, Plus, Settings2, Trash2, X, Check, ArrowUp, ArrowDown, Volume2, VolumeX } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getMemoryAlbum, getMemoryBook, saveAlbumSettings, updateMemoryPage, swapMemoryPages, deleteMemoryPage,
  getMyStories, addMemoryPage, getAccessList, setAccess, searchPeople,
  COVER_COLORS, type MemoryAlbum, type MemoryPage, type AccessPerson,
} from "@/lib/memoryAlbum";

const AUDIENCES = [
  { key: "profile", label: "Everyone who can view my profile" },
  { key: "followers", label: "Followers only" },
  { key: "custom", label: "Only people I choose" },
  { key: "only_me", label: "Only me" },
];

function postSticker(pg: any) {
  try { const arr = Array.isArray(pg?.stickers) ? pg.stickers : []; return arr.find((s: any) => s && s.kind === "post") || null; } catch { return null; }
}

function fmtDate(s: string | null) {
  if (!s) return "";
  return new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}


// A video page: plays muted on open (the phone starts muted too), one tap on
// the speaker toggles sound, and a Message pill opens a DM with the owner
// when you are looking at someone else's album.
function MemoryVideo({ src, poster, ownerId }: { src: string; poster?: string; ownerId: string }) {
  const [muted, setMuted] = useState(true);
  return (
    <div className="relative h-full w-full">
      <video src={src} poster={poster} controls playsInline muted={muted} className="h-full w-full object-contain" />
      <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-2">
        <button type="button" onClick={() => setMuted((v) => !v)} aria-label={muted ? "Unmute" : "Mute"} className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur hover:bg-white/30">
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <span className="pointer-events-auto [&>button]:border-0 [&>button]:bg-[#C9BFB0] [&>button]:px-3 [&>button]:py-1.5 [&>button]:text-[12px] [&>button]:text-[#0B1E3D]"><MessageButton profileId={ownerId} /></span>
      </div>
    </div>
  );
}

export function MemoryAlbumView({ ownerId: albumRef }: { ownerId: string }) {
  const ownerId = albumRef;
  const supabase = useRef(createClient()).current;
  const [album, setAlbum] = useState<MemoryAlbum | null>(null);
  const [likedPages, setLikedPages] = useState<Set<string>>(new Set());
  const [idx, setIdx] = useState(0);
  const [view, setView] = useState<"book" | "grid">("book");
  const [flip, setFlip] = useState(0);
  const [manage, setManage] = useState(false);
  const [adding, setAdding] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  const load = useCallback(() => {
    getMemoryBook(ownerId).then(setAlbum);
  }, [ownerId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUid(data.session?.user.id ?? null));
  }, [supabase]);
  // Seed the hearts with what this person already liked.
  useEffect(() => {
    if (!uid || !album) return;
    const ids = (((album as any).pages ?? []) as any[]).map((pg) => String(pg.story_id)).filter(Boolean);
    if (!ids.length) return;
    supabase.from("story_reactions").select("story_id").eq("user_id", uid).in("story_id", ids)
      .then(({ data }) => setLikedPages(new Set(((data ?? []) as any[]).map((r) => String(r.story_id)))));
  }, [uid, album, supabase]);

  const pages = useMemo(() => album?.pages ?? [], [album]);
  const page = pages[idx];
  const cover = COVER_COLORS[album?.cover_color ?? "blush"] ?? COVER_COLORS.blush;

  const go = useCallback((d: number) => {
    setIdx((i) => {
      const n = Math.min(Math.max(i + d, 0), Math.max(pages.length - 1, 0));
      if (n !== i) setFlip((f) => f + 1);
      return n;
    });
  }, [pages.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (!album) return <p className="py-24 text-center text-sm text-ink/40">Opening the album</p>;
  if (!album.is_owner && !album.can_view) {
    return (
      <div className="flex flex-col items-center gap-3 py-24">
        <p className="text-sm text-ink/50">This album is private.</p>
        <Link href="/home" className="rounded-md bg-pearl px-5 py-2 text-sm font-semibold text-ink">Back home</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-3 pb-16">
      <div className="sticky top-0 z-20 -mx-3 mb-4 flex items-center gap-2 border-b border-ink/10 bg-white/75 px-3 py-2.5 backdrop-blur-md">
        <button onClick={() => history.back()} className="rounded-full p-2 text-ink/60 hover:bg-black/5" aria-label="Back"><ArrowLeft size={18} /></button>
        <p className="min-w-0 flex-1 truncate font-display text-[17px] text-ink">{album.title}</p>
        <button onClick={() => setView(view === "book" ? "grid" : "book")} className="rounded-full bg-black/5 p-2 text-ink/70 hover:bg-black/10" title={view === "book" ? "Grid view" : "Book view"}>
          {view === "book" ? <Grid3x3 size={17} /> : <BookOpen size={17} />}
        </button>
        {album.is_owner ? (
          <>
            <button onClick={() => setAdding(true)} className="rounded-full bg-black/5 p-2 text-ink/70 hover:bg-black/10" title="Add memories"><Plus size={17} /></button>
            <button onClick={() => setManage(true)} className="rounded-full bg-black/5 p-2 text-ink/70 hover:bg-black/10" title="Album settings"><Settings2 size={17} /></button>
          </>
        ) : null}
      </div>

      {pages.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20">
          <p className="text-sm text-ink/50">{album.is_owner ? "Your album is waiting for its first memory." : "No memories here yet."}</p>
          {album.is_owner ? (
            <button onClick={() => setAdding(true)} className="rounded-md bg-pearl px-5 py-2 text-sm font-semibold text-ink">Add memories</button>
          ) : null}
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {pages.map((pg, i) => (
            <button key={pg.id} onClick={() => { setIdx(i); setView("book"); }} className="bg-white p-2 pb-7 text-left shadow-[0_1px_3px_rgba(22,24,28,0.12)] transition-transform hover:-translate-y-0.5" style={{ transform: "rotate(" + (i % 3 === 0 ? -1.5 : i % 3 === 1 ? 1 : 0) + "deg)" }}>
              <span className="relative block aspect-square overflow-hidden bg-ink/5">
                {pg.media_type === "video" ? (
                  <>
                    {pg.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={pg.thumbnail_url} alt="" className="h-full w-full object-cover" />
                    ) : <span className="block h-full w-full bg-ink/80" />}
                    <span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/45 p-2 text-white"><ChevronRight size={14} className="rotate-0" /></span></span>
                  </>
                ) : pg.media_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pg.media_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-[#0B1E3D] p-2">
                    <span className="line-clamp-4 text-center font-display text-[11px] leading-tight text-white">{pg.story_caption || (postSticker(pg) ? "Shared post" : "Memory")}</span>
                  </span>
                )}
              </span>
              <span className="mt-2 block truncate text-center font-display text-[12px] text-ink/70">{pg.caption || fmtDate(pg.taken_at)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div>
          <div className="flex justify-center" style={{ perspective: "1400px" }}>
            <div className="relative flex w-full max-w-[520px] rounded-2xl border border-ink/10 p-4 sm:p-6" style={{ background: cover.cover }}>
              <div className="flex w-6 flex-col items-center justify-center gap-5 pr-2">
                {[0, 1, 2, 3].map((r) => <span key={r} className="h-3 w-3 rounded-full border-2 bg-white/70" style={{ borderColor: cover.spine }} />)}
              </div>
              <div key={flip} className="flex-1 origin-left rounded-xl border border-ink/10 bg-[#FBF7EE] p-4 sm:p-5" style={{ animation: "pcflip 380ms ease-out" }}>
                {page ? (
                  <div className={page.style === "polaroid" ? "mx-auto max-w-[340px] rotate-[-1.5deg] border border-ink/10 bg-white p-2.5 pb-3" : ""}>
                    <div className={"relative overflow-hidden bg-ink " + (page.style === "polaroid" ? "aspect-[4/5]" : "aspect-[9/14] rounded-lg")}>
                      {page.media_type === "video" && page.media_url ? (
                        <MemoryVideo key={page.id} src={page.media_url} poster={page.thumbnail_url ?? undefined} ownerId={ownerId} />
                      ) : page.media_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={page.id} src={page.media_url} alt="" className="h-full w-full object-cover" />
                      ) : postSticker(page) ? ((): any => { const ps: any = postSticker(page); return (
                        <div className="flex h-full w-full flex-col justify-center gap-2 bg-[#101826] p-5">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-white/50">Shared post</p>
                          <p className="text-[15px] font-bold text-white">{ps.postAuthorName || "Post"}</p>
                          {ps.postText ? <p className="text-[13.5px] leading-snug text-white/85">{String(ps.postText).slice(0, 180)}</p> : null}
                          {ps.postMediaUrl && ps.postMediaType !== "video" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={ps.postMediaUrl} alt="" className="mt-1 max-h-[45%] w-full rounded-lg object-cover" />
                          ) : null}
                        </div>
                      ); })() : page.story_caption ? (
                        <div className="flex h-full w-full items-center justify-center bg-[#0B1E3D] p-6">
                          <p className="text-center font-display text-[19px] leading-relaxed text-white">{page.story_caption}</p>
                        </div>
                      ) : null}
                      {page.style === "polaroid" ? (
                        <span className="absolute -top-1 left-1/2 h-4 w-12 -translate-x-1/2 rotate-3" style={{ background: cover.spine, opacity: 0.85 }} />
                      ) : null}
                    </div>
                    <PageCaption key={page.id + "-cap"} page={page} isOwner={album.is_owner} onSaved={load} />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button onClick={() => go(-1)} disabled={idx === 0} className="rounded-full border border-ink/10 bg-white/80 p-2.5 text-ink/70 backdrop-blur disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={18} /></button>
            <span className="rounded-full border border-ink/10 bg-white/80 px-4 py-1.5 text-[13px] font-semibold text-ink/70 backdrop-blur">{idx + 1} / {pages.length}</span>
            <button onClick={() => { const sid = page && (page as any).story_id ? String((page as any).story_id) : null; if (!sid) return; setLikedPages(prev => { const n = new Set(prev); if (n.has(sid)) n.delete(sid); else n.add(sid); return n; }); void supabase.rpc("toggle_story_reaction", { p_story_id: sid, p_emoji: "\u2764\uFE0F" }); }} className={"rounded-full border border-ink/10 bg-white/80 p-2.5 backdrop-blur " + (page && likedPages.has(String((page as any).story_id)) ? "text-red-500" : "text-ink/40")} aria-label="Love this memory">{"\u2764"}</button>
            <button onClick={() => go(1)} disabled={idx >= pages.length - 1} className="rounded-full border border-ink/10 bg-white/80 p-2.5 text-ink/70 backdrop-blur disabled:opacity-30" aria-label="Next page"><ChevronRight size={18} /></button>
          </div>
          {album.is_owner && page ? (
            <div className="mt-3 flex items-center justify-center gap-2">
              <button onClick={async () => { const other = pages[idx - 1]; if (other) { await swapMemoryPages(page, other); setIdx(idx - 1); load(); } }} disabled={idx === 0} className="rounded-full bg-black/5 p-2 text-ink/60 disabled:opacity-30" title="Move earlier"><ArrowUp size={15} /></button>
              <button onClick={async () => { const other = pages[idx + 1]; if (other) { await swapMemoryPages(page, other); setIdx(idx + 1); load(); } }} disabled={idx >= pages.length - 1} className="rounded-full bg-black/5 p-2 text-ink/60 disabled:opacity-30" title="Move later"><ArrowDown size={15} /></button>
              <button onClick={async () => { await updateMemoryPage(page.id, { style: page.style === "polaroid" ? "full" : "polaroid" }); load(); }} className="rounded-full bg-black/5 px-3 py-1.5 text-[12px] font-semibold text-ink/60" title="Switch page style">{page.style === "polaroid" ? "Full page" : "Polaroid"}</button>
              <button onClick={async () => { if (confirm("Remove this memory from the album?")) { await deleteMemoryPage(page.id); setIdx(Math.max(0, idx - 1)); load(); } }} className="rounded-full bg-black/5 p-2 text-ink/60 hover:text-red-600" title="Remove page"><Trash2 size={15} /></button>
            </div>
          ) : null}
        </div>
      )}

      {adding && album.is_owner ? <AddMemories albumId={ownerId} onClose={() => { setAdding(false); load(); }} existing={pages} /> : null}
      {manage && album.is_owner ? <ManageAlbum album={album} onClose={() => { setManage(false); load(); }} /> : null}
      <style jsx global>{"@keyframes pcflip { from { transform: rotateY(-62deg); opacity: 0.4; } to { transform: rotateY(0deg); opacity: 1; } }"}</style>
    </div>
  );
}

function PageCaption({ page, isOwner, onSaved }: { page: MemoryPage; isOwner: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(page.caption ?? "");
  if (editing) {
    return (
      <span className="mt-2 flex items-center gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={60} placeholder="Write a caption"
          className="min-w-0 flex-1 border-b border-ink/20 bg-transparent px-1 py-1 text-center font-display text-[13px] text-ink outline-none" />
        <button onClick={async () => { await updateMemoryPage(page.id, { caption: text.trim() || null }); setEditing(false); onSaved(); }} className="rounded-full bg-pearl p-1.5 text-ink" aria-label="Save caption"><Check size={13} /></button>
      </span>
    );
  }
  return (
    <span className="mt-2 flex items-center justify-center gap-1.5">
      <span className="truncate text-center font-display text-[13px] text-ink/75">
        {page.caption || fmtDate(page.taken_at)}
      </span>
      {isOwner ? <button onClick={() => setEditing(true)} className="text-ink/35 hover:text-ink/70" aria-label="Edit caption"><Pencil size={12} /></button> : null}
    </span>
  );
}

function AddMemories({ albumId, onClose, existing }: { albumId: string; onClose: () => void; existing: MemoryPage[] }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getMyStories>>>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { getMyStories().then(setRows); }, []);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={onClose}>
      <div className="max-h-[86vh] w-full max-w-[560px] overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-display text-[16px] text-ink">Add memories</p>
          <button onClick={onClose} className="rounded-full p-1.5 text-ink/50 hover:bg-black/5" aria-label="Close"><X size={17} /></button>
        </div>
        <p className="mb-3 text-[12px] text-ink/50">Every story you have ever posted. Pick the ones worth keeping.</p>
        {rows.length === 0 ? <p className="py-10 text-center text-sm text-ink/40">No stories yet.</p> : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {rows.map((s) => {
              const taken = existing.some((p) => (p as MemoryPage & { story_id?: string }).id && p.media_url === s.media_url);
              const on = picked.has(s.id);
              return (
                <button key={s.id} disabled={taken} onClick={() => setPicked((prev) => { const n = new Set(prev); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}
                  className={"relative aspect-[9/14] overflow-hidden rounded-lg border " + (on ? "border-ink" : "border-ink/10") + (taken ? " opacity-35" : "")}>
                  {s.media_type === "video" && s.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.thumbnail_url} alt="" className="h-full w-full object-cover" />
                  ) : s.media_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.media_url} alt="" className="h-full w-full object-cover" />
                  ) : <span className="block h-full w-full bg-ink/10" />}
                  {on ? <span className="absolute right-1 top-1 rounded-full bg-ink p-1 text-white"><Check size={11} /></span> : null}
                  {taken ? <span className="absolute inset-x-0 bottom-0 bg-white/85 py-0.5 text-center text-[10px] font-semibold text-ink/60">In album</span> : null}
                </button>
              );
            })}
          </div>
        )}
        <button disabled={picked.size === 0 || busy}
          onClick={async () => { setBusy(true); for (const id of picked) { await addMemoryPage(id, albumId); } setBusy(false); onClose(); }}
          className="mt-4 w-full rounded-md bg-pearl py-2.5 text-sm font-semibold text-ink disabled:opacity-40">
          {busy ? "Adding" : picked.size === 0 ? "Pick stories to add" : "Add " + picked.size + (picked.size === 1 ? " memory" : " memories")}
        </button>
      </div>
    </div>
  );
}

function ManageAlbum({ album, onClose }: { album: MemoryAlbum; onClose: () => void }) {
  const [title, setTitle] = useState(album.title);
  const [color, setColor] = useState(album.cover_color);
  const [audience, setAudience] = useState(album.audience);
  const [allow, setAllow] = useState<AccessPerson[]>([]);
  const [block, setBlock] = useState<AccessPerson[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AccessPerson[]>([]);
  const [mode, setMode] = useState<"allow" | "block">("block");

  useEffect(() => { getAccessList("allow").then(setAllow); getAccessList("block").then(setBlock); }, []);
  useEffect(() => {
    const t = setTimeout(() => { searchPeople(q).then(setResults); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const list = mode === "allow" ? allow : block;
  const setList = mode === "allow" ? setAllow : setBlock;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-[520px] overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-display text-[16px] text-ink">Album settings</p>
          <button onClick={onClose} className="rounded-full p-1.5 text-ink/50 hover:bg-black/5" aria-label="Close"><X size={17} /></button>
        </div>

        <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Title</p>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={30}
          className="mb-4 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />

        <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Cover color</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {Object.entries(COVER_COLORS).map(([key, c]) => (
            <button key={key} onClick={() => setColor(key)}
              className={"h-9 w-9 rounded-full border-2 " + (color === key ? "border-ink" : "border-ink/10")}
              style={{ background: c.cover }} title={key} aria-label={key}>
              <span className="mx-auto block h-4 w-1.5 rounded" style={{ background: c.spine }} />
            </button>
          ))}
        </div>

        <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink/40">Who can open it</p>
        <div className="mb-4 flex flex-col gap-1.5">
          {AUDIENCES.map((a) => (
            <button key={a.key} onClick={() => setAudience(a.key)}
              className={"flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-[13px] " + (audience === a.key ? "border-ink bg-black/[0.03] font-semibold text-ink" : "border-ink/10 text-ink/70")}>
              {a.label}
              {audience === a.key ? <Check size={15} /> : null}
            </button>
          ))}
        </div>

        <div className="mb-1.5 flex items-center gap-2">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink/40">People</p>
          <button onClick={() => setMode("block")} className={"rounded-full px-2.5 py-1 text-[11px] font-semibold " + (mode === "block" ? "bg-ink text-white" : "bg-black/5 text-ink/60")}>Hidden from</button>
          <button onClick={() => setMode("allow")} className={"rounded-full px-2.5 py-1 text-[11px] font-semibold " + (mode === "allow" ? "bg-ink text-white" : "bg-black/5 text-ink/60")}>Chosen people</button>
        </div>
        <p className="mb-2 text-[11px] text-ink/45">{mode === "block" ? "These people never see the album, whatever the audience." : "Used when the audience is set to only people I choose."}</p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people"
          className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/40" />
        {results.length > 0 ? (
          <div className="mb-2 flex flex-col gap-1">
            {results.map((r) => (
              <button key={r.id} onClick={async () => { if (await setAccess(r.id, mode, true)) { setList([...list.filter((x) => x.id !== r.id), r]); setQ(""); setResults([]); } }}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/5">
                {r.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(r.avatar_url, 100) ?? r.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pearl text-[11px] font-semibold text-ink">{(r.full_name ?? "?").charAt(0)}</span>}
                <span className="text-[13px] text-ink">{r.full_name} <span className="text-ink/40">@{r.username}</span></span>
                <Plus size={14} className="ml-auto text-ink/40" />
              </button>
            ))}
          </div>
        ) : null}
        {list.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            {r.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displayImageUrl(r.avatar_url, 100) ?? r.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pearl text-[11px] font-semibold text-ink">{(r.full_name ?? "?").charAt(0)}</span>}
            <span className="text-[13px] text-ink">{r.full_name}</span>
            <button onClick={async () => { if (await setAccess(r.id, mode, false)) setList(list.filter((x) => x.id !== r.id)); }} className="ml-auto rounded-full p-1 text-ink/40 hover:text-red-600" aria-label="Remove"><X size={14} /></button>
          </div>
        ))}

        <button onClick={async () => { await saveAlbumSettings(title.trim() || "Memories", color, audience); onClose(); }}
          className="mt-4 w-full rounded-md bg-pearl py-2.5 text-sm font-semibold text-ink">Save album</button>
      </div>
    </div>
  );
}