import { acceptAdaptiveMedia } from '../../shared/adaptiveMedia';
import { hydrateContentMedia, hydrateOwnerUploadMedia, replaceContentMedia } from '../../shared/contentMedia';
import { supabase, SUPABASE_URL } from './supabase';
import { reuseFeedMediaGrants } from '../../shared/feedMediaReuse';
export const retainFeedMedia = <T extends { id: string },>(current: T[], incoming: T[], previousScope: string | null, nextScope: string | null) =>
  reuseFeedMediaGrants(current, incoming, SUPABASE_URL, previousScope, nextScope);
/** Authorized row metadata may render before its private media capabilities arrive. */
export const withoutPrivateMedia = <T,>(rows: T[]) => replaceContentMedia(rows, SUPABASE_URL, new Map());
export const hydratePostMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'post', undefined, acceptAdaptiveMedia);
export const hydrateStoryMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'story', undefined, acceptAdaptiveMedia);
export const hydrateSoundMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'sound', undefined, acceptAdaptiveMedia);

export const hydrateMemoryAlbumMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'memory_album', undefined, acceptAdaptiveMedia);

export const hydrateHighlightMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'highlight', undefined, acceptAdaptiveMedia);

export const hydrateUploadMedia = <T,>(rows: T[]) => hydrateOwnerUploadMedia(supabase, SUPABASE_URL, rows, undefined, acceptAdaptiveMedia);
