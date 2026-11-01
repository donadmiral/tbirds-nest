import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { cancelAnimation, Easing, runOnJS, withTiming, type SharedValue } from 'react-native-reanimated';
import { STORY_LOAD_TIMEOUT_MS, STORY_STALL_NOTICE_MS, StoryPlaybackScope, storyVideoWindow, type StoryMediaStatus } from '../../shared/storyPlayback';

type Input = {
  storyKey: string;
  mediaType?: string;
  durationSec?: number | null;
  mediaTransform?: { trimStart?: number; trimEnd?: number; speed?: number; mix?: { orig?: number } | null } | null;
  imageDurationMs: number;
  player: any;
  paused: boolean;
  muted: boolean;
  progress: SharedValue<number>;
  onComplete: () => void;
};

/** Readiness, the display clock and completion share one scoped lifecycle. */
export function useStoryPlayback(input: Input) {
  const { storyKey, mediaType, player, progress, paused, muted, imageDurationMs, durationSec, mediaTransform } = input;
  const scope = useMemo(() => new StoryPlaybackScope(storyKey, mediaType === 'text'), [storyKey, mediaType]);
  const current = useRef(scope); current.current = scope;
  const latest = useRef(input); latest.current = input;
  const [revision, redraw] = useReducer((value: number) => value + 1, 0);
  const notify = useCallback(() => { if (current.current === scope && scope.active) redraw(); }, [scope]);
  const isCurrent = useCallback(() => current.current === scope && scope.active, [scope]);
  const onReady = useCallback(() => {
    if (!isCurrent() || scope.error || scope.primaryReady) return;
    if (mediaType === 'video') {
      const window = storyVideoWindow(player.duration, durationSec, mediaTransform?.trimStart, mediaTransform?.trimEnd);
      // A delayed first-frame callback must not reveal a clip halfway through.
      try { if (player.currentTime > window.start + .05) player.currentTime = window.start; } catch {}
    }
    scope.primaryReady = true; notify();
  }, [scope, isCurrent, notify, mediaType, player, durationSec, mediaTransform?.trimStart, mediaTransform?.trimEnd]);
  const onError = useCallback(() => { if (!isCurrent()) return; scope.failed = true; cancelAnimation(progress); try { player?.pause(); } catch {} notify(); }, [scope, isCurrent, notify, player, progress]);
  const reportMedia = useCallback((id: string, status: StoryMediaStatus) => { if (!isCurrent() || scope.assets.get(id) === status || (status === 'removed' && !scope.assets.has(id))) return; scope.report(id, status); notify(); }, [scope, isCurrent, notify]);
  const finish = useCallback(() => {
    if (!isCurrent() || !scope.finish(latest.current.paused)) return;
    cancelAnimation(progress); progress.value = 1;
    try { player?.pause(); } catch {}
    latest.current.onComplete();
  }, [scope, isCurrent, progress, player]);

  useEffect(() => {
    scope.active = true;
    cancelAnimation(progress); progress.value = 0;
    return () => { scope.active = false; cancelAnimation(progress); try { player?.pause(); } catch {} };
  }, [scope, progress, player]);

  useEffect(() => {
    if (mediaType !== 'video' || !storyKey) return;
    let initialized = false, reachedEnd = false, lastPosition = -1, lastMovement = Date.now();
    const setBuffering = (value: boolean) => { if (scope.buffering !== value) { scope.buffering = value; notify(); } };
    const configure = () => {
      if (initialized || !isCurrent()) return;
      initialized = true;
      const window = storyVideoWindow(player.duration, durationSec, mediaTransform?.trimStart, mediaTransform?.trimEnd);
      try { player.currentTime = window.start; player.playbackRate = Number(mediaTransform?.speed) || 1; } catch {}
      lastPosition = window.start; lastMovement = Date.now();
    };
    const tick = (event?: { currentTime?: number }) => {
      if (!isCurrent() || scope.error || scope.completed) return;
      const now = Date.now(), position = Number(event?.currentTime ?? player.currentTime);
      if (latest.current.paused || !scope.primaryReady) { lastMovement = now; lastPosition = position; return; }
      if (Number.isFinite(position) && position > lastPosition + .005) { lastMovement = now; setBuffering(false); }
      if (Number.isFinite(position)) lastPosition = position;
      if (now - lastMovement >= STORY_LOAD_TIMEOUT_MS) { onError(); return; }
      if (now - lastMovement >= STORY_STALL_NOTICE_MS) setBuffering(true);
      if (!scope.canRun(false)) return;
      const window = storyVideoWindow(player.duration, durationSec, mediaTransform?.trimStart, mediaTransform?.trimEnd);
      if (Number.isFinite(position)) progress.value = Math.max(0, Math.min(1, (position - window.start) / window.duration));
      if (reachedEnd || position >= window.end - .04) finish();
    };
    const status = (event: any) => {
      if (!isCurrent()) return;
      const value = event?.status ?? event;
      if (value === 'error' || event?.error) { onError(); return; }
      if (value === 'loading') setBuffering(true);
      if (value === 'readyToPlay') { configure(); setBuffering(false); }
    };
    let timeSubscription: any, endSubscription: any, statusSubscription: any;
    try {
      player.timeUpdateEventInterval = .05;
      statusSubscription = player.addListener('statusChange', status);
      timeSubscription = player.addListener('timeUpdate', tick);
      endSubscription = player.addListener('playToEnd', () => { if (!isCurrent()) return; reachedEnd = true; setBuffering(false); tick(); });
      if (player.status === 'readyToPlay') configure();
    } catch { onError(); }
    const timer = setInterval(() => tick(), 250);
    return () => { clearInterval(timer); timeSubscription?.remove?.(); endSubscription?.remove?.(); statusSubscription?.remove?.(); };
  }, [scope, storyKey, mediaType, player, durationSec, mediaTransform?.trimStart, mediaTransform?.trimEnd, mediaTransform?.speed, isCurrent, notify, onError, finish, progress]);

  useEffect(() => {
    if (mediaType !== 'video') return;
    try {
      const volume = typeof mediaTransform?.mix?.orig === 'number' ? Math.max(0, Math.min(1, mediaTransform.mix.orig / 100)) : 1;
      player.volume = volume; player.muted = muted || volume <= .001;
      // Let the player load/render its first frame. Buffering must not pause
      // the decoder itself, or it cannot recover when more bytes arrive.
      if (paused || scope.error || scope.completed) player.pause(); else player.play();
    } catch { onError(); }
  }, [scope, mediaType, player, paused, muted, mediaTransform?.mix?.orig, revision, onError]);

  useEffect(() => {
    if (!storyKey || mediaType === 'video' || !scope.canRun(paused)) { cancelAnimation(progress); return; }
    const from = Math.max(0, Math.min(1, progress.value));
    progress.value = withTiming(1, { duration: imageDurationMs * (1 - from), easing: Easing.linear }, finished => { if (finished) runOnJS(finish)(); });
    return () => cancelAnimation(progress);
  }, [scope, storyKey, mediaType, paused, imageDurationMs, progress, revision, finish]);

  useEffect(() => {
    if (!storyKey || scope.error || scope.completed || scope.ready) return;
    let waitingSince = Date.now();
    const timer = setInterval(() => {
      if (!isCurrent() || scope.error || scope.completed) return;
      if (latest.current.paused) { waitingSince = Date.now(); return; }
      if (Date.now() - waitingSince >= STORY_LOAD_TIMEOUT_MS) onError();
    }, 250);
    return () => clearInterval(timer);
  }, [scope, storyKey, revision, isCurrent, onError]);

  return { mediaReady: scope.ready, mediaError: scope.error, buffering: scope.buffering, onReady, onError, reportMedia };
}
