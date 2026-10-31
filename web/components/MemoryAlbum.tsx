"use client";
import { SoundtrackPicker } from './SoundtrackPicker';

import { MessageButton } from "@/components/MessageButton";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { displayImageUrl } from "@/lib/media";
import Link from "next/link";
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Grid3x3, Pencil, Plus, Settings2, Trash2, X, Check, ArrowUp, ArrowDown, Volume2, VolumeX, Play, Pause } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getMemoryBook, updateMemoryPage, swapMemoryPages, deleteMemoryPage,
  getMyStories, addMemoryPage, getAccessList, setAccess, searchPeople,
  COVER_COLORS, getMemoryBooks, type MemoryBookInfo, type MemoryAlbum, type MemoryPage, type AccessPerson,
} from "@/lib/memoryAlbum";

import { memoryArtwork, memoryCoverMedia, memoryCoverPage, MEMORY_FEATURED_DESIGNS as MEMORY_DESIGNS } from '../../shared/memoryBookDesign';
import { MemoryBookCover, ResponsiveMemoryBookCover } from './memory/MemoryBookCover';
import { MemoryStoryPreview } from './memory/MemoryStoryPreview';
import { MemoryPageImage } from './memory/MemoryPageImage';
import { MemoryFilm } from './memory/MemoryFilm';
import {MemoryCoverControls,MemoryFilmControls} from './memory/MemoryCreativeControls';
import {memoryCoverArtwork,memoryFilmSettings,memoryCreativeSaveError} from '../../shared/memoryBookCreative';
import {saveMemoryCreativeBook} from '../../shared/memoryBookPersistence';
import {MemoryPageTurn,MemoryTurnPreview,type MemoryPageTurnHandle} from './memory/MemoryPageTurn';
import {useMemoryDialog} from './memory/useMemoryDialog';
import { PostSoundtrack } from './PostSoundtrack';
import { MemoryStoryFrame } from './memory/MemoryStoryFrame';
import { memoryStoryRecipe, memoryStorySeek, memoryStoryStickers } from '../../shared/memoryStoryPresentation';

import { memoryPageSoundtrack } from '../../shared/memoryFilm';
import { memoryPhotoDuration } from '../../shared/memoryPlayback';
import { useMemoryPlayback } from '@/lib/useMemoryPlayback';
import { createMemorySoundtrackSaveHook } from '../../shared/useMemorySoundtrackSave';
const useMemorySoundtrackSave = createMemorySoundtrackSaveHook({ useEffect, useRef, useState });

const AUDIENCES = [
  { key: "profile", label: "Everyone who can view my profile" },
  { key: "followers", label: "Followers only" },
  { key: "custom", label: "Only people I choose" },
  { key: "only_me", label: "Only me" },
];

function postSticker(pg: MemoryPage) {
  try { const arr = memoryStoryStickers(pg?.stickers); return arr.find((s) => s && s.kind === "post") || null; } catch { return null; }
}

function fmtDate(s: string | null) {
  if (!s) return "";
  return new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}


