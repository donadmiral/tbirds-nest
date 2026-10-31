import { memoryFilmItems, memoryFilmPhotoDuration, memoryFilmVideoWindow, type MemoryFilmPage, type MemoryFilmItem } from './memoryFilm';
import { memoryFilmSettings, type MemoryFilmSettings } from './memoryBookCreative';

export const MEMORY_PLAN_MAX_PAGES = 80;
export const MEMORY_PLAN_MAX_SECONDS = 300;
export type MemoryMoviePage = MemoryFilmPage & { story_id?: string; taken_at?: string | null; created_at?: string | null };
export type MemoryMovieScene = {
  pageId: string; sourceIndex: number; kind: 'image' | 'video' | 'text';
  startSec: number; durationSec: number; trimStart: number; trimEnd: number; speed: number;
  needsMetadata: boolean; fadeSec: number;
  motion: { fromScale: number; toScale: number; x: number; y: number };
};
export type MemoryMoviePlan = {
  version: 1; settings: MemoryFilmSettings; scenes: MemoryMovieScene[];
  openingSeconds: number; closingSeconds: number; durationSec: number;
  sourceCount: number; selectedCount: number; estimated: boolean;
};
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const finiteDuration = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const date = (page: MemoryMoviePage) => {
  const value = page.taken_at ?? page.created_at;
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
};
const seed = (id: string) => Array.from(id).reduce((value, letter) => ((value * 31) ^ letter.charCodeAt(0)) >>> 0, 7);

/** Pick evenly through the authorized order; never invent a subject or face score. */
function select<T>(items: readonly T[], count: number): T[] {
  if (count >= items.length) return [...items];
  if (count === 1) return [items[0]];
  return Array.from({ length: count }, (_, index) => items[Math.round(index * (items.length - 1) / (count - 1))]);
}

/**
 * A deterministic cut shared by preview and export. Only page identities and
 * bounded editing choices are returned; the caller retains hydrated media.
 * Unknown video metadata is explicit and must be resolved before encoding.
 */
export function planMemoryMovie(pages: readonly MemoryMoviePage[], rawSettings?: unknown,
  actualDurations: Readonly<Record<string, number>> = {}): MemoryMoviePlan {
  if (!pages.length) throw new Error('Add a memory before making a movie.');
  if (pages.length > MEMORY_PLAN_MAX_PAGES) throw new Error(`Choose up to ${MEMORY_PLAN_MAX_PAGES} memories for one movie.`);
  if (pages.some(page => !page.id) || new Set(pages.map(page => page.id)).size !== pages.length) throw new Error('The memory list changed. Reload the book before making its movie.');
  const settings = memoryFilmSettings(rawSettings), automatic = settings.mode === 'automatic';
  const items = memoryFilmItems(pages).map((item, sourceIndex) => ({ item, sourceIndex }));
  if (settings.order === 'chronological') items.sort((a, b) => {
    const first = date(pages[a.sourceIndex]), second = date(pages[b.sourceIndex]);
    return first == null || second == null ? first == null && second != null ? 1 : first != null && second == null ? -1 : a.sourceIndex - b.sourceIndex : first - second || a.sourceIndex - b.sourceIndex;
  });
  const openingSeconds = automatic && settings.titleCard ? 2.4 : 0;
  const closingSeconds = automatic && settings.titleCard ? 1.6 : 0;
  const budget = settings.length === 'short' ? 30 : settings.length === 'standard' ? 60 : MEMORY_PLAN_MAX_SECONDS;
  const chosen = automatic && settings.length !== 'full' ? select(items, Math.min(items.length, Math.max(1, Math.floor((budget - openingSeconds - closingSeconds) / 3)))) : items;
  const base = settings.style === 'bright' ? 3.2 : settings.style === 'cinematic' ? 4.8 : 4.2;
  const preliminary = chosen.map(({ item, sourceIndex }) => {
    const actual = actualDurations[item.id];
    const duration = finiteDuration(actual) ? actual : NaN;
    const window = item.kind === 'video' ? memoryFilmVideoWindow(item.page, finiteDuration(duration) ? duration : NaN) : null;
    const needsMetadata = item.kind === 'video' && !finiteDuration(duration);
    const hint=pages[sourceIndex].duration_sec;
    const available = window?.seconds ?? (item.kind === 'video' ? finiteDuration(hint)?hint/(window?.speed??1):base+1 : memoryFilmPhotoDuration(item) / 1000);
    const words = (item.page.story_caption ?? item.page.caption ?? item.excerpt ?? '').trim().split(/\s+/).filter(Boolean).length;
    const preferred = item.kind === 'text' ? Math.min(8, Math.max(3, 2.3 + words * .15)) : item.kind === 'video' ? base + 1 : base;
    const seconds = automatic ? item.kind === 'video' ? Math.min(available, preferred) : preferred : available;
    return { item, sourceIndex, window, needsMetadata, seconds, minimum: Math.min(seconds, item.kind === 'text' ? 3 : 2.0) };
  });
  const total = preliminary.reduce((sum, scene) => sum + scene.seconds, 0);
  const contentBudget = automatic ? budget - openingSeconds - closingSeconds : MEMORY_PLAN_MAX_SECONDS;
  const minimum = preliminary.reduce((sum, scene) => sum + scene.minimum, 0);
  if (minimum > contentBudget + .001 || !automatic && total > MEMORY_PLAN_MAX_SECONDS + .001) throw new Error('This movie is longer than five minutes. Choose an automatic cut or a shorter book.');
  const compress = automatic && total > contentBudget ? Math.max(0, (contentBudget - minimum) / Math.max(.001, total - minimum)) : 1;
  let clock = openingSeconds;
  const scenes: MemoryMovieScene[] = preliminary.map(scene => {
    const durationSec = round(scene.minimum + (scene.seconds - scene.minimum) * compress);
    const speed = scene.window?.speed ?? 1, trimStart = scene.window?.start ?? 0;
    const entropy = seed(scene.item.id), motion = automatic && scene.item.kind === 'image';
    const result: MemoryMovieScene = {
      pageId: scene.item.id, sourceIndex: scene.sourceIndex, kind: scene.item.kind, startSec: round(clock), durationSec,
      trimStart, trimEnd: round(trimStart + durationSec * speed), speed,
      needsMetadata: scene.needsMetadata, fadeSec: automatic ? Math.min(.35, durationSec / 6) : 0,
      motion: { fromScale: motion && entropy % 2 ? 1.055 : 1, toScale: motion && !(entropy % 2) ? 1.055 : 1,
        x: motion ? (entropy % 3 - 1) * .018 : 0, y: motion ? (Math.floor(entropy / 3) % 3 - 1) * .018 : 0 },
    };
    clock += durationSec; return result;
  });
  const durationSec = round(clock + closingSeconds);
  if (durationSec > MEMORY_PLAN_MAX_SECONDS + .001 || !Number.isFinite(durationSec)) throw new Error('This movie exceeds its time limit. Choose a shorter cut.');
  return { version: 1, settings, scenes, openingSeconds, closingSeconds, durationSec,
    sourceCount: pages.length, selectedCount: scenes.length, estimated: scenes.some(scene => scene.needsMetadata) };
}

