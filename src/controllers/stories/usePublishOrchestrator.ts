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
import { storiesService } from '../../services/storiesService';
import { supabase } from '../../services/supabase';
import { duration } from '../../constants/tokens';

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
  reach?: 'followers' | 'wider';
  uploadState: 'idle' | 'uploading' | 'done' | 'error';
  errorMsg?: string | null;
  durationSec?: number | null;
  pollData?: { question: string; options: string[] } | null;
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

export function usePublishOrchestrator(input: PublishOrchestratorInput): PublishOrchestratorOutput {
  const {
    drafts, setDrafts, myId, navigation,
    closeBloom, mediaOpacity, mediaScale,
  } = input;

  const [publishing, setPublishing] = useState(false);
  const mountedRef = useRef(true);

  // Own lifecycle internally. No consumer coordination needed.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const canPublish = drafts.length > 0 && !publishing;

  const publishAll = useCallback(async () => {
    if (!myId || publishing || drafts.length === 0) return;
    setPublishing(true);

    closeBloom();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < drafts.length; i++) {
      if (!mountedRef.current) return;
      const d = drafts[i];

      if (d.uploadState === 'done') {
        successCount++;
        continue;
      }

      // Mark uploading
      if (mountedRef.current) {
        setDrafts(prev => prev.map((x, idx) =>
          idx === i ? { ...x, uploadState: 'uploading' as const, errorMsg: null } : x
        ));
      }

      try {
        const stickerPayload = d.stickers && d.stickers.length > 0 ? d.stickers : null;

        const story = await storiesService.uploadAndCreateStory({
          userId: myId,
          localUri: d.localUri,
          mediaType: d.mediaType,
          caption: d.caption || null,
          scope: d.scope,
          audience: (d as any).audience || 'everyone',
          sharedWith: (d as any).sharedWith || null,
          reach: (d as any).reach || 'followers',
          durationSec: d.mediaType === 'video' ? Math.round(d.durationSec || 15) : null,
          thumbnailLocalUri: null,
          stickersJson: stickerPayload,
          mediaTransform: d.mediaTransform || null,
          category: d.category || null,
          textBackground: d.textBackground || null,
          dualFrontLocalUri: d.dualFrontUri || null,
          dualLayout: d.dualLayout || null,
          audio: (d as any).audio || null,
          filterId: (d as any).filterId || null,
        });

        // Create poll if present
        if (d.pollData) {
          try {
            await storiesService.createStoryPoll(story.id, d.pollData.question, d.pollData.options);
          } catch (pollErr: any) {
            console.error('[Publish] poll creation failed:', pollErr?.message);
          }
        }

        // Send mention notifications
        const mentionUserIds = [
          ...new Set(
            (stickerPayload || [])
              .filter((s: any) => s.kind === 'mention' && s.mentionUserId)
              .map((s: any) => s.mentionUserId)
          ),
        ];
        for (const mentionedId of mentionUserIds) {
          try {
            await supabase.from('notifications').insert({
              recipient_id: mentionedId,
              actor_id: myId,
              type: 'story_mention',
              message: 'mentioned you in their story',
              body_preview: d.caption?.trim()?.slice(0, 100) || null,
              data: { story_id: story.id },
              account_type: 'personal',
            });
          } catch (notifErr) {
            console.error('[Publish] mention notification failed:', notifErr);
          }
        }


        // Mark done
        if (mountedRef.current) {
          setDrafts(prev => prev.map((x, idx) =>
            idx === i ? { ...x, uploadState: 'done' as const } : x
          ));
        }
        successCount++;
      } catch (e: any) {
        console.error('[Publish]', e?.message);
        if (mountedRef.current) {
          setDrafts(prev => prev.map((x, idx) =>
            idx === i ? { ...x, uploadState: 'error' as const, errorMsg: e?.message || 'Upload failed' } : x
          ));
        }
        failCount++;
      }
    }

    if (!mountedRef.current) return;
    setPublishing(false);

    if (failCount === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Animated.parallel([
        Animated.timing(mediaOpacity, { toValue: 0, duration: duration.medium, useNativeDriver: true }),
        Animated.timing(mediaScale, { toValue: 0.96, duration: duration.medium, useNativeDriver: true }),
      ]).start(() => {
        if (mountedRef.current) { showMessage({ message: 'Story shared', type: 'success', duration: 1800 }); const nav: any = navigation; if (typeof nav.popToTop === 'function') nav.popToTop(); else nav.goBack(); }
      });
    } else if (successCount === 0) {
      Alert.alert('Upload failed', 'Could not upload. Please try again.');
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
