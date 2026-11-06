import { Image } from 'expo-image';
import { feedPrefetchUrls } from '../../shared/feedSnapshot';
import { prefetch } from '../lib/screenTransition';
import { supabase } from './supabase';

/** Start on press-in, then reuse the same request when navigation commits. */
export function prefetchFeedProfile(profileId: string) {
  if (!profileId) return;
  prefetch('profile:' + profileId, async signal => {
    const { data, error } = await supabase.rpc('get_profile', { p_profile_id: profileId }).abortSignal(signal);
    if (error) throw error;
    if (!data || data.id !== profileId) throw new Error('Profile is unavailable.');
    return data;
  });
}

/** Use the same bounded, public-only policy as scrolling lookahead. */
export function prefetchPostImages(post: Record<string, any>, dataSaver: boolean) {
  const urls = feedPrefetchUrls([post], 0, dataSaver);
  if (!urls.length) return;
  void Image.prefetch(urls, { cachePolicy: 'memory' }).catch(() => {});
}