// A video page: plays muted on open (the phone starts muted too), one tap on
// the speaker toggles sound, and a Message pill opens a DM with the owner
// when you are looking at someone else's album.
function MemoryVideo({ src, poster, page, ownerId, active, onRetry, onEnd, onProgress }: { src: string; poster?: string; page: MemoryPage; ownerId: string; active: boolean; onRetry: () => void; onEnd?:()=>void; onProgress?:(progress:number)=>void }) {
  const recipe=memoryStoryRecipe(page.media_transform);
  const [clock,setClock]=useState(recipe.start);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const ref=useRef<HTMLVideoElement|null>(null),resumeAfterTurn=useRef(false);
  const playbackWindow=useRef(recipe);
  const completion=useRef({onEnd,onProgress,done:false});useLayoutEffect(()=>{completion.current.onEnd=onEnd;completion.current.onProgress=onProgress;},[onEnd,onProgress]);
  const finish=(video:HTMLVideoElement)=>{if(!completion.current.onEnd)return false;video.pause();if(!completion.current.done){completion.current.done=true;completion.current.onProgress?.(1);completion.current.onEnd();}return true;};
  const advancesOnEnd=!!onEnd;
  useEffect(()=>{completion.current.done=false;},[src,advancesOnEnd]);
  useEffect(()=>{if(advancesOnEnd&&active){const video=ref.current;if(video&&!document.hidden&&document.documentElement.dataset.platinumCallActive!=='true')void video.play().catch(()=>{});}},[src,active,advancesOnEnd]);
  const configure=useCallback((video:HTMLVideoElement,seek=false)=>{const window=memoryStoryRecipe(page.media_transform,video.duration);playbackWindow.current=window;video.playbackRate=window.speed;video.volume=window.volume;if(window.volume===0)video.muted=true;if(seek||memoryStorySeek(video.currentTime,window)!=null){try{video.currentTime=window.start;}catch{}}},[page.media_transform]);
  useEffect(()=>{const video=ref.current;if(video)configure(video,true);},[src,configure]);
  // timeupdate can be hundreds of milliseconds apart. Guard the excerpt on
  // decoded frames, while keeping the same video element and pause intent.
  useEffect(()=>{
    const video=ref.current;if(!video||!active)return;
    let disposed=false,frame:number|null=null;
    const nativeFrames=typeof video.requestVideoFrameCallback==='function';
    const cancel=()=>{if(frame!=null){if(nativeFrames)video.cancelVideoFrameCallback(frame);else cancelAnimationFrame(frame);frame=null;}};
    const tick=()=>{frame=null;if(disposed||video.paused||document.hidden||document.documentElement.dataset.platinumCallActive==='true')return;const window=playbackWindow.current;if(window.end!=null&&video.currentTime>=window.end-.025&&finish(video))return;const seek=memoryStorySeek(video.currentTime,window);if(seek!=null){video.currentTime=seek;setClock(seek);}schedule();};
    const schedule=()=>{if(!disposed&&frame==null&&!video.paused)frame=nativeFrames?video.requestVideoFrameCallback(tick):requestAnimationFrame(tick);};
    video.addEventListener('play',schedule);video.addEventListener('pause',cancel);schedule();
    return()=>{disposed=true;cancel();video.removeEventListener('play',schedule);video.removeEventListener('pause',cancel);};
  },[src,active,recipe.start,recipe.end]);
  useEffect(()=>{const video=ref.current;if(!video)return;if(!active){resumeAfterTurn.current=!video.paused;video.pause();}else if(resumeAfterTurn.current&&!document.hidden&&document.documentElement.dataset.platinumCallActive!=='true'){resumeAfterTurn.current=false;void video.play().catch(()=>{});}},[active]);
  useEffect(()=>{const stop=()=>ref.current?.pause();const hidden=()=>{if(document.hidden)stop();};window.addEventListener("platinum:stop-media",stop);document.addEventListener("visibilitychange",hidden);return()=>{stop();window.removeEventListener("platinum:stop-media",stop);document.removeEventListener("visibilitychange",hidden);};},[]);
  if(!src||failed)return <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#0B1E3D] p-4 text-center text-sm text-white"><p>This memory video could not play.</p><button type="button" className="min-h-11 rounded-full border border-white/35 px-4 py-2 font-semibold" onClick={()=>{setFailed(false);onRetry();}}>Retry memory video</button></div>;
  return (
    <div className="relative h-full w-full">
      <MemoryStoryFrame page={page} clock={clock}>{style=><video ref={ref} src={src} poster={poster} controls playsInline loop={!onEnd} muted={muted||recipe.volume===0} onError={()=>setFailed(true)} onLoadedMetadata={event=>{configure(event.currentTarget,true);setClock(recipe.start);}} onPlay={event=>{if(!active||document.hidden||document.documentElement.dataset.platinumCallActive==='true')event.currentTarget.pause();else configure(event.currentTarget);}} onTimeUpdate={event=>{const video=event.currentTarget;if(!active)return;const window=playbackWindow.current;if(window.end!=null)completion.current.onProgress?.(Math.max(0,Math.min(1,(video.currentTime-window.start)/(window.end-window.start))));if(window.end!=null&&video.currentTime>=window.end-.025&&finish(video))return;const seek=memoryStorySeek(video.currentTime,window);if(seek!=null)video.currentTime=seek;setClock(seek??video.currentTime);}} onEnded={event=>{if(active)finish(event.currentTarget);}} onSeeking={event=>{if(active)configure(event.currentTarget);}} style={style} className="h-full w-full object-contain" />}</MemoryStoryFrame>
      <div className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-2">
        <button type="button" disabled={recipe.volume===0} onClick={() => setMuted((v) => !v)} aria-label={recipe.volume===0?"Original video sound is off":muted ? "Unmute original video sound" : "Mute original video sound"} className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur hover:bg-white/30">
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <span className="pointer-events-auto [&>button]:border-0 [&>button]:bg-[#C9BFB0] [&>button]:px-3 [&>button]:py-1.5 [&>button]:text-[12px] [&>button]:text-[#0B1E3D]"><MessageButton profileId={ownerId} /></span>
      </div>
    </div>
  );
}

