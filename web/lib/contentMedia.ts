import { hydrateContentMedia, hydrateOwnerUploadMedia, type ContentMediaClient } from '../../shared/contentMedia';
import { createClient } from './supabase/client';
export const hydratePostMedia = <T,>(rows: T[], client: ContentMediaClient = createClient()) => hydrateContentMedia(client, process.env.NEXT_PUBLIC_SUPABASE_URL!, rows, 'post');
export const hydrateStoryMedia = <T,>(rows: T[], client: ContentMediaClient = createClient()) => hydrateContentMedia(client, process.env.NEXT_PUBLIC_SUPABASE_URL!, rows, 'story');

export const hydrateStoryDraftMedia = <T,>(rows: T[], client: ContentMediaClient = createClient()) => hydrateContentMedia(client, process.env.NEXT_PUBLIC_SUPABASE_URL!, rows, 'story_draft');

export const hydrateMemoryAlbumMedia = <T,>(rows: T[], client: ContentMediaClient = createClient()) => hydrateContentMedia(client, process.env.NEXT_PUBLIC_SUPABASE_URL!, rows, 'memory_album');

export const hydrateHighlightMedia = <T,>(rows: T[], client: ContentMediaClient = createClient()) => hydrateContentMedia(client, process.env.NEXT_PUBLIC_SUPABASE_URL!, rows, 'highlight');

export const hydrateUploadMedia = <T,>(rows: T[], client: ContentMediaClient = createClient()) => hydrateOwnerUploadMedia(client, process.env.NEXT_PUBLIC_SUPABASE_URL!, rows);

export const hydrateSoundMedia = <T,>(rows: T[], client: ContentMediaClient = createClient()) => hydrateContentMedia(client, process.env.NEXT_PUBLIC_SUPABASE_URL!, rows, 'sound');
