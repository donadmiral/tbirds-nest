import { supabase } from './supabase';
import { authorId as currentAuthorId } from '../stores/actorStore';

export type StoryMediaType = 'image' | 'video' | 'text';
export type StoryScope = 'institution' | 'affiliation' | 'global';

export type StoryStickerStyle = 'classic' | 'bold' | 'typewriter' | 'neon' | 'highlight' | 'outline' | 'shadow3d' | 'retro' | 'script';

export type StoryTextSticker = {
  id: string;
  text: string;
  style: StoryStickerStyle;
  color: string;
  nx: number;
  ny: number;
  scale: number;
  rotation: number;
  bgEnabled?: boolean;
  kind?: 'text' | 'emoji' | 'link' | 'location' | 'mention' | 'question' | 'slider' | 'quiz' | 'hashtag' | 'post' | 'story' | 'countdown' | 'gif' | 'photo' | 'time' | 'date' | 'weather' | 'entity' | 'drawing';
  // Creative engine (all optional, JSON-stored)
  gifUrl?: string;
  photoUri?: string | null;
  photoUrl?: string | null;
  photoShape?: 'square' | 'rounded' | 'circle' | 'cell';
  /** Layout cells: size as a fraction of the story canvas, so every renderer
   *  (composer, phone viewer, web) reproduces the same grid. */
  photoFw?: number;
  photoFh?: number;
  infoStyle?: number;
  weatherTemp?: number;
  weatherCode?: number;
  entityType?: 'profile' | 'listing' | 'job' | 'article';
  entityId?: string;
  entityTitle?: string;
  entitySub?: string;
  entityImage?: string | null;
  strokes?: { tool: string; color: string; width: number; points: { x: number; y: number }[] }[];
  pillVariant?: number;
  startSec?: number;
  endSec?: number;
  anim?: string;
  fontSizeOverride?: number;
  opacity?: number;
  textAlign?: 'left' | 'center' | 'right';
  url?: string;
  locationName?: string;
  locationDisplayName?: string;
  locationLat?: number;
  locationLng?: number;
  locationPlaceId?: string;
  mentionUserId?: string;
  postAuthorId?: string;
  /** Story reshare (a mentioned person's Add to your story): reference to the original. */
  storyId?: string;
  storyAuthorId?: string;
  storyAuthorName?: string;
  storyAuthorUsername?: string;
  storyAuthorAvatar?: string | null;
  storyMediaUrl?: string | null;
  storyThumbUrl?: string | null;
  storyMediaType?: 'image' | 'video' | null;
  hashtag?: string;
  postId?: string;
  postAuthorName?: string;
  postAuthorAvatar?: string | null;
  postText?: string;
  postMediaUrl?: string | null;
  postMediaType?: string | null;
  mentionUsername?: string;
  questionPrompt?: string;
  sliderEmoji?: string;
  sliderLabel?: string;
  countdownTitle?: string;
  countdownTarget?: string;
  quizQuestion?: string;
  quizOptions?: { id: string; label: string; isCorrect: boolean }[];
};

export type StoryTextBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; colors: [string, string]; direction: 'vertical' | 'diagonal' };

export type MediaFit = 'cover' | 'contain';

export type MediaTransform = {
  scale: number;
  translateNX: number;
  translateNY: number;
  fit: MediaFit;
  // Creative engine extras — all optional, replayed by phone + web viewers
  trimStart?: number;
  trimEnd?: number;
  filterAmt?: number;
  bg?: { kind: 'blur' | 'color' | 'gradient' | 'none'; a?: string; b?: string } | null;
  adjust?: { bri?: number; warm?: number; tint?: number; sat?: number; fade?: number; vig?: number } | null;
  mix?: { orig?: number; music?: number } | null;
};

export type StoryAudioDraft = {
  kind: 'voiceover' | 'sound';
  localUri?: string | null;
  url?: string | null;
  soundId?: string | null;
  title?: string | null;
  durationSec?: number | null;
  source?: 'voiceover' | 'library' | 'original';
  addToSounds?: boolean;
};

