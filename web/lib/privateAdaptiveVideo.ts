import { createPrivateAdaptiveSession } from '../../shared/privateAdaptiveMedia';
import type Hls from 'hls.js';

export type PrivatePlaybackPosition = { time: number; playing: boolean };
export type PrivateAdaptiveVideo = {
  attach(video: HTMLVideoElement, callbacks: {
    onFallback: (position: PrivatePlaybackPosition) => void;
    onExpired: () => void;
    shouldPlay?: () => boolean;
  }): () => void;
  close(): void;
};

/** Private manifests and every child request keep authorization in headers. */
export async function openPrivateAdaptiveVideo(options: {
  token: string;
  messageId: string;
  requestId: string;
  current: () => boolean;
}): Promise<PrivateAdaptiveVideo | null> {
  if (process.env.NEXT_PUBLIC_PRIVATE_HLS !== 'true' || !options.current()) return null;
  const { default: HlsPlayer, FetchLoader } = await import('hls.js');
  // Native Safari HLS cannot apply our bearer header to every child request.
  if (!options.current() || !HlsPlayer.isSupported()) return null;
  const transport = createPrivateAdaptiveSession({
    endpoint: process.env.NEXT_PUBLIC_SUPABASE_URL + '/functions/v1/private-hls',
    apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    ...options,
  });
  let ready: Awaited<ReturnType<typeof transport.open>>;
  try { ready = await transport.open(); } catch { void transport.close(); return null; }
  if (!ready || !options.current()) { void transport.close(); return null; }
  let closed = false, expired = false, attached = false, player: Hls | null = null, element: HTMLVideoElement | null = null;
  let expiryCallback: (() => void) | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(expiryTimer);
    player?.destroy(); player = null;
    if (element) { element.pause(); element.removeAttribute('src'); element.load(); element = null; }
    void transport.close();
  };
  const expiryTimer = setTimeout(() => { expired = true; close(); expiryCallback?.(); }, Math.max(0, ready.expiresAt - Date.now()));
  return {
    close,
    attach(video, callbacks) {
      if (!closed && attached && element === video && options.current()) return close;
      if (closed || attached || !options.current()) { close(); if (expired && options.current()) callbacks.onExpired(); return () => {}; }
      attached = true; element = video; expiryCallback = callbacks.onExpired;
      const usable = () => !closed && options.current() && Date.now() < ready!.expiresAt;
      const failed = (revoked = false) => {
        if (closed) return;
        const position = { time: Number.isFinite(video.currentTime) ? video.currentTime : 0, playing: callbacks.shouldPlay?.() ?? !video.paused };
        close();
        if (!options.current()) return;
        if (revoked) callbacks.onExpired(); else callbacks.onFallback(position);
      };
      try {
        const policy = { default: { maxTimeToFirstByteMs: 5000, maxLoadTimeMs: 12000,
          timeoutRetry: { maxNumRetry: 1, retryDelayMs: 250, maxRetryDelayMs: 500 },
          errorRetry: { maxNumRetry: 1, retryDelayMs: 250, maxRetryDelayMs: 500 } } };
        player = new HlsPlayer({
          loader: FetchLoader,
          fetchSetup: async (context, init) => {
            const headers = usable() ? transport.authorize(context.url) : null;
            if (!headers) throw new Error('Private playback authorization ended.');
            const requestHeaders = new Headers(init.headers);
            for (const [name, value] of Object.entries(headers)) requestHeaders.set(name, value);
            return new Request(context.url, { ...init, headers: requestHeaders,
              cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
          },
          manifestLoadPolicy: policy, playlistLoadPolicy: policy, fragLoadPolicy: policy, keyLoadPolicy: policy,
          maxBufferLength: 6, backBufferLength: 0, maxMaxBufferLength: 10,
          maxBufferSize: 6 * 1024 * 1024, capLevelToPlayerSize: true,
          enableWorker: true, lowLatencyMode: false,
        });
        player.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (data.fatal) failed([401, 403, 410].includes(data.response?.code || 0));
        });
        player.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
          if (usable() && (callbacks.shouldPlay?.() ?? true)) void video.play().catch(() => {});
        });
        player.loadSource(ready!.uri);
        player.attachMedia(video);
      } catch { failed(); }
      return close;
    },
  };
}
