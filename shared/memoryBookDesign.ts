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
