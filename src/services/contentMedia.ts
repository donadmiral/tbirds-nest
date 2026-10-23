import { hydrateContentMedia, hydrateOwnerUploadMedia } from '../../shared/contentMedia';
import { supabase, SUPABASE_URL } from './supabase';
export const hydratePostMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'post');
export const hydrateStoryMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'story');
export const hydrateSoundMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'sound');

export const hydrateMemoryAlbumMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'memory_album');

export const hydrateHighlightMedia = <T,>(rows: T[]) => hydrateContentMedia(supabase, SUPABASE_URL, rows, 'highlight');

export const hydrateUploadMedia = <T,>(rows: T[]) => hydrateOwnerUploadMedia(supabase, SUPABASE_URL, rows);