export type StorySound = {
  id: string;
  owner_id: string;
  title: string;
  artist: string | null;
  url: string;
  duration_sec: number | null;
  source: 'original' | 'library';
  use_count: number;
  created_at: string;
};

export const STORY_CATEGORIES = [
  'Hiring', 'Looking for Work', 'Building in Public', 'Business',
  'Market', 'Achievement', 'Event', 'Question',
  'Announcement', 'Innovation', 'Community', 'Travel',
] as const;

export type StoryCategory = typeof STORY_CATEGORIES[number];

export type StoryHighlight = {
  id: string;
  title: string;
  cover_url: string | null;
  sort_order: number;
  story_count: number;
  latest_story_media_url: string | null;
  created_at: string;
};

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
  media_transform?: MediaTransform | null;
  category?: StoryCategory | string | null;
  dual_front_url?: string | null;
  dual_layout?: any | null;
  audio_url?: string | null;
  audio_title?: string | null;
  audio_source?: string | null;
  audio_duration_sec?: number | null;
  filter_id?: string | null;
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

export type StoryReaction = {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  emoji: string;
  created_at: string;
};

export type CatchupMode = 'primary' | 'all' | 'global';

// Poll types

export type StoryPollOption = {
  id: string;
  label: string;
  position: number;
  vote_count: number;
};

export type StoryPoll = {
  poll_id: string;
  story_id: string;
  question: string;
  nx: number;
  ny: number;
  scale: number;
  options: StoryPollOption[];
  my_vote: string | null;
  total_votes: number;
};

export type StoryPollVoter = {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  voted_at: string;
};

function safeExtFromUri(uri: string, fallback: string): string {
  try {
    const clean = uri.split('?')[0].split('#')[0];
    const ext = (clean.split('.').pop() || '').toLowerCase();
    if (ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext)) return ext;
  } catch {}
  return fallback;
}

import { resolveTrueMeta } from '../utils/sniffMedia';
import { ensureUploadSafe } from '../utils/uploadSafe';

function resolveMediaMeta(
  mediaType: StoryMediaType,
  localUri: string,
  hintMimeType?: string | null,
  hintFileName?: string | null,
): { ext: string; mimeType: string } {
  if (hintMimeType && typeof hintMimeType === 'string') {
    if (hintMimeType === 'video/quicktime') return { ext: 'mov', mimeType: 'video/quicktime' };
    if (hintMimeType === 'video/mp4') return { ext: 'mp4', mimeType: 'video/mp4' };
    if (hintMimeType === 'video/webm') return { ext: 'webm', mimeType: 'video/webm' };
    if (hintMimeType === 'image/png') return { ext: 'png', mimeType: 'image/png' };
    if (hintMimeType === 'image/webp') return { ext: 'webp', mimeType: 'image/webp' };
    if (hintMimeType === 'image/jpeg' || hintMimeType === 'image/jpg') return { ext: 'jpg', mimeType: 'image/jpeg' };
    if (hintMimeType.startsWith('video/')) return { ext: 'mp4', mimeType: hintMimeType };
    if (hintMimeType.startsWith('image/')) return { ext: 'jpg', mimeType: hintMimeType };
  }

  if (hintFileName && typeof hintFileName === 'string') {
    const fnExt = safeExtFromUri(hintFileName, '');
    if (fnExt) {
      if (mediaType === 'video') {
        if (fnExt === 'mov') return { ext: 'mov', mimeType: 'video/quicktime' };
        if (fnExt === 'mp4') return { ext: 'mp4', mimeType: 'video/mp4' };
        if (fnExt === 'webm') return { ext: 'webm', mimeType: 'video/webm' };
      } else {
        if (fnExt === 'png') return { ext: 'png', mimeType: 'image/png' };
        if (fnExt === 'webp') return { ext: 'webp', mimeType: 'image/webp' };
        if (fnExt === 'heic') return { ext: 'heic', mimeType: 'image/heic' };
        if (fnExt === 'jpg' || fnExt === 'jpeg') return { ext: 'jpg', mimeType: 'image/jpeg' };
      }
    }
  }

  const rawExt = safeExtFromUri(localUri, mediaType === 'video' ? 'mp4' : 'jpg');
  if (mediaType === 'video') {
    if (rawExt === 'mov') return { ext: 'mov', mimeType: 'video/quicktime' };
    if (rawExt === 'webm') return { ext: 'webm', mimeType: 'video/webm' };
    return { ext: 'mp4', mimeType: 'video/mp4' };
  }
  if (rawExt === 'png') return { ext: 'png', mimeType: 'image/png' };
  if (rawExt === 'webp') return { ext: 'webp', mimeType: 'image/webp' };
  if (rawExt === 'heic') return { ext: 'heic', mimeType: 'image/heic' };
  return { ext: 'jpg', mimeType: 'image/jpeg' };
}

