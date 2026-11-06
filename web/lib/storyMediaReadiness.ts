/** A loaded header or the frame before a trim is not a displayable story frame. */
export function watchStoryVideoFrame(video: HTMLVideoElement, options: {
  source: string;
  matchesSource?: () => boolean;
  start: () => number;
  current: () => boolean;
  ready: () => void;
}) {
  let disposed = false, delivered = false, frame: number | null = null;
  const current = () => {
    if (disposed || !video.isConnected || !options.current()) return false;
    if (options.matchesSource) return options.matchesSource();
    if (!video.currentSrc) return true;
    try { return video.currentSrc === new URL(options.source, video.ownerDocument.baseURI).href; }
    catch { return video.currentSrc === options.source; }
  };
  const present = (mediaTime = video.currentTime) => {
    const start = options.start();
    return current() && !video.seeking && video.readyState >= 2
      && video.currentTime >= start - .05 && mediaTime >= start - .05;
  };
  const observe = () => {
    if (!current() || delivered || frame !== null || video.readyState < 2 || video.seeking) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      frame = video.requestVideoFrameCallback((_now, metadata) => {
        frame = null;
        if (!current() || delivered) return;
        if (!present(metadata.mediaTime)) { observe(); return; }
        delivered = true; options.ready();
      });
    } else if (present()) {
      delivered = true; options.ready();
    }
  };
  const events = ['loadeddata', 'canplay', 'seeked', 'playing'] as const;
  events.forEach(event => video.addEventListener(event, observe));
  observe();
  return () => {
    disposed = true;
    if (frame !== null) video.cancelVideoFrameCallback?.(frame);
    frame = null;
    events.forEach(event => video.removeEventListener(event, observe));
  };
}
