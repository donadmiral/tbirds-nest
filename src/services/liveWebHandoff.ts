import { Linking } from 'react-native';
import { isLiveUuid } from '../../shared/liveDirectory';

export type LiveWebPage = 'connections' | 'publish' | 'captions';

/** Public route only. The browser establishes its own authenticated session. */
export function liveWebHandoffUrl(page: LiveWebPage, clipId?: string): string {
  const origin = 'https://platinumcircles.app';
  if (page === 'connections' && clipId === undefined) return `${origin}/live/connections`;
  if ((page === 'publish' || page === 'captions') && isLiveUuid(clipId)) {
    return `${origin}/live/clips/${clipId.toLowerCase()}/${page}`;
  }
  throw new Error('This Live page is unavailable. Refresh the clip and try again.');
}

export async function openLiveWebPage(page: LiveWebPage, clipId?: string): Promise<void> {
  const url = liveWebHandoffUrl(page, clipId);
  try { await Linking.openURL(url); }
  catch { throw new Error('Your browser could not open. Try again from the clip library.'); }
}