export async function uploadAndCreateStory(params: {
  userId: string;
  localUri: string | null;
  mediaType: StoryMediaType;
  caption?: string | null;
  scope: StoryScope;
  audience?: 'everyone' | 'followers' | 'close_friends' | 'only_with' | 'except' | null;
  sharedWith?: string[] | null;
  reach?: 'followers' | 'wider' | null;
  affiliationId?: string | null;
  durationSec?: number | null;
  thumbnailLocalUri?: string | null;
  stickersJson?: StoryTextSticker[] | null;
  textBackground?: StoryTextBackground | null;
  hintMimeType?: string | null;
  hintFileName?: string | null;
  mediaTransform?: MediaTransform | null;
  category?: StoryCategory | string | null;
  dualFrontLocalUri?: string | null;
  dualLayout?: any | null;
  audio?: StoryAudioDraft | null;
  filterId?: string | null;
  preUploadedUrl?: string | null;
  preUploadedThumb?: string | null;
}): Promise<StoryRow> {
  const {
    userId,
    localUri,
    mediaType,
    caption,
    scope,
    audience,
    sharedWith,
    reach,
    affiliationId,
    durationSec,
    thumbnailLocalUri,
    stickersJson,
    textBackground,
    hintMimeType,
    hintFileName,
    mediaTransform,
    category,
    dualFrontLocalUri,
    dualLayout,
    audio,
    filterId,
  } = params;
  const preUploadedUrl = (params as any).preUploadedUrl ?? null;
  const preUploadedThumb = (params as any).preUploadedThumb ?? null;

  if (!userId) throw new Error('userId required');
  if (mediaType !== 'text' && !localUri) throw new Error('localUri required for image/video');

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token || supabaseKey;

  let mediaPublicUrl: string | null = null;
  let thumbnailUrl: string | null = null;
  let dualFrontPublicUrl: string | null = null;
  let effectiveMediaType: StoryMediaType = mediaType;
  let uploadUri: string = localUri || '';

  if (preUploadedUrl) {
    // Split publish: siblings reuse the already-uploaded source file.
    mediaPublicUrl = preUploadedUrl;
    if (preUploadedThumb) thumbnailUrl = preUploadedThumb;
  } else if (mediaType !== 'text' && localUri) {
    let { ext, mimeType } = resolveMediaMeta(mediaType, localUri, hintMimeType, hintFileName);
    // Bytes over names: the picker's label and the extension both lie sometimes.
    const trueMeta = await resolveTrueMeta(localUri, mediaType === 'video' ? 'video' : 'image', ext, mimeType);
    ext = trueMeta.ext; mimeType = trueMeta.mime;
    if (trueMeta.corrected && trueMeta.kind !== mediaType) {
      console.log('[storiesService] media_type corrected by bytes:', mediaType, '->', trueMeta.kind);
      effectiveMediaType = trueMeta.kind;
    }
    const safe = await ensureUploadSafe(localUri, effectiveMediaType === 'video' ? 'video' : 'image', ext);
    ext = safe.ext; mimeType = safe.mime; uploadUri = safe.uri;
    const fileName = `${userId}/${Date.now()}.${ext}`;

    console.log('[storiesService] Uploading:', { mediaType, ext, mimeType, fileName, uriTail: localUri.slice(-50), hintMimeType, hintFileName });

    const formData = new FormData();
    formData.append('file', {
      uri: uploadUri,
      type: mimeType,
      name: `story.${ext}`,
    } as any);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

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
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!uploadRes.ok) {
      const errBody = await uploadRes.text().catch(() => '');
      console.log('[storiesService] Upload failed:', uploadRes.status, errBody);
      throw new Error(`Upload failed: ${uploadRes.status} ${errBody}`);
    }

    mediaPublicUrl = `${supabaseUrl}/storage/v1/object/public/story-media/${fileName}`;
    console.log('[storiesService] Upload success:', mediaPublicUrl);

    // ── Dual front photo upload (with retry + exponential backoff) ──
    if (dualFrontLocalUri) {
      let frontMeta = resolveMediaMeta('image', dualFrontLocalUri);
      const frontTrue = await resolveTrueMeta(dualFrontLocalUri, 'image', frontMeta.ext, frontMeta.mimeType);
      frontMeta = { ext: frontTrue.ext, mimeType: frontTrue.mime };
      const frontRand = Math.random().toString(36).slice(2, 8);
      const frontFileName = `${userId}/${Date.now()}_${frontRand}_front.${frontMeta.ext}`;
      const MAX_FRONT_RETRIES = 2;

      for (let attempt = 0; attempt <= MAX_FRONT_RETRIES; attempt++) {
        let frontTimeoutId: ReturnType<typeof setTimeout> | null = null;
        try {
          if (attempt > 0) {
            const backoffMs = 1000 * Math.pow(2, attempt - 1); // 1s, 2s
            console.log(`[storiesService] Dual front retry ${attempt}/${MAX_FRONT_RETRIES} (${backoffMs}ms backoff)`);
            await new Promise(r => setTimeout(r, backoffMs));
          }

          console.log('[storiesService] Uploading dual front:', { frontFileName, attempt, uriTail: dualFrontLocalUri.slice(-50) });

          const frontForm = new FormData();
          frontForm.append('file', {
            uri: dualFrontLocalUri,
            type: frontMeta.mimeType,
            name: `story_front.${frontMeta.ext}`,
          } as any);

          const frontController = new AbortController();
          frontTimeoutId = setTimeout(() => frontController.abort(), 120000);

          const frontRes = await fetch(
            `${supabaseUrl}/storage/v1/object/story-media/${frontFileName}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                apikey: supabaseKey,
                'x-upsert': 'true',
              },
              body: frontForm,
              signal: frontController.signal,
            }
          );

          if (frontRes.ok) {
            dualFrontPublicUrl = `${supabaseUrl}/storage/v1/object/public/story-media/${frontFileName}`;
            console.log('[storiesService] Dual front upload success:', dualFrontPublicUrl);
            break; // success, exit retry loop
          } else {
            const frontErr = await frontRes.text().catch(() => '');
            console.log('[storiesService] Dual front upload failed:', frontRes.status, frontErr);
            if (attempt === MAX_FRONT_RETRIES) {
              console.log('[storiesService] Dual front upload exhausted retries. Story publishes with rear only.');
            }
          }
        } catch (frontUploadErr: any) {
          console.log('[storiesService] Dual front upload error:', frontUploadErr?.message);
          if (attempt === MAX_FRONT_RETRIES) {
            console.log('[storiesService] Dual front upload exhausted retries. Story publishes with rear only.');
          }
        } finally {
          if (frontTimeoutId !== null) clearTimeout(frontTimeoutId);
        }
      }
    }

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
        } else {
          console.log('[storiesService] Thumb upload failed:', thumbRes.status);
        }
      } catch (e: any) {
        console.log('[storiesService] Thumb upload error:', e?.message);
      }
    }
  }

  let audioFinalUrl: string | null = null;
  let audioMeta: { title: string | null; source: string; durationSec: number | null } | null = null;
  if (audio) {
    if (audio.kind === 'voiceover' && audio.localUri) {
      try {
        const aRand = Math.random().toString(36).slice(2, 8);
        const aExt = audio.localUri.toLowerCase().endsWith('.caf') ? 'caf' : 'm4a';
        const aName = `${userId}/${Date.now()}_${aRand}_audio.${aExt}`;
        const aForm = new FormData();
        aForm.append('file', { uri: audio.localUri, type: 'audio/mp4', name: `story_audio.${aExt}` } as any);
        const aRes = await fetch(`${supabaseUrl}/storage/v1/object/story-media/${aName}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey, 'x-upsert': 'true' },
          body: aForm,
        });
        if (aRes.ok) {
          audioFinalUrl = `${supabaseUrl}/storage/v1/object/public/story-media/${aName}`;
        } else {
          console.log('[storiesService] Audio upload failed:', aRes.status);
        }
      } catch (e: any) {
        console.log('[storiesService] Audio upload error:', e?.message);
      }
      if (audioFinalUrl) audioMeta = { title: audio.title || 'Voiceover', source: 'voiceover', durationSec: audio.durationSec ?? null };
    } else if (audio.kind === 'sound' && audio.url) {
      audioFinalUrl = audio.url;
      audioMeta = { title: audio.title || null, source: audio.source || 'original', durationSec: audio.durationSec ?? null };
    }
  }

  // ── Photo stickers: upload any local photo sticker to storage first ──
  if (Array.isArray(stickersJson)) {
    // An empty layout cell is a composer placeholder, never part of the story.
    for (let ci = stickersJson.length - 1; ci >= 0; ci--) { const cs: any = stickersJson[ci]; if (cs && cs.kind === 'photo' && cs.photoShape === 'cell' && !cs.photoUri && !cs.photoUrl) stickersJson.splice(ci, 1); }
    for (const stAny of stickersJson as any[]) {
      if (stAny && stAny.kind === 'photo' && stAny.photoUri && !stAny.photoUrl) {
        try {
          let pm = resolveMediaMeta('image', stAny.photoUri);
          const pt = await resolveTrueMeta(stAny.photoUri, 'image', pm.ext, pm.mimeType);
          const pName = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_stk.${pt.ext}`;
          const pf = new FormData();
          pf.append('file', { uri: stAny.photoUri, type: pt.mime, name: `stk.${pt.ext}` } as any);
          const pRes = await fetch(`${supabaseUrl}/storage/v1/object/story-media/${pName}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey, 'x-upsert': 'true' },
            body: pf,
          });
          if (pRes.ok) {
            stAny.photoUrl = `${supabaseUrl}/storage/v1/object/public/story-media/${pName}`;
            delete stAny.photoUri;
          } else {
            console.log('[storiesService] photo sticker upload failed:', pRes.status);
          }
        } catch (e: any) {
          console.log('[storiesService] photo sticker upload error:', e?.message);
        }
      }
    }
  }

  const insertPayload: any = {
    user_id: currentAuthorId(userId) ?? userId,
    media_url: mediaPublicUrl,
    media_type: effectiveMediaType,
    thumbnail_url: thumbnailUrl,
    duration_sec: durationSec ?? null,
    caption: caption?.trim() || null,
    scope,
    audience: audience || 'everyone',
    reach: reach || 'followers',
    affiliation_id: affiliationId || null,
  };

  if (stickersJson && stickersJson.length > 0) {
    insertPayload.stickers_json = stickersJson;
  }
  if (textBackground) {
    insertPayload.text_background = textBackground;
  }
  if (mediaTransform && (mediaTransform.scale !== 1 || mediaTransform.translateNX !== 0 || mediaTransform.translateNY !== 0 || mediaTransform.fit !== 'cover' || (mediaTransform as any).trimStart != null || (mediaTransform as any).trimEnd != null || (mediaTransform as any).bg || (mediaTransform as any).adjust || (mediaTransform as any).mix || (mediaTransform as any).filterAmt != null)) {
    insertPayload.media_transform = mediaTransform;
  }
  if (category) {
    insertPayload.category = category;
  }
  if (dualFrontPublicUrl) {
    insertPayload.dual_front_url = dualFrontPublicUrl;
  }
  if (dualLayout) {
    insertPayload.dual_layout = dualLayout;
  }

  if (audioFinalUrl) {
    insertPayload.audio_url = audioFinalUrl;
    insertPayload.audio_title = audioMeta?.title ?? null;
    insertPayload.audio_source = audioMeta?.source ?? null;
    insertPayload.audio_duration_sec = audioMeta?.durationSec != null ? Math.round(audioMeta.durationSec) : null;
  }
  if (filterId) {
    insertPayload.filter_id = filterId;
  }

  console.log('[storiesService] Inserting story row:', JSON.stringify(insertPayload).slice(0, 300));

  let data: any = null; let error: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await supabase.from('stories').insert(insertPayload).select().single();
    data = res.data; error = res.error;
    if (data && !error) break;
    const msg = String(error?.message || error || '');
    const retryable = msg.includes('Abort') || msg.includes('abort') || msg.includes('Network') || msg.includes('Failed to fetch');
    if (!retryable) break;
    console.log('[storiesService] Insert retry', attempt + 1, msg);
    await new Promise(r => setTimeout(r, 900 * (attempt + 1)));
  }

  if (error || !data) {
    console.log('[storiesService] Insert error:', error?.message);
    throw error || new Error('Story insert failed');
  }

  const postStickers = ((insertPayload.stickers_json || []) as any[]).filter((s: any) => s?.kind === 'post' && s?.postId);
  Array.from(new Set(postStickers.map((s: any) => s.postId))).forEach((pid: any) => {
    supabase.rpc('increment_share_count', { p_post_id: pid }).then(() => {}, () => {});
  });

  if (audio && audio.kind === 'voiceover' && audio.addToSounds && audioFinalUrl) {
    supabase.from('story_sounds').insert({ owner_id: userId, title: audio.title || 'Original sound', url: audioFinalUrl, duration_sec: audio.durationSec != null ? Math.round(audio.durationSec) : null, source: 'original' }).then(() => {}, () => {});
  }
  if (audio && audio.kind === 'sound' && audio.soundId) {
    supabase.rpc('increment_sound_use', { p_sound_id: audio.soundId }).then(() => {}, () => {});
  }

  if (audience === 'only_with' && sharedWith && sharedWith.length > 0) {
    const rows = sharedWith.map((uid: string) => ({ story_id: data.id, user_id: uid }));
    const { error: shareErr } = await supabase.from('story_shared_with').insert(rows);
    if (shareErr) console.log('[storiesService] shared_with error:', shareErr.message);
  }  console.log('[storiesService] Story created:', data.id);
  return data as StoryRow;
}

