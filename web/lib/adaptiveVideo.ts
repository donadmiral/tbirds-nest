import { clearAdaptiveMedia, knownAdaptiveMedia, resolveAdaptiveMedia } from '../../shared/adaptiveMedia';
import type Hls from 'hls.js';

/** Tiny readiness only. Video bytes stay under the shared two-buffer lease. */
export function prefetchAdaptiveVideo(source: string) {
  if (process.env.NEXT_PUBLIC_ADAPTIVE_MEDIA === 'true') void resolveAdaptiveMedia(source);
}
export function clearAdaptiveVideo() { clearAdaptiveMedia(); }

/** Owns the same video element; no detached decoder or new visual controls. */
export function attachAdaptiveVideo(video: HTMLVideoElement, source: string, options: { shouldPlay?: () => boolean } = {}) {
  let disposed = false, hls: Hls | null = null, adaptive = false, selected = false, explicit = false;
  let selectedSource = source;
  let resumeListener: (() => void) | null = null;
  const original = (resume = false) => {
    if (disposed) return;
    const at = resume ? video.currentTime : 0, playing = resume && (options.shouldPlay?.() ?? !video.paused);
    hls?.destroy(); hls = null; adaptive = false; selected = true; selectedSource = source;
    if (resumeListener) video.removeEventListener('loadedmetadata', resumeListener);
    if (resume) {
      resumeListener = () => { resumeListener = null; void Promise.resolve().then(() => { if (disposed) return; if (at > 0) video.currentTime = Math.min(at, video.duration || at); if (playing) void video.play().catch(() => {}); }); };
      video.addEventListener('loadedmetadata', resumeListener, { once: true });
    }
    if (video.getAttribute('src') !== source) { video.src = source; video.load(); }
  };
  const prepare = async () => {
    if (process.env.NEXT_PUBLIC_ADAPTIVE_MEDIA !== 'true') { original(); return; }
    const ready = knownAdaptiveMedia(source);
    // A cold discovery must never hold the original's first request or replace
    // its already loaded pixels. Keep the result for the next prepared player.
    if (!ready) { original(); void resolveAdaptiveMedia(source); return; }
    if (disposed || explicit) return;
    // Play can precede this React effect. Never upgrade a running or resumed
    // element merely because a late readiness lookup has just completed.
    if (!video.paused || video.currentTime > .05) { selected = true; return; }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      selected = true; adaptive = true; selectedSource = ready.hlsUrl; video.src = ready.hlsUrl; video.load(); return;
    }
    try {
      const { default: HlsPlayer } = await import('hls.js');
      if (disposed || explicit) return;
      if (!video.paused || video.currentTime > .05) { selected = true; return; }
      if (!HlsPlayer.isSupported()) { original(); return; }
      hls = new HlsPlayer({ maxBufferLength: 8, backBufferLength: 4, maxMaxBufferLength: 20, maxBufferSize: 8 * 1024 * 1024, capLevelToPlayerSize: true, enableWorker: true });
      selected = true; adaptive = true;
      hls.on(HlsPlayer.Events.ERROR, (_event, data) => { if (data.fatal && !disposed) original(true); });
      hls.loadSource(ready.hlsUrl); hls.attachMedia(video);
    } catch { original(); }
  };
  void prepare();
  return {
    sourceIsCurrent() {
      if (disposed || !selected) return false;
      if (adaptive && hls) return hls.media === video && video.currentSrc.startsWith('blob:') && video.currentSrc === video.src;
      let expected = selectedSource;
      try { expected = new URL(selectedSource, video.ownerDocument?.baseURI).href; } catch {}
      return video.getAttribute('src') === selectedSource && (!video.currentSrc || video.currentSrc === expected);
    },
    ensure() { explicit = true; if (!selected) original(); },
    recover() { if (!adaptive || disposed) return false; original(true); return true; },
    dispose() { disposed = true; hls?.destroy(); hls = null; if (resumeListener) video.removeEventListener('loadedmetadata', resumeListener); },
  };
}
