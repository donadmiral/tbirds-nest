import { useEffect, useLayoutEffect, useRef } from 'react';
import type { StoryTextSticker } from '@/lib/stories';
import { fitStoryEditorPost, samePostGeometry } from '../lib/storyEditorPostFit';

type Geometry = Pick<StoryTextSticker, 'nx' | 'ny' | 'scale' | 'rotation'>;
type Candidate = { last: Geometry; pending: Geometry | null };
const initial: Geometry = { nx: 0.5, ny: 0.5, scale: 1, rotation: 0 };

/** Only untouched default cards follow layout. Owner edits keep their coordinates. */
export function useStoryPostEditorFit(value: StoryTextSticker[], onChange: (value: StoryTextSticker[]) => void) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const topbarRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const candidates = useRef(new Map<string, Candidate | null>());
  const latest = useRef({ value, onChange }); useLayoutEffect(() => { latest.current = { value, onChange }; }, [value, onChange]);
  const postIds = value.filter(sticker => sticker.kind === 'post').map(sticker => sticker.id).join('\n');

  useEffect(() => {
    const stage = stageRef.current, topbar = topbarRef.current, dock = dockRef.current;
    if (!stage || !topbar || !dock || !postIds) return;
    for (const sticker of latest.current.value.filter(item => item.kind === 'post')) {
      if (!candidates.current.has(sticker.id)) {
        candidates.current.set(sticker.id, samePostGeometry(sticker, initial) ? { last: initial, pending: null } : null);
      }
    }
    const cards = Array.from(stage.querySelectorAll<HTMLButtonElement>('[data-story-post-id]'));
    const measure = () => {
      const box = stage.getBoundingClientRect();
      if (!box.width || !box.height || !stage.clientWidth || !stage.clientHeight) return;
      const localY = stage.clientHeight / box.height;
      const changes = new Map<string, Geometry>();
      for (const card of cards) {
        const id = card.dataset.storyPostId;
        const candidate = id ? candidates.current.get(id) : null;
        const sticker = latest.current.value.find(item => item.id === id);
        if (!candidate || !sticker) continue;
        if (candidate.pending && samePostGeometry(sticker, candidate.pending)) {
          candidate.last = candidate.pending; candidate.pending = null;
        } else if (!samePostGeometry(sticker, candidate.last)) {
          candidates.current.set(sticker.id, null); continue;
        }
        const next = fitStoryEditorPost({
          stageWidth: stage.clientWidth, stageHeight: stage.clientHeight,
          cardWidth: card.offsetWidth, cardHeight: card.offsetHeight,
          top: (topbar.getBoundingClientRect().bottom - box.top) * localY,
          bottom: (dock.getBoundingClientRect().top - box.top) * localY,
        });
        if (!next || samePostGeometry(sticker, next) || candidate.pending && samePostGeometry(candidate.pending, next)) continue;
        candidate.pending = next; changes.set(sticker.id, next);
      }
      if (changes.size) latest.current.onChange(latest.current.value.map(sticker => changes.has(sticker.id) ? { ...sticker, ...changes.get(sticker.id)! } : sticker));
    };
    measure();
    const observer = new ResizeObserver(measure);
    [stage, topbar, dock, ...cards].forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [postIds]);

  const keepOwnerPlacement = (id?: string) => {
    if (id) candidates.current.set(id, null);
    else for (const key of candidates.current.keys()) candidates.current.set(key, null);
  };
  return { stageRef, topbarRef, dockRef, keepOwnerPlacement };
}
