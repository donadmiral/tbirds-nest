import { hydrateContentMedia, hydrateOwnerUploadMedia, replaceContentMedia } from '../../shared/contentMedia';
import { supabase, SUPABASE_URL } from './supabase';
/** Authorized row metadata may render before its private media capabilities arrive. */
export const withoutPrivateMedia = <T,>(rows: T[]) => replaceContentMedia(rows, SUPABASE_URL, new Map());
export const hydratePostMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'post');
export const hydrateStoryMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'story');
export const hydrateSoundMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'sound');

export const hydrateMemoryAlbumMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'memory_album');

export const hydrateHighlightMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'highlight');

export const hydrateUploadMedia = <T,>(rows: T[]) => hydrateOwnerUploadMedia(supabase, SUPABASE_URL, rows);
