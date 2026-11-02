import { hydrateContentMedia, hydrateOwnerUploadMedia, replaceContentMedia, type ContentMediaClient } from '../../shared/contentMedia';
import { createClient } from './supabase/client';
import { reuseFeedMediaGrants } from '../../shared/feedMediaReuse';
import type { FeedRow } from './feed';

/** Preserve exact URLs only within the authorized navigation session. */
export function retainFeedMedia(current: FeedRow[], incoming: FeedRow[], previousScope: string | null, nextScope: string | null): FeedRow[] {
  const adapt = (row: FeedRow) => ({ ...row, id: row.post_id, user_id: row.author_id });
  return reuseFeedMediaGrants(current.map(adapt), incoming.map(adapt), process.env.NEXT_PUBLIC_SUPABASE_URL!, previousScope, nextScope)
    .map(({ id: _id, user_id: _userId, ...row }) => row);
}
export const withoutPrivateMedia = <T,>(rows: T[]) => replaceContentMedia(rows, process.env.NEXT_PUBLIC_SUPABASE_URL!, new Map());
export const hydratePostMedia = <T,>(rows: T[], client: ContentMediaClient = createClient(), signal?: AbortSignal) => hydrateContentMedia(client, process.env.NEXT_PUBLIC_SUPABASE_URL!, rows, 'post', signal);
export const hydrateStoryMedia = <T,>(rows: T[], client: ContentMediaClient = createClient(), signal?: AbortSignal) => hydrateContentMedia(client, process.env.NEXT_PUBLIC_SUPABASE_URL!, rows, 'story', signal);

export const hydrateStoryDraftMedia = <T,>(rows: T[], client: ContentMediaClient = createClient(), signal?: AbortSignal) => hydrateContentMedia(client, process.env.NEXT_PUBLIC_SUPABASE_URL!, rows, 'story_draft', signal);

export const hydrateMemoryAlbumMedia = <T,>(rows: T[], client: ContentMediaClient = createClient(), signal?: AbortSignal) => hydrateContentMedia(client, process.env.NEXT_PUBLIC_SUPABASE_URL!, rows, 'memory_album', signal);

export const hydrateHighlightMedia = <T,>(rows: T[], client: ContentMediaClient = createClient(), signal?: AbortSignal) => hydrateContentMedia(client, process.env.NEXT_PUBLIC_SUPABASE_URL!, rows, 'highlight', signal);

export const hydrateUploadMedia = <T,>(rows: T[], client: ContentMediaClient = createClient(), signal?: AbortSignal) => hydrateOwnerUploadMedia(client, process.env.NEXT_PUBLIC_SUPABASE_URL!, rows, signal);

export const hydrateSoundMedia = <T,>(rows: T[], client: ContentMediaClient = createClient(), signal?: AbortSignal) => hydrateContentMedia(client, process.env.NEXT_PUBLIC_SUPABASE_URL!, rows, 'sound', signal);
