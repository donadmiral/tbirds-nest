import type { StoryTextSticker } from '../../services/storiesService';

type StickerDraft = { id: string; stickers?: StoryTextSticker[]; uploadState: string };
export type StickerChange = StoryTextSticker[] | ((current: StoryTextSticker[]) => StoryTextSticker[]);

/** Resolve transforms against the latest draft, not the render that began a
 * simultaneous pan/pinch/rotation. An async picker still targets its own draft. */
export function updateDraftStickers<T extends StickerDraft>(drafts: T[], draftId: string, change: StickerChange): T[] {
  return drafts.map((draft) => {
    if (draft.id !== draftId || draft.uploadState === 'uploading' || draft.uploadState === 'done') return draft;
    const stickers = typeof change === 'function' ? change(draft.stickers ?? []) : change;
    return { ...draft, stickers };
  });
}
