/**
 * usePublishOrchestrator.ts
 *
 * Owns: publishing flag, upload pipeline, per-draft state transitions, exit animation.
 * Does NOT own: draft creation or editing (receives drafts + setDrafts).
 * Does NOT own: bloom state (receives closeBloom as stable callback).
 *
 * Source of truth: publishing.
 * Persistence owner: draft.uploadState transitions (idle > uploading > done | error).
 * Cleanup: mountedRef guards all async state updates.
 * Async orchestration: sequential upload loop. Future: AbortController for AI enhancement.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { showMessage } from 'react-native-flash-message';
import { storiesService, type StoryUploadCache } from '../../services/storiesService';
import { supabase } from '../../services/supabase';
import { duration } from '../../constants/tokens';
import { PublicationAttempt } from '../../utils/publication';
import { authorId as currentAuthorId } from '../../stores/actorStore';

interface Draft {
  id: string;
  localUri: string | null;
  thumbnailUri: string | null;
  mediaFit: any;
  textBgId: any;
  mediaType: 'image' | 'video' | 'text';
  caption: string;
  scope: 'global';
  audience?: 'everyone' | 'followers' | 'close_friends' | 'only_with' | 'except';
  sharedWith?: string[] | null;
  hiddenMentions?: { id: string; username: string }[] | null;
  allowMentionReshare?: boolean;
  reach?: 'followers' | 'wider';
  uploadState: 'idle' | 'uploading' | 'done' | 'error';
  errorMsg?: string | null;
  durationSec?: number | null;
  pollData?: { question: string; options: string[]; nx?: number; ny?: number; scale?: number } | null;
  stickers?: any[];
  mediaTransform: any;
  category: any;
  textBackground: any;
  dualFrontUri?: string | null;
  dualLayout?: any;
  audio?: any;
  filterId?: string | null;
}

export interface PublishOrchestratorInput {
  drafts: Draft[];
  setDrafts: React.Dispatch<React.SetStateAction<Draft[]>>;
  myId: string | null;
  navigation: any;
  closeBloom: () => void;
  mediaOpacity: Animated.Value;
  mediaScale: Animated.Value;
}

export interface PublishOrchestratorOutput {
  publishing: boolean;
  canPublish: boolean;
  publishAll: () => Promise<void>;
}

function draftContent(draft: Draft): string {
  const { uploadState: _state, errorMsg: _error, ...content } = draft;
  return JSON.stringify(content);
}

export function usePublishOrchestrator(input: PublishOrchestratorInput): PublishOrchestratorOutput {
  const {
    drafts, setDrafts, myId, navigation,
    closeBloom, mediaOpacity, mediaScale,
  } = input;

  const [publishing, setPublishing] = useState(false);
  const mountedRef = useRef(true);
  const publishingRef = useRef(false);
  const uploadCache = useRef<StoryUploadCache>(new Map());
  const latestDrafts = useRef(drafts);
  latestDrafts.current = drafts;
  const attempts = useRef(new Map<string, { userId: string; authorId: string; draft: Draft; progress: PublicationAttempt }>());

  // Own lifecycle internally. No consumer coordination needed.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const canPublish = drafts.some((d) => d.uploadState !== 'done' && !attempts.current.get(d.id)?.progress.uncertain) && !publishing;

  const publishAll = useCallback(async () => {
    if (!myId || publishingRef.current || drafts.length === 0) return;
    publishingRef.current = true;
    setPublishing(true);

    try { closeBloom(); } catch { /* Animation must not strand publication. */ }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    let successCount = 0;
    let failCount = 0;
    // Split publishes share one source file: upload once, reuse for siblings.
    const uploadedByUri: Record<string, { url: string; thumb: string | null }> = {};

    for (let i = 0; i < drafts.length; i++) {
      if (!mountedRef.current) return;
      let d = drafts[i];

      if (d.uploadState === 'done') {
        successCount++;
        continue;
      }

      // Mark uploading
      if (mountedRef.current) {
        setDrafts(prev => prev.map((x) =>
          x.id === d.id ? { ...x, uploadState: 'uploading' as const, errorMsg: null } : x
        ));
      }

      try {
        const author: string = currentAuthorId(myId) ?? myId;
        let attempt = attempts.current.get(d.id);
        if (!attempt) {
          const snapshot = JSON.parse(JSON.stringify(d)) as Draft;
          const progress = new PublicationAttempt(async () => {
            const { data, error: sessionError } = await supabase.auth.getSession();
            if (sessionError || data.session?.user.id !== myId || (currentAuthorId(myId) ?? myId) !== author) throw new Error('Return to the account that started this story to finish it.');
            const current = latestDrafts.current.find((row) => row.id === snapshot.id);
            if (!current || draftContent(current) !== draftContent(snapshot)) throw new Error('This draft changed after sharing started. Restore the original draft to finish the same story, or check your stories before starting again.');
          });
          attempt = { userId: myId, authorId: author, draft: snapshot, progress };
          attempts.current.set(d.id, attempt);
        }
        if (attempt.userId !== myId || attempt.authorId !== author) throw new Error('Return to the account that started this story to finish it.');
        await attempt.progress.check();
        if (attempt.progress.uncertain) throw new Error('The last save could not be confirmed. Check your stories before sharing again.');
        // Keep the original payload: edits after a partial save must not make a
        // second story or silently change what its confirmed steps contain.
        d = attempt.draft;
        const stickerPayload = d.stickers && d.stickers.length > 0 ? JSON.parse(JSON.stringify(d.stickers)) : null;

        const story = await storiesService.uploadAndCreateStory({
          userId: myId,
          publication: attempt.progress,
          expectedAuthorId: attempt.authorId,
          uploadCache: uploadCache.current,
          localUri: d.localUri,
          mediaType: d.mediaType,
          caption: d.caption || null,
          scope: d.scope,
          audience: (d as any).audience || 'everyone',
          sharedWith: (d as any).sharedWith || null,
          reach: (d as any).reach || 'followers',
          durationSec: d.mediaType === 'video' ? Math.round(d.durationSec || 15) : null,
          thumbnailLocalUri: (d as any).thumbnailUri || null,
          stickersJson: stickerPayload,
          mediaTransform: d.mediaTransform || null,
          preUploadedUrl: d.localUri ? (uploadedByUri[d.localUri]?.url ?? null) : null,
          preUploadedThumb: d.localUri ? (uploadedByUri[d.localUri]?.thumb ?? null) : null,
          category: d.category || null,
          textBackground: d.textBackground || null,
          dualFrontLocalUri: d.dualFrontUri || null,
          dualLayout: d.dualLayout || null,
          audio: (d as any).audio || null,
          filterId: (d as any).filterId || null,
        });

        if (d.localUri && (story as any)?.media_url && !uploadedByUri[d.localUri]) {
          uploadedByUri[d.localUri] = { url: (story as any).media_url, thumb: (story as any).thumbnail_url ?? null };
        }

        // Create poll if present
        if (d.pollData) {
          await storiesService.createStoryPoll(story.id, d.pollData.question, d.pollData.options, { nx: d.pollData.nx, ny: d.pollData.ny, scale: d.pollData.scale }, attempt.progress);
        }

        // Mentions: visible ones come from mention stickers, hidden ones from
        // the draft's hidden list. One story_mentions row per person; the DB
        // trigger writes the notification, so there is a single source.
        const visibleIds: string[] = Array.from(new Set(
          (stickerPayload || []).filter((s: any) => s.kind === 'mention' && s.mentionUserId).map((s: any) => String(s.mentionUserId))
        ));
        const hiddenIds: string[] = Array.from(new Set(
          (((d as any).hiddenMentions || []) as any[]).map((h: any) => h?.id).filter(Boolean).map(String)
        ));
        const allowReshare = (d as any).allowMentionReshare !== false;
        const mentionRows = [
          ...visibleIds.map((uid) => ({ story_id: story.id, mentioned_user_id: uid, mentioned_by_user_id: myId, visible: true, allow_reshare: allowReshare })),
          ...hiddenIds.filter((uid) => !visibleIds.includes(uid)).map((uid) => ({ story_id: story.id, mentioned_user_id: uid, mentioned_by_user_id: myId, visible: false, allow_reshare: allowReshare })),
        ];
        // A reshared story card marks the original mention as reshared.
        const resharedIds: string[] = Array.from(new Set((stickerPayload || []).filter((s: any) => s.kind === 'story' && s.storyId).map((s: any) => String(s.storyId))));
        for (const rid of resharedIds) { await attempt.progress.check(); try { await supabase.rpc('mark_story_reshared', { p_story_id: rid }); } catch {} }
        if (mentionRows.length > 0) {
          await attempt.progress.write('mentions', () => supabase.from('story_mentions').insert(mentionRows));
        }


        await attempt.progress.check();
        // Mark done
        if (mountedRef.current) {
          setDrafts(prev => prev.map((x) =>
            x.id === d.id ? { ...x, uploadState: 'done' as const } : x
          ));
        }
        successCount++;
      } catch (e: any) {
        console.error('[Publish]', e?.message);
        const attempt = attempts.current.get(d.id);
        const prefix = attempt?.progress.uncertain
          ? 'Save not confirmed. Check your stories before sharing again. Keep this draft open. '
          : attempt?.progress.postId
            ? 'Story created; some details could not be confirmed. Retry finishes this same story. '
            : '';
        if (!attempt?.progress.postId && !attempt?.progress.uncertain) attempts.current.delete(d.id);
        if (mountedRef.current) {
          setDrafts(prev => prev.map((x) =>
            x.id === d.id ? { ...x, uploadState: 'error' as const, errorMsg: prefix + (e?.message || 'Upload failed') } : x
          ));
        }
        failCount++;
      }
    }

    if (!mountedRef.current) return;
    publishingRef.current = false;
    setPublishing(false);

    if (failCount === 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Animated.parallel([
        Animated.timing(mediaOpacity, { toValue: 0, duration: duration.medium, useNativeDriver: true }),
        Animated.timing(mediaScale, { toValue: 0.96, duration: duration.medium, useNativeDriver: true }),
      ]).start(() => {
        if (mountedRef.current) { showMessage({ message: 'Story shared', type: 'success', duration: 1800 }); const nav: any = navigation; try { const st = nav.getState?.(); console.log('[Publish] exit from', JSON.stringify((st?.routes || []).map((r: any) => r.name))); if ((st?.routes?.length || 0) > 1 && typeof nav.popToTop === 'function') nav.popToTop(); else if (nav.canGoBack?.()) nav.goBack(); } catch (e: any) { console.log('[Publish] exit failed', e?.message); } }
      });
    } else if (successCount === 0) {
      Alert.alert('Sharing incomplete', 'Your drafts are kept. Review each story’s error before trying again.');
    } else {
      Alert.alert('Partial upload', `${successCount} uploaded, ${failCount} failed.`);
    }
  }, [myId, drafts, setDrafts, navigation, closeBloom, mediaOpacity, mediaScale, publishing]);

  return {
    publishing,
    canPublish,
    publishAll,
  };
}
