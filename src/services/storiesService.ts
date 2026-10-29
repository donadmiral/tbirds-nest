import { MUSIC_CATALOG_ENABLED, MUSIC_UNAVAILABLE_MESSAGE } from '../../shared/musicAvailability';
import { canonicalContentMedia } from '../../shared/contentMedia';
import { supabase } from './supabase';
import { hydrateStoryMedia, hydrateSoundMedia, hydrateHighlightMedia } from './contentMedia';
import { PublicationAttempt } from '../utils/publication';
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
  kind?: 'text' | 'emoji' | 'link' | 'location' | 'mention' | 'question' | 'slider' | 'quiz' | 'hashtag' | 'post' | 'story' | 'countdown' | 'gif' | 'photo' | 'time' | 'date' | 'weather' | 'entity' | 'drawing' | 'addyours' | 'notify' | 'magic' | 'support' | 'frame' | 'results';
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
  postArticleTitle?: string | null;
  postMediaUrl?: string | null;
  postMediaType?: string | null;
  postMediaCount?: number;
  postMediaWidth?: number | null;
  postMediaHeight?: number | null;
  mentionUsername?: string;
  questionPrompt?: string;
  sliderEmoji?: string;
  sliderLabel?: string;
  countdownTitle?: string;
  countdownTarget?: string;
  quizQuestion?: string;
  quizOptions?: { id: string; label: string; isCorrect: boolean }[];
  /** Add Yours: the prompt, and where the chain started. */
  addYoursPrompt?: string;
  addYoursOriginStoryId?: string | null;
  addYoursOriginStickerId?: string | null;
  /** Notify: what people opt in to hear about, and when it is. */
  notifyTitle?: string;
  notifyWhen?: string | null;
  /** Magic ball: the question asked. */
  magicQuestion?: string;
  /** Support: a cause with a link. */
  supportTitle?: string;
  supportUrl?: string;
  /** Frame: a Polaroid caption and the moment it was taken; the photo rides photoUri and photoUrl. */
  frameCaption?: string;
  frameTakenAt?: string | null;
  /** Magic ball: an answer fixed on a shared result. */
  magicAnswer?: string;
  /** Results card: final numbers from a quiz or a poll, shared as a story. */
  resultsTitle?: string;
  resultsRows?: { label: string; pct: number; correct?: boolean }[];
  resultsTotal?: number;
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
  /** Creator confirms ownership and permission to publish/reuse this recording. */
  rightsAttested?: boolean;
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
  rights_status?: 'unverified' | 'creator_attested' | 'licensed' | 'blocked';
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

export type StoryUploadCache = Map<string, { url: string; kind: StoryMediaType }>;