/** Reuse the authored recipe, changing only the cut explicitly chosen in the plan. */
export function memoryMoviePlannedPages<T extends MemoryMoviePage>(pages: readonly T[], plan: MemoryMoviePlan): T[] {
  return plan.scenes.map(scene => {
    const page = pages[scene.sourceIndex];
    if (!page || page.id !== scene.pageId) throw new Error('The book changed after its movie was planned. Make the movie again.');
    const raw = page.media_transform && typeof page.media_transform === 'object' && !Array.isArray(page.media_transform)
      ? page.media_transform as Record<string, unknown> : {};
    return { ...page, duration_sec: scene.kind === 'video' ? page.duration_sec : scene.durationSec,
      media_transform: scene.kind === 'video' ? { ...raw, trimStart: scene.trimStart, trimEnd: scene.trimEnd, speed: scene.speed } : page.media_transform };
  });
}

export type MemoryMovieTimelineItem=MemoryFilmItem & {
  movie:{durationSec:number;fadeSec:number;motion:MemoryMovieScene['motion'];titleCard:'opening'|'closing'|null};
};

/** Preview and file export consume the same explicit timeline, including titles. */
export function memoryMovieTimeline(pages:readonly MemoryMoviePage[],plan:MemoryMoviePlan,title:string):MemoryMovieTimelineItem[]{
  const planned=memoryMoviePlannedPages(pages,plan),original=plan.settings.mode==='original';
  const items=memoryFilmItems(original?plan.scenes.map(scene=>pages[scene.sourceIndex]):planned);
  const timeline:MemoryMovieTimelineItem[]=items.map((item,index)=>({...item,movie:{durationSec:plan.scenes[index].durationSec,fadeSec:plan.scenes[index].fadeSec,motion:plan.scenes[index].motion,titleCard:null}}));
  const card=(phase:'opening'|'closing',durationSec:number):MemoryMovieTimelineItem=>{
    const id=`memory-movie-${phase}`,caption=phase==='opening'?title:`${title}\n${plan.selectedCount} ${plan.selectedCount===1?'memory':'memories'} kept`;
    return {...memoryFilmItems([{id,media_type:'text',caption,text_background:{color:plan.settings.style==='cinematic'?'#122337':'#F8F1E5'}}])[0],movie:{durationSec,fadeSec:Math.min(.35,durationSec/6),motion:{fromScale:1,toScale:1,x:0,y:0},titleCard:phase}};
  };
  if(plan.openingSeconds)timeline.unshift(card('opening',plan.openingSeconds));
  if(plan.closingSeconds)timeline.push(card('closing',plan.closingSeconds));
  return timeline;
}

/** Fade through the frame background; reduced motion keeps a steady image. */
export function memoryMovieVisual(item:MemoryMovieTimelineItem,progress:number,reduceMotion=false){
  const fraction=Math.max(0,Math.min(1,progress)),motion=item.movie.motion;
  const fade=item.movie.fadeSec,itemTime=fraction*item.movie.durationSec;
  return {scale:reduceMotion?1:motion.fromScale+(motion.toScale-motion.fromScale)*fraction,
    x:reduceMotion?0:motion.x*(fraction-.5),y:reduceMotion?0:motion.y*(fraction-.5),
    opacity:reduceMotion||!fade?1:Math.max(0,Math.min(1,itemTime/fade,(item.movie.durationSec-itemTime)/fade))};
}
