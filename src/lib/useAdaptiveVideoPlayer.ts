import { useEffect, useMemo } from 'react';
import { useVideoPlayer, type VideoPlayer } from 'expo-video';
import { knownAdaptiveMedia, resolveAdaptiveMedia } from '../../shared/adaptiveMedia';

/** Selects a warm source once. Cold discovery never replaces loaded pixels. */
export function useAdaptiveVideoPlayer(uri: string | null, setup?: (player: VideoPlayer) => void, originalFallback?: string|null): VideoPlayer {
  const source = useMemo(() => {
    if (!uri) return null;
    const ready = process.env.EXPO_PUBLIC_ADAPTIVE_MEDIA === 'true' ? knownAdaptiveMedia(uri) : null;
    return ready ? { uri: ready.hlsUrl, contentType: 'hls' as const, useCaching: false } : { uri, useCaching: false };
  }, [uri]);
  const player = useVideoPlayer(source, setup);
  useEffect(() => {
    if (!uri || !source || (!originalFallback && process.env.EXPO_PUBLIC_ADAPTIVE_MEDIA !== 'true')) return;
    let alive = true, adaptive = source.uri !== uri || !!originalFallback, restoring = false;
    const recover = () => {
      if (!alive || !adaptive || restoring) return;
      restoring = true; adaptive = false;
      const at = player.currentTime, playing = player.playing;
      void player.replaceAsync({ uri:originalFallback || uri, useCaching: false }).then(() => {
        if (!alive) return;
        try { if (at > 0) player.currentTime = at; if (playing) player.play(); } catch {}
      }).catch(() => {}).finally(() => { restoring = false; });
    };
    const listener = player.addListener('statusChange', event => { if (event.status === 'error') recover(); });
    if (!adaptive && !originalFallback) void resolveAdaptiveMedia(uri);
    return () => { alive = false; listener.remove(); };
  }, [player, source, uri, originalFallback]);
  return player;
}
