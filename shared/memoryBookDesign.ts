/** Shared artwork tokens. Fixed cover sizes belong to their profile wrappers. */
export const MEMORY_COVER_COLORS: Record<string, { cover: string; spine: string; text: string }> = {
  blush: { cover: '#FBE3EA', spine: '#F2B8C6', text: '#8a3b52' },
  rose: { cover: '#F4C0D1', spine: '#D4537E', text: '#72243E' },
  pearl: { cover: '#F3EDE2', spine: '#C9BFB0', text: '#4a4438' },
  cream: { cover: '#FAF3E3', spine: '#E8D9B8', text: '#6b5b35' },
  sage: { cover: '#E4EEE2', spine: '#AFC8AB', text: '#3c5738' },
  sky: { cover: '#E2EEF6', spine: '#A9CBE0', text: '#2c516b' },
  lilac: { cover: '#ECE7F7', spine: '#C4B6E6', text: '#4b3c78' },
  ink: { cover: '#2A2D33', spine: '#16181c', text: '#f2f0ec' },
};
export const MEMORY_DESIGNS = [
  { id: 'keepsake', label: 'Keepsake', mark: 'heart' },
  { id: 'postcard', label: 'Postcard', mark: 'sun' },
  { id: 'editorial', label: 'Editorial', mark: 'type' },
  { id: 'field_notes', label: 'Field notes', mark: 'feather' },
  { id: 'night_film', label: 'Night film', mark: 'moon' },
  { id: 'daybook', label: 'Daybook', mark: 'star' },
  { id: 'botanical', label: 'Botanical', mark: 'feather' },
  { id: 'classic', label: 'Classic', mark: 'book-open' },
] as const;
export type MemoryDesign = typeof MEMORY_DESIGNS[number]['id'];
export function memoryDesign(value?: string | null) { return MEMORY_DESIGNS.find(x => x.id === value) ?? MEMORY_DESIGNS[0]; }
export function memoryColors(value?: string | null) { return MEMORY_COVER_COLORS[value ?? 'blush'] ?? MEMORY_COVER_COLORS.blush; }

/** The six approved cover families. Older saved themes remain readable. */
export const MEMORY_FEATURED_DESIGNS = MEMORY_DESIGNS.slice(0, 6);
export function memoryArtwork(design?: string | null, color?: string | null) {
  const d = memoryDesign(design).id, c = memoryColors(color);
  const paper = color && !['blush','cream','pearl'].includes(color) ? c.cover : '#F5F0E4';
  if (d === 'editorial') return { paper: '#24272A', spine: '#143953', ink: '#F8F5E9', accent: '#F8F5E9' };
  if (d === 'night_film') return { paper: '#1D1D1C', spine: '#111111', ink: '#F5EBD6', accent: '#C3A779' };
  if (d === 'field_notes') return { paper: '#183F34', spine: '#B65F32', ink: '#F7EFDA', accent: '#E0BC83' };
  if (d === 'daybook') return { paper: '#F5E5A5', spine: '#D9BE67', ink: '#105181', accent: '#D95032' };
  if (d === 'postcard') return { paper, spine: '#8B2436', ink: '#8B2436', accent: '#225071' };
  return { paper: paper === '#F5F0E4' ? '#E9DFCE' : paper, spine: color && color !== 'cream' ? c.spine : '#C3888C', ink: '#19263A', accent: '#887355' };
}
export type MemoryCoverPage = { story_id?: string; media_type?: string; media_url?: string | null; thumbnail_url?: string | null; taken_at?: string | null; caption?: string | null; story_caption?: string | null; stickers?: unknown };
/** Inputs must already be hydrated by the authorized memory-media service. */
export function memoryCoverMedia(page?: MemoryCoverPage | null) {
  if (!page) return { photoUrl: undefined, fallbackPhotoUrl: undefined, videoUrl: undefined };
  const sticker = Array.isArray(page.stickers) ? page.stickers.find(s => s?.kind === 'post') : null;
  const photoUrl = page.thumbnail_url || (page.media_type === 'image' ? page.media_url : null) || (sticker?.postMediaType !== 'video' ? sticker?.postMediaUrl : null) || undefined;
  const fallbackPhotoUrl = page.media_type === 'image' && page.media_url && page.media_url !== photoUrl ? page.media_url : undefined;
  const videoUrl = page.media_type === 'video' ? page.media_url || undefined : undefined;
  return { photoUrl, fallbackPhotoUrl, videoUrl };
}
export function memoryCoverPage(pages: MemoryCoverPage[], selected?: string | null) {
  return pages.find(p => p.story_id === selected) ?? pages.find(p => { const m = memoryCoverMedia(p); return m.photoUrl || m.videoUrl; }) ?? pages[0] ?? null;
}
export function memoryAudienceLabel(value?: string) {
  return value === 'only_me' ? 'Only me' : value === 'custom' ? 'Chosen people' : value === 'followers' ? 'Followers' : 'Everyone';
}

/** Keep short editorial titles large while fitting longer titles on the cover. */
export function memoryCoverTitleSize(title:string,design?:string|null) {
  const n=title.trim().length,d=memoryDesign(design).id;
  if(d==='editorial')return n>24?29:n>17?35:42;
  if(d==='night_film')return n>23?24:n>14?30:38;
  if(d==='daybook')return n>23?23:n>14?28:35;
  if(d==='field_notes')return n>22?19:n>14?22:26;
  if(d==='postcard')return n>26?20:n>20?22:26;
  return n>22?20:23;
}