export async function uploadAndCreateStory(params: {
  userId: string;
  localUri: string | null;
  mediaType: StoryMediaType;
  caption?: string | null;
  allowReplies?: boolean;
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
  publication?: PublicationAttempt;
  expectedAuthorId?: string;
  /** Successful immutable assets survive a retry within this composer. */
  uploadCache?: StoryUploadCache;
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
    audio: requestedAudio,
    filterId,
  } = params;
  // Restored drafts keep their visual edits and the original audio in the video.
  // Catalog/voiceover uploads and sound publication are outside this release.
  const audio = MUSIC_CATALOG_ENABLED ? requestedAudio : null;
  const preUploadedUrl = (params as any).preUploadedUrl ?? null;
  const preUploadedThumb = (params as any).preUploadedThumb ?? null;

  if (!userId) throw new Error('userId required');
  if (audience === 'only_with' && !sharedWith?.length) throw new Error('Choose at least one person to share with.');
  const expectedAuthor = params.expectedAuthorId ?? currentAuthorId(userId) ?? userId;
  const publication = params.publication ?? new PublicationAttempt(async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || data.session?.user.id !== userId || (currentAuthorId(userId) ?? userId) !== expectedAuthor) throw new Error('Return to the account that started this story to finish it.');
  });
  await publication.check();
  const existing = publication.get<StoryRow>('story');
  if (existing) {
    await finishStorySound(existing.id, audio, publication);
    await finishStoryRecipients(existing.id, audience, sharedWith, publication);
    return existing;
  }
  if (mediaType !== 'text' && !localUri) throw new Error('localUri required for image/video');

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;
  const cache = params.uploadCache ?? new Map();
  const jobs: Array<() => Promise<void>> = [];
  // Never mutate the draft. Local URIs remain available for preview/retry, but
  // only remote URLs are written to the published story.
  const publishedStickers = (stickersJson ?? [])
    .filter((s) => !(s.kind === 'photo' && s.photoShape === 'cell' && !s.photoUri && !s.photoUrl))
    .map((s) => ({ ...s }));

  const performUpload = async (role: string, uri: string, kind: 'image' | 'video' | 'audio') => {
    await publication.check();
    const cacheKey = JSON.stringify([userId, expectedAuthor, kind, uri]);
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    let uploadUri = uri;
    let ext = uri.toLowerCase().endsWith('.caf') ? 'caf' : 'm4a';
    let mime = ext === 'caf' ? 'audio/x-caf' : 'audio/mp4';
    let actualKind: StoryMediaType = kind === 'audio' ? 'text' : kind;
    if (kind !== 'audio') {
      const meta = resolveMediaMeta(kind, uri, role === 'media' ? hintMimeType : null, role === 'media' ? hintFileName : null);
      const trueMeta = await resolveTrueMeta(uri, kind, meta.ext, meta.mimeType);
      const safe = await ensureUploadSafe(uri, trueMeta.kind, trueMeta.ext);
      uploadUri = safe.uri; ext = safe.ext; mime = safe.mime;
      actualKind = safe.kind ?? trueMeta.kind;
    }
    await publication.check();
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || data.session?.user.id !== userId || !data.session?.access_token) throw new Error('Sign in again to upload this story. Your draft is kept.');
    const name = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${role}.${ext}`;
    const form = new FormData();
    form.append('file', { uri: uploadUri, type: mime, name: `${role}.${ext}` } as any);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(`${supabaseUrl}/storage/v1/object/story-media/${name}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: supabaseKey, 'x-upsert': 'false' },
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Could not upload ${role.replace(/_/g, ' ')} (${response.status}). Retry to finish sharing your story.`);
      const asset = { url: `${supabaseUrl}/storage/v1/object/public/story-media/${name}`, kind: actualKind };
      cache.set(cacheKey, asset);
      return asset;
    } catch (error: any) {
      if (controller.signal.aborted) throw new Error(`Uploading ${role.replace(/_/g, ' ')} timed out. Your draft is kept. Please retry.`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  const inFlight = new Map<string, Promise<{ url: string; kind: StoryMediaType }>>();
  const uploadAsset = (role: string, uri: string, kind: 'image' | 'video' | 'audio') => {
    const key = JSON.stringify([kind, uri]);
    const current = inFlight.get(key);
    if (current) return current;
    const work = performUpload(role, uri, kind);
    inFlight.set(key, work);
    return work;
  };

  let mediaPublicUrl: string | null = preUploadedUrl;
  let thumbnailUrl: string | null = preUploadedThumb;
  let dualFrontPublicUrl: string | null = null;
  let effectiveMediaType: StoryMediaType = mediaType;
  let audioFinalUrl: string | null = null;
  let audioMeta: { title: string | null; source: string; durationSec: number | null } | null = null;
  if (!mediaPublicUrl && mediaType !== 'text' && localUri) {
    jobs.push(async () => { const asset = await uploadAsset('media', localUri, mediaType); mediaPublicUrl = asset.url; effectiveMediaType = asset.kind; });
  }
  if (thumbnailLocalUri && !thumbnailUrl) {
    jobs.push(async () => { thumbnailUrl = (await uploadAsset('thumbnail', thumbnailLocalUri, 'image')).url; });
  }
  if (dualFrontLocalUri) {
    jobs.push(async () => { dualFrontPublicUrl = (await uploadAsset('front_photo', dualFrontLocalUri, 'image')).url; });
  }
  if (audio?.kind === 'voiceover' && audio.localUri) {
    if (!audio.rightsAttested) throw new Error('Confirm that you own and can publish this voiceover before sharing.');
    if (!audio.durationSec || !Number.isFinite(audio.durationSec) || audio.durationSec < 1 || audio.durationSec > 30) throw new Error('Record a voiceover between 1 and 30 seconds.');
    audioMeta = { title: audio.title || 'Voiceover', source: 'voiceover', durationSec: audio.durationSec ?? null };
    jobs.push(async () => { audioFinalUrl = (await uploadAsset('voiceover', audio.localUri!, 'audio')).url; });
  } else if (audio?.kind === 'sound') {
    if (!audio.soundId) throw new Error('Choose an available sound from the sound library.');
    const { data: sounds, error } = await supabase.rpc('get_playable_sound', { p_sound_id: audio.soundId, p_use: 'story' });
    const sound = sounds?.[0];
    if (error || !sound) throw new Error('This sound is no longer available for reuse. Choose another sound.');
    audioFinalUrl = sound.url;
    audioMeta = { title: sound.title, source: sound.source, durationSec: sound.duration_sec };
  }
  for (const sticker of publishedStickers) {
    if (sticker.photoUri && !sticker.photoUrl) {
      jobs.push(async () => {
        sticker.photoUrl = (await uploadAsset('photo_sticker', sticker.photoUri!, 'image')).url;
        delete sticker.photoUri;
      });
    } else if (sticker.photoUrl) {
      delete sticker.photoUri;
    }
  }
  // A few independent assets can upload together without overwhelming a
  // phone's radio or decoding several large videos at once. Wait for in-flight
  // work before exposing Retry so successful assets can be reused safely.
  let nextJob = 0;
  let uploadError: unknown;
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => {
    while (!uploadError && nextJob < jobs.length) {
      const job = jobs[nextJob++];
      try { await job(); } catch (error) { uploadError ??= error; }
    }
  }));
  if (uploadError) throw uploadError;
  await publication.check();

  const insertPayload: any = {
    user_id: expectedAuthor,
    media_url: mediaPublicUrl,
    media_type: effectiveMediaType,
    thumbnail_url: thumbnailUrl,
    duration_sec: durationSec ?? null,
    caption: caption?.trim() || null,
    scope,
    audience: audience || 'everyone',
    allow_replies: params.allowReplies !== false,
    reach: reach || 'followers',
    affiliation_id: affiliationId || null,
  };

  if (publishedStickers.length > 0) {
    insertPayload.stickers_json = publishedStickers;
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

  // A lost response must never trigger a fresh server-generated story ID.
  // The caller retains this checkpoint for the draft and current author.
  const data = await publication.write('story', () => supabase.from('stories').insert(canonicalContentMedia(insertPayload, supabaseUrl)).select().single());
  if (!data) { publication.uncertain = true; throw new Error('Could not confirm the story. Check your stories before trying again.'); }
  publication.postId = data.id;

  const postStickers = ((insertPayload.stickers_json || []) as any[]).filter((s: any) => s?.kind === 'post' && s?.postId);
  Array.from(new Set(postStickers.map((s: any) => s.postId))).forEach((pid: any) => {
    supabase.rpc('increment_share_count', { p_post_id: pid }).then(() => {}, () => {});
  });

  await finishStorySound(data.id, audio, publication);
  if (audio && audio.kind === 'sound' && audio.soundId) {
    supabase.rpc('increment_sound_use', { p_sound_id: audio.soundId }).then(() => {}, () => {});
  }

  await finishStoryRecipients(data.id, audience, sharedWith, publication);
  return data as StoryRow;
}

async function finishStorySound(storyId: string, audio: StoryAudioDraft | null | undefined, publication: PublicationAttempt) {
  if (!MUSIC_CATALOG_ENABLED || audio?.kind !== 'voiceover' || !audio.addToSounds) return;
  if (!audio.rightsAttested) throw new Error('Confirm the rights to your original sound before making it reusable.');
  await publication.check();
  // This RPC is idempotent per story, so a lost response is safe to retry.
  const { data, error } = await supabase.rpc('publish_story_sound', { p_story_id: storyId, p_rights_attested: true });
  if (error || !data) throw new Error('Your story was saved, but its reusable sound could not be confirmed. Retry to finish sharing the sound.');
}

async function finishStoryRecipients(storyId: string, audience: string | null | undefined, sharedWith: string[] | null | undefined, publication: PublicationAttempt) {
  if (audience === 'only_with') {
    const rows = Array.from(new Set(sharedWith ?? [])).map((uid) => ({ story_id: storyId, user_id: uid }));
    if (!rows.length) throw new Error('Choose at least one person to share with.');
    await publication.write('recipients', () => supabase.from('story_shared_with').insert(rows));
  }
}

export const storiesService = {
  uploadAndCreateStory,

  async getStorySound(id: string): Promise<StorySound> {
    if (!MUSIC_CATALOG_ENABLED) throw new Error(MUSIC_UNAVAILABLE_MESSAGE);
    const { data: sounds, error } = await supabase.rpc('get_playable_sound', { p_sound_id: id, p_use: 'story' });
    const data = sounds?.[0];
    if (error || !data) throw new Error('This sound is no longer available. Choose another sound.');
    const [sound] = await hydrateSoundMedia([data as StorySound]);
    if (!sound.url) throw new Error('This sound could not load. Please retry.');
    return { ...sound, duration_sec: Math.min(sound.duration_sec || 30, (data as any).max_excerpt_sec || 30, 30) };
  },

  async listStorySounds(source: 'original' | 'library', limit = 50): Promise<StorySound[]> {
    if (!MUSIC_CATALOG_ENABLED) return [];
    const { data, error } = await supabase.rpc('list_playable_sounds', { p_use: 'story', p_limit: Math.min(100, Math.max(1, Math.trunc(limit) || 50)), p_query: '' });
    if (error) throw new Error('Sounds could not be loaded. Please try again.');
    return hydrateSoundMedia(((data || []) as (StorySound & { max_excerpt_sec?: number })[]).filter(sound => sound.source === source).map(sound => ({...sound, duration_sec: Math.min(sound.duration_sec || 30, sound.max_excerpt_sec || 30, 30)})));
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

  async getStoryOwner(storyId: string): Promise<string> {
    const { data: allowed, error: permissionError } = await supabase.rpc('viewer_can_see_story', { p_story_id: storyId });
    if (permissionError || allowed !== true) throw new Error('This story is no longer available.');
    const { data, error } = await supabase.from('stories').select('user_id,expires_at').eq('id', storyId).maybeSingle();
    if (error || !data || !data.expires_at || Date.parse(data.expires_at) <= Date.now()) throw new Error('This story is no longer available.');
    return data.user_id;
  },

  async getUserStories(userId: string): Promise<StoryRow[]> {
    const { data, error } = await supabase.rpc('get_user_stories', {
      p_user_id: userId,
    });
    if (error) {
      throw new Error('Stories could not be loaded. Please try again.');
    }
    return hydrateStoryMedia((data || []) as StoryRow[]);
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
    pos?: { nx?: number; ny?: number; scale?: number },
    publication = new PublicationAttempt(),
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
    const poll = await publication.write('poll', () => supabase
      .from('story_polls')
      .insert({
        story_id: storyId,
        question: trimmedQuestion,
        ...(pos && typeof pos.nx === 'number' ? { nx: pos.nx } : {}),
        ...(pos && typeof pos.ny === 'number' ? { ny: pos.ny } : {}),
        ...(pos && typeof pos.scale === 'number' ? { scale: pos.scale } : {}),
      })
      .select('id')
      .single());

    if (!poll) { publication.uncertain = true; throw new Error('Could not confirm the story poll.'); }

    // Insert options
    const optionRows = trimmedOptions.map((label, i) => ({
      poll_id: poll.id,
      label,
      position: i,
    }));

    await publication.write('poll-options', () => supabase.from('story_poll_options').insert(optionRows));

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
    return hydrateHighlightMedia((data || []) as StoryHighlight[]);
  },

  async getHighlightStories(highlightId: string): Promise<StoryRow[]> {
    const { data, error } = await supabase.rpc('get_highlight_stories', { p_highlight_id: highlightId });
    if (error) { console.log('[storiesService.getHighlightStories]', error.message); return []; }
    const [highlight] = await hydrateHighlightMedia([{ id: highlightId, stories: (data || []) as StoryRow[] }]);
    return highlight.stories;
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
    responseType: 'question' | 'slider' | 'quiz' | 'countdown' | 'addyours' | 'notify' | 'magic';
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

  async getStickerSummary(storyId: string, stickerId: string): Promise<{ count: number; average: number | null; options: Record<string, number> }> {
    const { data, error } = await supabase.rpc('get_sticker_response_summary', { p_story_id: storyId, p_sticker_id: stickerId });
    if (error) throw error;
    return data as { count: number; average: number | null; options: Record<string, number> };
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
