import { supabase } from './supabase';

export type StoryMediaType = 'image' | 'video' | 'text';
export type StoryScope = 'institution' | 'affiliation' | 'global';

export type StoryStickerStyle = 'classic' | 'bold' | 'typewriter' | 'neon' | 'highlight';

export type StoryTextSticker = {
  id: string;
  text: string;
  style: StoryStickerStyle;
  color: string;
  nx: number;
  ny: number;
  scale: number;
  rotation: number;
};

export type StoryTextBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; colors: [string, string]; direction: 'vertical' | 'diagonal' };

export type StoryRow = {
  id: string;
  user_id: string;
  media_url: string | null;
  media_type: StoryMediaType;
  thumbnail_url: string | null;
  duration_sec: number | null;
  caption: string | null;
  institution_id: string | null;
  scope: StoryScope;
  affiliation_id: string | null;
  views_count: number;
  expires_at: string;
  created_at: string;
  is_viewed?: boolean;
  stickers_json?: StoryTextSticker[] | null;
  text_background?: StoryTextBackground | null;
};

export type CatchupUser = {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  story_count: number;
  unseen_count: number;
  latest_story_at: string;
  latest_story_id: string;
  has_unseen: boolean;
};

export type StoryViewer = {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  viewed_at: string;
};

export type CatchupMode = 'primary' | 'all' | 'global';

export async function uploadAndCreateStory(params: {
  userId: string;
  localUri: string | null;
  mediaType: StoryMediaType;
  caption?: string | null;
  scope: StoryScope;
  affiliationId?: string | null;
  durationSec?: number | null;
  thumbnailLocalUri?: string | null;
  stickersJson?: StoryTextSticker[] | null;
  textBackground?: StoryTextBackground | null;
}): Promise<StoryRow> {
  const {
    userId,
    localUri,
    mediaType,
    caption,
    scope,
    affiliationId,
    durationSec,
    thumbnailLocalUri,
    stickersJson,
    textBackground,
  } = params;

  if (!userId) throw new Error('userId required');
  if (mediaType !== 'text' && !localUri) throw new Error('localUri required');

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token || supabaseKey;

  let mediaPublicUrl: string | null = null;
  let thumbnailUrl: string | null = null;

  // Upload media only for image/video stories.
  if (mediaType !== 'text' && localUri) {
    const ext = mediaType === 'video' ? 'mp4' : 'jpg';
    const mimeType = mediaType === 'video' ? 'video/mp4' : 'image/jpeg';
    const fileName = `${userId}/${Date.now()}.${ext}`;

    const formData = new FormData();
    formData.append('file', {
      uri: localUri,
      type: mimeType,
      name: `story.${ext}`,
    } as any);

    const uploadRes = await fetch(
      `${supabaseUrl}/storage/v1/object/story-media/${fileName}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: supabaseKey,
          'x-upsert': 'true',
        },
        body: formData,
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      throw new Error(err?.error || `Upload failed: ${uploadRes.status}`);
    }

    mediaPublicUrl = `${supabaseUrl}/storage/v1/object/public/story-media/${fileName}`;

    if (thumbnailLocalUri) {
      try {
        const thumbName = `${userId}/${Date.now()}_thumb.jpg`;
        const thumbForm = new FormData();
        thumbForm.append('file', {
          uri: thumbnailLocalUri,
          type: 'image/jpeg',
          name: 'thumb.jpg',
        } as any);

        const thumbRes = await fetch(
          `${supabaseUrl}/storage/v1/object/story-media/${thumbName}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: supabaseKey,
              'x-upsert': 'true',
            },
            body: thumbForm,
          }
        );
        if (thumbRes.ok) {
          thumbnailUrl = `${supabaseUrl}/storage/v1/object/public/story-media/${thumbName}`;
        }
      } catch (e: any) {
        console.log('[story thumb upload]', e?.message);
      }
    }
  }

  const { data, error } = await supabase
    .from('stories')
    .insert({
      user_id: userId,
      media_url: mediaPublicUrl,
      media_type: mediaType,
      thumbnail_url: thumbnailUrl,
      duration_sec: durationSec ?? null,
      caption: caption?.trim() || null,
      scope,
      affiliation_id: affiliationId || null,
      stickers_json: (stickersJson && stickersJson.length > 0) ? stickersJson : null,
      text_background: textBackground || null,
    })
    .select()
    .single();

  if (error || !data) {
    throw error || new Error('Story insert failed');
  }

  return data as StoryRow;
}

export const storiesService = {
  uploadAndCreateStory,

  async getCatchupFeed(mode: CatchupMode = 'all', limit = 30): Promise<CatchupUser[]> {
    const { data, error } = await supabase.rpc('get_catchup_feed', {
      p_mode: mode,
      p_limit: limit,
    });
    if (error) {
      console.log('[storiesService.getCatchupFeed]', error.message);
      return [];
    }
    return (data || []) as CatchupUser[];
  },

  async getUserStories(userId: string): Promise<StoryRow[]> {
    const { data, error } = await supabase.rpc('get_user_stories', {
      p_user_id: userId,
    });
    if (error) {
      console.log('[storiesService.getUserStories]', error.message);
      return [];
    }
    return (data || []) as StoryRow[];
  },

  async markViewed(storyId: string): Promise<void> {
    const { error } = await supabase.rpc('mark_story_viewed', {
      p_story_id: storyId,
    });
    if (error) {
      console.log('[storiesService.markViewed]', error.message);
    }
  },

  async deleteStory(storyId: string): Promise<void> {
    const { error } = await supabase.from('stories').delete().eq('id', storyId);
    if (error) {
      console.log('[storiesService.deleteStory]', error.message);
      throw error;
    }
  },

  async getViewers(storyId: string): Promise<StoryViewer[]> {
    const { data, error } = await supabase.rpc('get_story_viewers', {
      p_story_id: storyId,
    });
    if (error) {
      console.log('[storiesService.getViewers]', error.message);
      return [];
    }
    return (data || []) as StoryViewer[];
  },
};