export function MemoryAlbumView(props: { ownerId: string }) {
  return <MemoryAlbumController key={props.ownerId} {...props}/>;
}
function MemoryAlbumController({ ownerId: albumRef }: { ownerId: string }) {
  const ownerId = albumRef;
  const [supabase] = useState(createClient);
  const [album, setAlbum] = useState<MemoryAlbum | null>(null);
  const [likedPages, setLikedPages] = useState<Set<string>>(new Set());
  const [requestedIndex, setIdx] = useState(0);
  const [playMode, setPlayMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [filmVisible, setFilmVisible] = useState(false);
  const playRun = 0;
  const [foreground, setForeground] = useState(true);
  const [readyPage, setReadyPage] = useState('');
  const [videoPlayback, setVideoPlayback] = useState({ page: '', progress: 0 });
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const motion=()=>setReduceMotion(media.matches);motion();media.addEventListener('change',motion);const visibility=()=>setForeground(!document.hidden);visibility();document.addEventListener('visibilitychange',visibility);const stop=()=>setPlaying(false);window.addEventListener('platinum:stop-media',stop);return()=>{media.removeEventListener('change',motion);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('platinum:stop-media',stop);};},[]);
  const [view, setView] = useState<"cover" | "book" | "grid">("cover");
  const pageTurn=useRef<MemoryPageTurnHandle>(null);
  const [turning,setTurning]=useState(false);
  const [mediaAttempt, setMediaAttempt] = useState(0);
  const [manage, setManage] = useState(false);
  const [musicOpen,setMusicOpen]=useState(false);
  const [adding, setAdding] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [nextBook, setNextBook] = useState<MemoryBookInfo | null>(null);
  const [uid, setUid] = useState<string | null>(null);

  const loadGeneration = useRef(0);
  const soundtrackSave = useMemorySoundtrackSave({ client: supabase, owner: uid, book: album?.id ?? ownerId,
    route: ownerId, canEdit: album?.is_owner === true,
    onConfirmed: (id, selection) => {
      loadGeneration.current += 1;
      setAlbum(previous => previous?.id === id && previous.is_owner ? { ...previous, soundtrack: selection } : previous);
    },
  });
  const reactionLock=useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!uid) return;
    try {
      const next = await getMemoryBook(ownerId);
      if (generation !== loadGeneration.current) return;
      setAlbum(next); setLoadError(next ? null : "This album is unavailable.");
    } catch {
      if (generation !== loadGeneration.current) return;
      setAlbum(null); setLoadError("The album could not load. Please retry.");
    }
  }, [ownerId, uid]);

  useEffect(() => {
    let live = true;
    queueMicrotask(()=>{if(live)void load();});
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = setInterval(refresh, 240000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { live=false; loadGeneration.current += 1; clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  useEffect(() => {
    let alive = true, authVersion = 0, viewer: string | null = null;
    const apply = (next: string | null) => {
      if (!alive) return;
      if (viewer !== next) { loadGeneration.current += 1; setAlbum(null); setLikedPages(new Set()); setManage(false); setAdding(false); setIdx(0); setFilmVisible(false); }
      viewer = next; setUid(next); setLoadError(next ? null : "Sign in to view this album.");
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { authVersion++; apply(session?.user.id ?? null); });
    const initial = authVersion;
    void supabase.auth.getSession().then(({ data }) => { if (initial === authVersion) apply(data.session?.user.id ?? null); }).catch(() => { if (alive && initial === authVersion) setLoadError("Your account could not load. Please retry."); });
    return () => { alive = false; loadGeneration.current += 1; subscription.unsubscribe(); };
  }, [supabase]);
  useEffect(() => { let live=true; if(!album?.user_id)return; void getMemoryBooks(album.user_id).then(shelf=>{if(!live)return;const at=shelf.books.findIndex(b=>b.id===album.id);setNextBook(at>=0?shelf.books[at+1]??null:null);}).catch(()=>{});return()=>{live=false;}; }, [album?.id,album?.user_id]);
  // Seed the hearts with what this person already liked.
  useEffect(() => {
    if (!uid || !album) return;
    let alive = true;
    const generation=loadGeneration.current;
    const ids = (album.pages ?? []).map((pg) => pg.story_id).filter(id=>typeof id==='string'&&id.length>0);
    if (!ids.length) return;
    supabase.from("story_reactions").select("story_id").eq("user_id", uid).in("story_id", ids)
      .then(({ data }) => {if(alive&&generation===loadGeneration.current)setLikedPages(new Set((data ?? []).map((r) => String(r.story_id))));});
    return()=>{alive=false;};
  }, [uid, album, supabase]);

  const pages = useMemo(() => album?.pages ?? [], [album]);
  const idx = Math.min(requestedIndex, Math.max(0, pages.length - 1));
  const page = pages[idx];
  const artwork = memoryArtwork(album?.cover_design, album?.cover_color);

  const go = useCallback((d: number) => {pageTurn.current?.turn(d<0?-1:1);}, []);
  const finishPage=useCallback(()=>{if(idx>=pages.length-1)setPlaying(false);else pageTurn.current?.turn(1);},[idx,pages.length]);
  const movieActive=playMode&&playing&&foreground&&view==='book'&&!filmVisible&&!turning&&!manage&&!adding;
  const photoProgress=useMemoryPlayback(`${album?.id}:${page?.id}:${playRun}`,movieActive&&page?.media_type!=='video'&&(!page?.media_url||readyPage===page?.id),memoryPhotoDuration(page),finishPage);
  const videoProgress = videoPlayback.page === page?.id ? videoPlayback.progress : 0;
  const openBook=()=>{setPlayMode(false);setPlaying(false);setView('book');};
  const closeBook=()=>{setPlaying(false);setPlayMode(false);setView('cover');};
  const playBook=()=>{setPlaying(false);setPlayMode(false);setFilmVisible(true);};

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if(manage||adding||filmVisible||view!=='book')return;
      if ((e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable=true]")) return;
      if (e.key === "ArrowRight") {e.preventDefault();go(1);}
      if (e.key === "ArrowLeft") {e.preventDefault();go(-1);}
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go,manage,adding,view,filmVisible]);

  const retryMedia=()=>{setMediaAttempt(value=>value+1);void load();};

  if (!album) return <div className="py-24 text-center text-sm text-muted"><p>{loadError ?? "Opening the album"}</p>{loadError && <button className="mt-3 underline" onClick={() => void load()}>Retry</button>}</div>;
  if (!album.is_owner && !album.can_view) {
    return (
      <div className="flex flex-col items-center gap-3 py-24">
        <p className="text-sm text-muted">This album is private.</p>
        <Link href="/home" className="rounded-md bg-pearl px-5 py-2 text-sm font-semibold text-on-pearl">Back home</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-3 pb-16">
      <div className="sticky top-0 z-20 -mx-3 mb-4 flex items-center gap-2 border-b border-ink/10 bg-[var(--chrome-glass)] px-3 py-2.5 backdrop-blur-md">
        <button onClick={() => view==='cover'?history.back():closeBook()} className="rounded-full p-2 text-ink/60 hover:bg-black/5" aria-label="Back"><ArrowLeft size={18} /></button>
        <p className="min-w-0 flex-1 truncate text-center font-display text-[23px] text-ink">{album.title}</p>
        {view!=="cover"&&<button onClick={() => setView(view === "book" ? "grid" : "book")} className="min-h-11 min-w-11 rounded-full p-2 text-ink/70 hover:bg-black/10" aria-label={view === "book" ? "View all pages" : "Read book"}>
          {view === "book" ? <Grid3x3 size={19} /> : <BookOpen size={19} />}
        </button>}
        {album.is_owner ? (
          <>
            <button onClick={() => setAdding(true)} className="rounded-full bg-black/5 p-2 text-ink/70 hover:bg-black/10" title="Add memories"><Plus size={17} /></button>
            <button type="button" aria-label="Book soundtrack" disabled={soundtrackSave.busy || soundtrackSave.needsConfirmation} onClick={()=>setMusicOpen(true)} className="min-h-11 rounded-full border border-ink/15 px-3 text-sm disabled:opacity-50">Music</button>
            <button onClick={() => setManage(true)} className="rounded-full bg-black/5 p-2 text-ink/70 hover:bg-black/10" title="Album settings"><Settings2 size={17} /></button>
          </>
        ) : null}
      </div>

      {musicOpen&&uid&&album.is_owner?<SoundtrackPicker value={soundtrackSave.draft ? soundtrackSave.draft.selection : album.soundtrack??null} use="memory_album" ownerId={uid} originalAudio={false} onClose={()=>setMusicOpen(false)} onChange={selection=>{void soundtrackSave.save(selection);}}/>:null}
      {soundtrackSave.busy ? <p role="status" className="mb-3 text-sm text-muted">{soundtrackSave.draft?.retry === 'check' ? 'Checking saved soundtrack…' : 'Saving soundtrack…'}</p> : soundtrackSave.error ? <div className="mb-3 text-sm"><p role="alert" className="text-danger">{soundtrackSave.error}</p><button type="button" className="min-h-11 underline" onClick={()=>void soundtrackSave.retry()}>{soundtrackSave.needsConfirmation ? 'Check saved music' : 'Retry soundtrack save'}</button></div> : soundtrackSave.notice ? <p role="status" className="mb-3 text-sm text-muted">{soundtrackSave.notice}</p> : null}
      <PostSoundtrack key={album.id} selection={album.soundtrack} use="memory_album" active={view==='book'&&foreground&&!filmVisible&&(!playMode||playing)&&!manage&&!adding&&!musicOpen} autoPlay={playMode} controls={!playMode} className="mb-3" />
      {filmVisible && pages.length > 0 && <MemoryFilm key={`${album.id}:${uid}`} bookId={album.id} revision={album.presentation_revision} filmSettings={album.film_settings} title={album.title} pages={pages} soundtrack={album.soundtrack} reduceMotion={reduceMotion} onClose={() => setFilmVisible(false)} onReadBook={() => { setFilmVisible(false); openBook(); }} onRetry={retryMedia} />}
      {mutationError&&<p role="alert" className="mb-3 text-sm text-danger">{mutationError}</p>}
      {view === "cover" ? (
        <section className="mx-auto flex max-w-[360px] flex-col items-center px-5 pb-8 pt-8 sm:pt-10">
          <button type="button" aria-label={'Open '+album.title} onClick={openBook} className="w-full max-w-[300px] text-left transition-transform hover:-translate-y-1"><ResponsiveMemoryBookCover artwork={album.cover_artwork} title={album.title} subtitle={album.subtitle} color={album.cover_color} design={album.cover_design} {...memoryCoverMedia(album.cover_page??memoryCoverPage(pages,album.cover_story_id))}/></button>
          {album.subtitle&&<p className="mt-7 text-center font-display text-[23px] leading-tight text-ink">{album.subtitle}</p>}
          <p className="mt-3 text-sm text-muted">{pages.length} {pages.length===1?'memory':'memories'}</p>
          <button onClick={openBook} className="mt-7 min-h-12 w-full rounded-2xl bg-[#142642] px-6 py-3 font-display text-[23px] text-[#FFFFFF]">Open book</button>
          {pages.length>0&&<button type="button" onClick={playBook} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-ink/20 px-6 py-3 font-semibold text-ink"><Play size={18}/>Play memories</button>}
          {album.is_owner&&<button onClick={()=>setAdding(true)} className="mt-3 min-h-12 w-full rounded-2xl border border-ink/15 px-6 py-3 text-sm text-ink">+ Add memories</button>}
        </section>
      ) : pages.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20">
          <p className="text-sm text-muted">{album.is_owner ? "Your album is waiting for its first memory." : "No memories here yet."}</p>
          {album.is_owner ? (
            <button onClick={() => setAdding(true)} className="rounded-md bg-pearl px-5 py-2 text-sm font-semibold text-on-pearl">Add memories</button>
          ) : null}
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {pages.map((pg, i) => (
            <button key={pg.id} aria-label={pg.caption||pg.story_caption||`Memory ${i+1}, ${fmtDate(pg.taken_at)}`} onClick={() => { setIdx(i); setView("book"); }} className="border-l-[6px] bg-[#FBF7EE] p-3 pb-5 text-left shadow-[0_3px_10px_rgba(22,24,28,0.1)] transition-transform hover:-translate-y-0.5" style={{borderLeftColor:artwork.spine}}>
              <span className="mb-3 block text-center font-display text-[10px] text-[#6F614A]">{String(i+1).padStart(2,'0')}</span><span className="relative block aspect-[4/5] overflow-hidden bg-ink/5">
                <MemoryStoryPreview key={[pg.id,pg.media_url,pg.thumbnail_url,mediaAttempt].join(':')} story={{...pg,caption:pg.story_caption||pg.caption,stickers_json:pg.stickers}}/>
              </span>
              <span className="mt-2 block truncate text-center font-display text-[12px] text-[#5a5140]">{pg.caption || fmtDate(pg.taken_at)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div>
          <MemoryPageTurn ref={pageTurn} key={album.id} pageIds={pages.map(p=>p.id)} index={idx} active={view==='book'&&!manage&&!adding&&!musicOpen} spine={artwork.spine} title={album.title} onCommit={setIdx} onTurningChange={setTurning} renderPreview={i=><MemoryTurnPreview page={pages[i]??{}} index={i}/>}>
                <p className="mb-4 text-center font-display text-[11px] tracking-widest text-[#6F614A]">{String(idx+1).padStart(2,'0')} ─</p>
                {page ? (
                  <div className={"flex min-h-0 flex-1 flex-col "+(page.style === "polaroid" ? "border border-[#DCD4C7] bg-[#FFFCF6] p-1.5 pb-3" : "")}>
                    <div className="media-frame relative min-h-0 flex-1 overflow-hidden bg-ink">
                      {page.media_type === "video" && (page.media_url || !postSticker(page)) ? (
                        <MemoryVideo key={[page.id,page.media_url,mediaAttempt,playRun].join(':')} src={page.media_url ?? ''} poster={page.thumbnail_url ?? undefined} page={page} ownerId={album.user_id ?? ownerId} active={view==='book'&&foreground&&!filmVisible&&(!playMode||playing)&&!turning&&!manage&&!adding&&!musicOpen} onRetry={retryMedia} onEnd={playMode?finishPage:undefined} onProgress={progress=>setVideoPlayback({page:page.id,progress})} />
                      ) : page.media_url || page.thumbnail_url || (page.media_type === "image" && !postSticker(page)) ? (
                        <MemoryStoryFrame key={[page.id,page.media_url,page.thumbnail_url,mediaAttempt,playRun].join(':')} page={page}>{style=><MemoryPageImage src={page.media_url} poster={page.thumbnail_url} style={{...style,transform:`${style.transform||''} scale(${playMode&&!reduceMotion?1+photoProgress*.06:1})`,transition:reduceMotion?'none':'transform .15s linear'}} onRetry={retryMedia} onReady={()=>setReadyPage(page.id)} />}</MemoryStoryFrame>
                      ) : postSticker(page) ? (() => { const ps = postSticker(page)!; return (
                        <div className="flex h-full w-full flex-col justify-center gap-2 bg-[#101826] p-5">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-white/50">Shared post</p>
                          <p className="text-[15px] font-bold text-white">{ps.postAuthorName || "Post"}</p>
                          {ps.postText ? <p className="text-[13.5px] leading-snug text-white/85">{String(ps.postText).slice(0, 180)}</p> : null}
                          {ps.postMediaUrl && ps.postMediaType !== "video" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={ps.postMediaUrl} alt="" className="mt-1 max-h-[45%] w-full rounded-lg object-contain" />
                          ) : null}
                          {ps.postId&&<Link href={"/post/"+ps.postId} className="mt-2 rounded-full bg-white/15 px-3 py-2 text-center text-sm text-white">View full post</Link>}
                        </div>
                      ); })() : (
                        <MemoryStoryFrame key={page.id} page={page}>{()=> <div className="flex h-full w-full items-center justify-center p-6">
                          <p className="text-center font-display text-[19px] leading-relaxed text-white">{page.story_caption}</p>
                        </div>}</MemoryStoryFrame>
                      )}
                    </div>
                    <PageCaption key={page.id + "-cap"} page={page} isOwner={album.is_owner&&!movieActive} onSaved={load} />
                  </div>
                ) : null}
          </MemoryPageTurn>
          {playMode&&<div role="progressbar" aria-label="Memory playback" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((page?.media_type==='video'?videoProgress:photoProgress)*100)} className="mx-auto mt-4 h-1 max-w-[440px] overflow-hidden rounded-full bg-ink/15"><div className="h-full bg-ink transition-[width] duration-100" style={{width:`${(page?.media_type==='video'?videoProgress:photoProgress)*100}%`}}/></div>}
          <div className="mt-4 flex items-center justify-center gap-3">
            <button onClick={() => go(-1)} disabled={turning||idx === 0} className="min-h-11 min-w-11 rounded-full border border-ink/10 bg-[var(--canvas)] p-2.5 text-ink/70 backdrop-blur disabled:opacity-30" aria-label="Previous page"><ChevronLeft size={18} /></button>
            <button type="button" aria-label="Play continuous memory film" onClick={playBook} className="min-h-11 min-w-11 rounded-full border border-ink/15 p-2.5 text-ink">{playMode&&playing?<Pause size={18}/>:<Play size={18}/>}</button>
            <span aria-live="polite" aria-atomic="true" className="rounded-full border border-ink/10 bg-[var(--canvas)] px-4 py-1.5 text-[13px] font-semibold text-ink/70 backdrop-blur">{idx + 1} / {pages.length}</span>
            <button onClick={async () => {const sid=page?.story_id;if(!sid||reactionLock.current)return;reactionLock.current=true;const generation=loadGeneration.current;try{const {data,error}=await supabase.rpc('toggle_story_reaction',{p_story_id:sid,p_emoji:'❤️'});if(error)throw error;if(generation===loadGeneration.current)setLikedPages(prev=>{const next=new Set(prev);if(data?.reacted)next.add(sid);else next.delete(sid);return next;});}catch{setMutationError('Your reaction could not save. Retry.');}finally{reactionLock.current=false;}}} className={"rounded-full border border-ink/10 bg-[var(--canvas)] p-2.5 backdrop-blur " + (page && likedPages.has(String(page.story_id)) ? "text-danger" : "text-muted")} aria-label="Love this memory">{"\u2764"}</button>
            <button onClick={() => go(1)} disabled={turning||idx >= pages.length - 1} className="min-h-11 min-w-11 rounded-full border border-ink/10 bg-[var(--canvas)] p-2.5 text-ink/70 backdrop-blur disabled:opacity-30" aria-label="Next page"><ChevronRight size={18} /></button>
          </div>
          {album.is_owner && page ? (
            <div className="mt-3 flex items-center justify-center gap-2">
              <button onClick={async () => { const other = pages[idx - 1]; if (other) { if(await swapMemoryPages(page, other)){ setIdx(idx - 1); load(); }else setMutationError("Page order could not save. Retry."); } }} disabled={turning||idx === 0} className="rounded-full bg-black/5 p-2 text-ink/60 disabled:opacity-30" title="Move earlier"><ArrowUp size={15} /></button>
              <button onClick={async () => { const other = pages[idx + 1]; if (other) { if(await swapMemoryPages(page, other)){ setIdx(idx + 1); load(); }else setMutationError("Page order could not save. Retry."); } }} disabled={turning||idx >= pages.length - 1} className="rounded-full bg-black/5 p-2 text-ink/60 disabled:opacity-30" title="Move later"><ArrowDown size={15} /></button>
              <button disabled={turning} onClick={async () => { if(await updateMemoryPage(page.id, { style: page.style === "polaroid" ? "full" : "polaroid" }))load();else setMutationError("Page style could not save. Retry."); }} className="rounded-full bg-black/5 px-3 py-1.5 text-[12px] font-semibold text-ink/60" title="Switch page style">{page.style === "polaroid" ? "Full page" : "Framed page"}</button>
              <button disabled={turning} onClick={async () => { if (confirm("Remove this memory from the album?")) { if(await deleteMemoryPage(page.id)){setIdx(Math.max(0, idx - 1));load();}else setMutationError("Page could not be removed. Retry."); } }} className="rounded-full bg-black/5 p-2 text-ink/60 hover:text-danger" title="Remove page"><Trash2 size={15} /></button>
            </div>
          ) : null}
        </div>
      )}

      {page&&view==='book'&&memoryPageSoundtrack(page)?<PostSoundtrack key={page.id+':audio'} selection={memoryPageSoundtrack(page)} use="memory_album" active={!filmVisible&&!turning&&!manage&&!adding&&!musicOpen} controls className="mt-4 text-center"/>:null}
      {nextBook&&view==='book'&&idx>=pages.length-1&&<Link href={'/album/'+nextBook.id} className="mx-auto mt-5 block w-fit rounded-full bg-pearl px-5 py-2 text-sm font-semibold text-on-pearl">Next book: {nextBook.title}</Link>}
      {adding && album.is_owner ? <AddMemories albumId={album.id} onClose={() => { setAdding(false); load(); }} existing={pages} /> : null}
      {manage && album.is_owner ? <ManageAlbum key={`${album.id}:${uid}`} ownerId={uid!} album={album} onClose={() => { setManage(false); load(); }} /> : null}
    </div>
  );
}

function PageCaption({ page, isOwner, onSaved }: { page: MemoryPage; isOwner: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(page.caption ?? "");
  const [error,setError]=useState("");
  const lock=useRef(false);
  if (editing) {
    return (
      <span className="mt-2 flex items-center gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={140} placeholder="Write a caption"
          className="min-w-0 flex-1 border-b border-ink/20 bg-transparent px-1 py-1 text-center font-display text-[13px] text-[#5a5140] outline-none" />
        {error&&<span role="alert" className="text-xs text-danger">{error}</span>}
        <button onClick={async () => { if(lock.current)return;lock.current=true;try{if(!await updateMemoryPage(page.id,{caption:text.trim()||null}))throw Error();setEditing(false);onSaved();}catch{setError("Could not save. Retry.");}finally{lock.current=false;} }} className="rounded-full bg-pearl p-1.5 text-on-pearl" aria-label="Save caption"><Check size={13} /></button>
      </span>
    );
  }
  return (
    <span className="mt-2 flex items-center justify-center gap-1.5">
      <span className="text-center font-display text-[18px] leading-snug text-[#24334B]">
        {page.caption || fmtDate(page.taken_at)}
      </span>
      {isOwner ? <button onClick={() => setEditing(true)} className="text-muted hover:text-ink/70" aria-label="Edit caption"><Pencil size={12} /></button> : null}
    </span>
  );
}

function AddMemories({ albumId, onClose, existing }: { albumId: string; onClose: () => void; existing: MemoryPage[] }) {
  const dialog=useMemoryDialog(true,onClose);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getMyStories>>>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading,setLoading]=useState(true);
  const addLock=useRef(false);
  useEffect(() => {
    let alive = true;queueMicrotask(()=>{if(alive)setLoading(true);});
    void getMyStories().then(value => { if (alive) { setRows(value); setError(null); } }).catch(() => { if (alive) setError("Stories could not load. Please retry."); }).finally(()=>{if(alive)setLoading(false);});
    return () => { alive = false; };
  }, [attempt]);
  return (
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Book editor" className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={onClose}>
      <div className="max-h-[86vh] w-full max-w-[560px] overflow-y-auto rounded-t-2xl bg-[var(--canvas)] p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-display text-[16px] text-ink">Add memories</p>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-black/5" aria-label="Close"><X size={17} /></button>
        </div>
        <p className="mb-3 text-[12px] text-muted">Every story you have ever posted. Pick the ones worth keeping.</p>
        <button type="button" disabled={loading||busy} className="mb-3 text-xs text-muted underline disabled:opacity-50" onClick={()=>setAttempt(n=>n+1)}>Refresh previews</button>
        {error && <button className="mb-3 text-sm underline" onClick={() => setAttempt(n => n + 1)}>{error}</button>}
        {rows.length === 0 ? <p className="py-10 text-center text-sm text-muted">{loading ? "Loading your stories…" : error ? "" : "No stories yet."}</p> : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {rows.map((s) => {
              const taken = existing.some((p) => p.story_id === s.id);
              const on = picked.has(s.id);
              const label = s.caption?.trim() || `${s.media_type === "video" ? "Video" : s.media_type === "image" ? "Photo" : "Story"} from ${fmtDate(s.created_at)}`;
              return (
                <button key={s.id} type="button" aria-label={`${label}. ${taken ? "Already in this book" : on ? "Selected" : "Not selected"}`} aria-pressed={taken||on} disabled={taken||busy} onClick={() => setPicked((prev) => { const n = new Set(prev); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}
                  className={"relative aspect-[9/14] overflow-hidden rounded-lg border " + (on ? "border-ink" : "border-ink/10") + (taken ? " opacity-35" : "")}>
                  <MemoryStoryPreview key={[s.id,attempt,s.media_url,s.thumbnail_url].join(":")} story={s}/>
                  {on ? <span className="absolute right-1 top-1 rounded-full bg-ink p-1 text-white"><Check size={11} /></span> : null}
                  {taken ? <span className="absolute inset-x-0 bottom-0 bg-white/85 py-0.5 text-center text-[10px] font-semibold text-ink/60">In album</span> : null}
                </button>
              );
            })}
          </div>
        )}
        <button disabled={picked.size === 0 || busy}
          onClick={async () => { if(addLock.current)return;addLock.current=true;setBusy(true);setError(null);try{for(const id of picked){if(!await addMemoryPage(id,albumId))throw Error();}onClose();}catch{setError("Some pages could not save. Retry; existing pages will not duplicate.");}finally{addLock.current=false;setBusy(false);} }}
          className="mt-4 w-full rounded-md bg-pearl py-2.5 text-sm font-semibold text-on-pearl disabled:opacity-40">
          {busy ? "Adding" : picked.size === 0 ? "Pick stories to add" : "Add " + picked.size + (picked.size === 1 ? " memory" : " memories")}
        </button>
      </div>
    </div>
  );
}

function ManageAlbum({ album, ownerId, onClose }: { album: MemoryAlbum; ownerId:string; onClose: () => void }) {
  const saveLock=useRef(false),epoch=useRef(0),sessionValid=useRef(true);
  const [client]=useState(createClient);
  const dialog=useMemoryDialog(true,()=>{if(!saveLock.current)onClose();});
  const [revision]=useState(album.presentation_revision);
  const [coverArtwork,setCoverArtwork]=useState(()=>memoryCoverArtwork(album.cover_artwork)),[filmSettings,setFilmSettings]=useState(()=>memoryFilmSettings(album.film_settings));
  const [title, setTitle] = useState(album.title);
  const [design,setDesign]=useState(album.cover_design??'keepsake');
  const [subtitle,setSubtitle]=useState(album.subtitle??'');
  const [coverStoryId,setCoverStoryId]=useState<string|null>(album.cover_story_id??null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [color, setColor] = useState(album.cover_color);
  const [audience, setAudience] = useState(album.audience);
  const [allow, setAllow] = useState<AccessPerson[]>([]);
  const [block, setBlock] = useState<AccessPerson[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AccessPerson[]>([]);
  const [mode, setMode] = useState<"allow" | "block">("block");
  useEffect(()=>{const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{if(session?.user.id!==ownerId){epoch.current++;sessionValid.current=false;setError('The book session changed. Reopen the book before saving.');}});const invalidate=()=>{epoch.current++;subscription.unsubscribe();};return invalidate;},[client,ownerId]);


  useEffect(() => { getAccessList("allow").then(setAllow).catch(()=>setError("Chosen people could not load.")); getAccessList("block").then(setBlock).catch(()=>setError("Hidden people could not load.")); }, []);
  useEffect(() => {
    let live=true;const t = setTimeout(() => { searchPeople(q).then(v=>{if(live)setResults(v);}).catch(()=>{if(live)setError("People search failed.");}); }, 250);
    return () => {live=false;clearTimeout(t);};
  }, [q]);

  const list = mode === "allow" ? allow : block;
  const setList = mode === "allow" ? setAllow : setBlock;

  return (
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Book editor" className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center" onClick={()=>{if(!saveLock.current)onClose();}}>
      <div className="max-h-[88vh] w-full max-w-[520px] overflow-y-auto rounded-t-2xl bg-[var(--canvas)] p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-display text-[25px] text-ink">Design your book</p>
          <button disabled={busy} onClick={()=>{if(!saveLock.current)onClose();}} className="rounded-full p-1.5 text-muted hover:bg-black/5" aria-label="Close"><X size={17} /></button>
        </div>

        <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Title</p>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={30}
          className="mb-4 w-full rounded-lg border border-ink/15 px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/40" />

        <label className="mb-4 block text-xs font-semibold text-muted">Subtitle<input value={subtitle} onChange={e=>setSubtitle(e.target.value)} maxLength={120} placeholder="A small line to remember it by" className="mt-2 min-h-11 w-full rounded-xl border border-ink/15 bg-transparent px-3 py-2 text-sm font-normal text-ink"/></label>
        <div className="mx-auto mb-6 w-[174px]"><MemoryBookCover artwork={coverArtwork} title={title||'Memories'} subtitle={subtitle} color={color} design={design} {...memoryCoverMedia(memoryCoverPage(album.pages,coverStoryId))} width={174} height={228}/></div>
        <p className="mb-2 text-xs font-semibold uppercase text-muted">Cover memory</p>
        {album.pages.length ? <div className="mb-5 flex gap-2 overflow-x-auto pb-2">{album.pages.map((pg,i)=><button key={pg.id} aria-label={'Use memory '+(i+1)+' on the cover'} aria-pressed={coverStoryId===pg.story_id} onClick={()=>setCoverStoryId(pg.story_id??null)} className={'relative h-[88px] w-[70px] shrink-0 overflow-hidden rounded-lg border-2 '+(coverStoryId===pg.story_id?'border-ink':'border-transparent')}><MemoryStoryPreview story={{...pg,stickers_json:pg.stickers}}/>{coverStoryId===pg.story_id&&<span className="absolute bottom-1 right-1 rounded-full bg-ink p-1 text-white"><Check size={12}/></span>}</button>)}</div> : <p className="mb-4 text-sm text-muted">Add memories to choose a photo or video cover.</p>}
        <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Paper tint</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {Object.entries(COVER_COLORS).map(([key, c]) => (
            <button key={key} onClick={() => setColor(key)}
              className={"h-9 w-9 rounded-full border-2 " + (color === key ? "border-ink" : "border-ink/10")}
              style={{ background: c.cover }} title={key} aria-label={`${key} cover color`} aria-pressed={color===key}>
              <span className="mx-auto block h-4 w-1.5 rounded" style={{ background: c.spine }} />
            </button>
          ))}
        </div>

        <p className="mb-2 text-xs font-semibold uppercase text-muted">Cover design</p>
        <div className="mb-4 flex gap-4 overflow-x-auto p-2">{MEMORY_DESIGNS.map(d=><button key={d.id} aria-label={`${d.label} cover design`} aria-pressed={design===d.id} onClick={()=>setDesign(d.id)} className={design===d.id?'':'opacity-45'}><MemoryBookCover artwork={coverArtwork} title={title||'Memories'} subtitle={subtitle} color={color} design={d.id} {...memoryCoverMedia(memoryCoverPage(album.pages,coverStoryId))} width={74} height={97}/><span className="mt-2 block whitespace-nowrap text-xs">{d.label}</span></button>)}</div>
        <MemoryCoverControls value={coverArtwork} onChange={setCoverArtwork} hasPhoto={!!memoryCoverPage(album.pages,coverStoryId)} disabled={busy}/><MemoryFilmControls value={filmSettings} onChange={setFilmSettings} disabled={busy}/>
        <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Who can open it</p>
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
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">People</p>
          <button onClick={() => setMode("block")} className={"rounded-full px-2.5 py-1 text-[11px] font-semibold " + (mode === "block" ? "bg-ink text-white" : "bg-black/5 text-ink/60")}>Hidden from</button>
          <button onClick={() => setMode("allow")} className={"rounded-full px-2.5 py-1 text-[11px] font-semibold " + (mode === "allow" ? "bg-ink text-white" : "bg-black/5 text-ink/60")}>Chosen people</button>
        </div>
        <p className="mb-2 text-[11px] text-muted">{mode === "block" ? "These people never see your books, whatever each book’s audience." : "Used across your books whose audience is only people I choose."}</p>
        <input value={q} onChange={(e) => {setQ(e.target.value);setResults([]);}} placeholder="Search people"
          className="mb-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-[13px] text-ink outline-none focus:border-ink/40" />
        {results.length > 0 ? (
          <div className="mb-2 flex flex-col gap-1">
            {results.map((r) => (
              <button key={r.id} onClick={async () => { if (await setAccess(r.id, mode, true)) { setList([...list.filter((x) => x.id !== r.id), r]); setQ(""); setResults([]); } else setError("Could not update who can see your books. Retry."); }}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/5">
                {r.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImageUrl(r.avatar_url, 100) ?? r.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pearl text-[11px] font-semibold text-on-pearl">{(r.full_name ?? "?").charAt(0)}</span>}
                <span className="text-[13px] text-ink">{r.full_name} <span className="text-muted">@{r.username}</span></span>
                <Plus size={14} className="ml-auto text-muted" />
              </button>
            ))}
          </div>
        ) : null}
        {list.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            {r.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displayImageUrl(r.avatar_url, 100) ?? r.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pearl text-[11px] font-semibold text-on-pearl">{(r.full_name ?? "?").charAt(0)}</span>}
            <span className="text-[13px] text-ink">{r.full_name}</span>
            <button onClick={async () => { if (await setAccess(r.id, mode, false)) setList(list.filter((x) => x.id !== r.id)); else setError("Could not update who can see your books. Retry."); }} className="ml-auto rounded-full p-1 text-muted hover:text-danger" aria-label="Remove"><X size={14} /></button>
          </div>
        ))}

        {error&&<p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <button disabled={busy} onClick={async () => {if(saveLock.current)return;saveLock.current=true;setBusy(true);setError('');const expected=epoch.current;const current=()=>sessionValid.current&&expected===epoch.current;try{await saveMemoryCreativeBook(client,{ownerId,albumId:album.id,revision:revision??-1,audience,draft:{title:title.trim()||'Memories',subtitle,color,design,coverStoryId,artwork:coverArtwork,film:filmSettings},isCurrent:current});if(current())onClose();}catch(error){if(current())setError(memoryCreativeSaveError(error));}finally{saveLock.current=false;if(current())setBusy(false);} }}
          className="mt-4 min-h-12 w-full rounded-2xl bg-[#142642] py-3 text-sm font-semibold text-[#FFFFFF] disabled:opacity-50">{busy?'Saving…':'Save book'}</button>
      </div>
    </div>
  );
}