export const storiesService = {
  uploadAndCreateStory,

  async listStorySounds(source: 'original' | 'library', limit = 50): Promise<StorySound[]> {
    const { data, error } = await supabase
      .from('story_sounds')
      .select('*')
      .eq('source', source)
      .order(source === 'original' ? 'use_count' : 'created_at', { ascending: false })
      .limit(limit);
    if (error) { console.log('[storiesService] listStorySounds:', error.message); return []; }
    return (data || []) as StorySound[];
  },

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

  async getFollowing(): Promise<any[]> {
    const { data: me } = await supabase.auth.getUser();
    if (!me?.user) return [];
    const { data } = await supabase
      .from('follows')
      .select('following_id, profile:profiles!follows_following_id_fkey(id, full_name, username, avatar_url)')
      .eq('follower_id', me.user.id)
      .limit(200);
    return (data || []).map((r: any) => r.profile).filter(Boolean);
  },

  async getCloseFriends(): Promise<string[]> {
    const { data: me } = await supabase.auth.getUser();
    if (!me?.user) return [];
    const { data } = await supabase.from('close_friends').select('friend_id').eq('owner_id', me.user.id);
    return (data || []).map((r: any) => r.friend_id);
  },

  async setCloseFriend(friendId: string, on: boolean): Promise<void> {
    const { data: me } = await supabase.auth.getUser();
    if (!me?.user) return;
    if (on) {
      await supabase.from('close_friends').upsert({ owner_id: me.user.id, friend_id: friendId });
    } else {
      await supabase.from('close_friends').delete().eq('owner_id', me.user.id).eq('friend_id', friendId);
    }
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

  async toggleReaction(storyId: string, emoji: string): Promise<{ reacted: boolean; emoji: string }> {
    const { data, error } = await supabase.rpc('toggle_story_reaction', {
      p_story_id: storyId,
      p_emoji: emoji,
    });
    if (error) {
      console.log('[storiesService.toggleReaction]', error.message);
      throw error;
    }
    return data as { reacted: boolean; emoji: string };
  },

  async getMyReactions(storyId: string): Promise<string[]> {
    const { data, error } = await supabase.rpc('get_my_story_reactions', {
      p_story_id: storyId,
    });
    if (error) {
      console.log('[storiesService.getMyReactions]', error.message);
      return [];
    }
    return (data || []).map((r: any) => r.emoji);
  },

  async getReactions(storyId: string): Promise<StoryReaction[]> {
    const { data, error } = await supabase.rpc('get_story_reactions', {
      p_story_id: storyId,
    });
    if (error) {
      console.log('[storiesService.getReactions]', error.message);
      return [];
    }
    return (data || []) as StoryReaction[];
  },

  // ── Poll methods ──

  async createStoryPoll(
    storyId: string,
    question: string,
    options: string[],
  ): Promise<StoryPoll> {
    if (options.length < 2 || options.length > 4) {
      throw new Error('Poll requires 2 to 4 options');
    }

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      throw new Error('Poll question cannot be empty');
    }

    const trimmedOptions = options.map(o => o.trim());
    for (let i = 0; i < trimmedOptions.length; i++) {
      if (!trimmedOptions[i]) {
        throw new Error(`Option ${i + 1} cannot be empty`);
      }
    }

    const lowerSet = new Set<string>();
    for (const opt of trimmedOptions) {
      const lower = opt.toLowerCase();
      if (lowerSet.has(lower)) {
        throw new Error(`Duplicate option: ${opt}`);
      }
      lowerSet.add(lower);
    }

    // Insert poll
    const { data: poll, error: pollErr } = await supabase
      .from('story_polls')
      .insert({
        story_id: storyId,
        question: trimmedQuestion,
      })
      .select('id')
      .single();

    if (pollErr || !poll) {
      console.log('[storiesService.createStoryPoll] poll insert error:', pollErr?.message);
      throw pollErr || new Error('Poll insert failed');
    }

    // Insert options
    const optionRows = trimmedOptions.map((label, i) => ({
      poll_id: poll.id,
      label,
      position: i,
    }));

    const { error: optErr } = await supabase
      .from('story_poll_options')
      .insert(optionRows);

    if (optErr) {
      console.log('[storiesService.createStoryPoll] options insert error:', optErr.message);
      // Rollback: delete the poll (cascades options if any partial insert)
      await supabase.from('story_polls').delete().eq('id', poll.id);
      throw optErr;
    }

    // Return fresh poll data via RPC
    const result = await this.getStoryPoll(storyId);
    if (!result) {
      throw new Error('Poll created but could not be read back');
    }
    return result;
  },

  async getStoryPoll(storyId: string): Promise<StoryPoll | null> {
    const { data, error } = await supabase.rpc('get_story_poll', {
      p_story_id: storyId,
    });

    if (error) {
      console.log('[storiesService.getStoryPoll]', error.message);
      throw error;
    }

    if (!data) return null;
    return data as StoryPoll;
  },

  async voteStoryPoll(pollId: string, optionId: string): Promise<StoryPoll> {
    const { data, error } = await supabase.rpc('vote_story_poll', {
      p_poll_id: pollId,
      p_option_id: optionId,
    });

    if (error) {
      console.log('[storiesService.voteStoryPoll]', error.message);
      throw error;
    }

    return data as StoryPoll;
  },

  async getStoryPollVoters(pollId: string, optionId: string): Promise<StoryPollVoter[]> {
    const { data, error } = await supabase.rpc('get_story_poll_voters', {
      p_poll_id: pollId,
      p_option_id: optionId,
    });

    if (error) {
      console.log('[storiesService.getStoryPollVoters]', error.message);
      throw error;
    }

    return (data || []) as StoryPollVoter[];
  },

  // ── Highlight methods ──

  async getUserHighlights(userId: string): Promise<StoryHighlight[]> {
    const { data, error } = await supabase.rpc('get_user_highlights', { p_user_id: userId });
    if (error) { console.log('[storiesService.getUserHighlights]', error.message); return []; }
    return (data || []) as StoryHighlight[];
  },

  async getHighlightStories(highlightId: string): Promise<StoryRow[]> {
    const { data, error } = await supabase.rpc('get_highlight_stories', { p_highlight_id: highlightId });
    if (error) { console.log('[storiesService.getHighlightStories]', error.message); return []; }
    return (data || []) as StoryRow[];
  },

  async createHighlight(title: string): Promise<StoryHighlight> {
    const { data, error } = await supabase
      .from('story_highlights')
      .insert({ title, user_id: (await supabase.auth.getUser()).data.user?.id })
      .select()
      .single();
    if (error || !data) { throw error || new Error('Could not create highlight'); }
    return { ...data, story_count: 0, latest_story_media_url: null } as StoryHighlight;
  },

  async updateHighlight(highlightId: string, patch: { title?: string; cover_url?: string | null }): Promise<void> {
    const { error } = await supabase
      .from('story_highlights')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', highlightId);
    if (error) throw error;
  },

  async deleteHighlight(highlightId: string): Promise<void> {
    const { error } = await supabase.from('story_highlights').delete().eq('id', highlightId);
    if (error) throw error;
  },

  async addStoryToHighlight(highlightId: string, storyId: string): Promise<void> {
    const { error } = await supabase
      .from('story_highlight_items')
      .insert({ highlight_id: highlightId, story_id: storyId });
    if (error) throw error;
  },

  async removeStoryFromHighlight(highlightId: string, storyId: string): Promise<void> {
    const { error } = await supabase
      .from('story_highlight_items')
      .delete()
      .eq('highlight_id', highlightId)
      .eq('story_id', storyId);
    if (error) throw error;
  },

  // ── Sticker response methods ──

  async submitStickerResponse(params: {
    storyId: string;
    stickerId: string;
    responseType: 'question' | 'slider' | 'quiz' | 'countdown';
    textValue?: string | null;
    numberValue?: number | null;
    optionId?: string | null;
  }): Promise<any> {
    const { data, error } = await supabase.rpc('submit_sticker_response', {
      p_story_id: params.storyId,
      p_sticker_id: params.stickerId,
      p_response_type: params.responseType,
      p_text_value: params.textValue || null,
      p_number_value: params.numberValue ?? null,
      p_option_id: params.optionId || null,
    });
    if (error) {
      console.log('[storiesService.submitStickerResponse]', error.message);
      throw error;
    }
    return data;
  },

  async getStickerResponses(storyId: string, stickerId: string): Promise<StickerResponse[]> {
    const { data, error } = await supabase.rpc('get_sticker_responses', {
      p_story_id: storyId,
      p_sticker_id: stickerId,
    });
    if (error) {
      console.log('[storiesService.getStickerResponses]', error.message);
      return [];
    }
    return (data || []) as StickerResponse[];
  },

  async getMyStickerResponse(storyId: string, stickerId: string): Promise<StickerResponse | null> {
    const { data, error } = await supabase.rpc('get_my_sticker_response', {
      p_story_id: storyId,
      p_sticker_id: stickerId,
    });
    if (error) {
      console.log('[storiesService.getMyStickerResponse]', error.message);
      return null;
    }
    return data as StickerResponse | null;
  },
};

export type StickerResponse = {
  id: string;
  story_id: string;
  sticker_id: string;
  user_id: string;
  response_type: string;
  text_value: string | null;
  number_value: number | null;
  option_id: string | null;
  created_at: string;
  full_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
};