"use client";

import { useEffect, useRef } from 'react';
import { attachAdaptiveVideo } from '@/lib/adaptiveVideo';

/** Only prepared content tickets select HLS; ordinary channel media stays original. */
export function ChannelVideo({ source, onError }: { source: string; onError: () => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const retry = useRef(onError);
  retry.current = onError;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const attachment = attachAdaptiveVideo(element, source);
    const recover = () => { if (!attachment.recover()) retry.current(); };
    const pauseHidden = () => { if (document.hidden) element.pause(); };
    element.addEventListener('error', recover);
    document.addEventListener('visibilitychange', pauseHidden);
    return () => {
      document.removeEventListener('visibilitychange', pauseHidden);
      element.removeEventListener('error', recover);
      attachment.dispose();
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  }, [source]);
  return <video ref={video} preload="metadata" controls playsInline className="mt-2 max-h-[340px] w-auto max-w-full rounded-lg" onPlay={event => { if (document.hidden) event.currentTarget.pause(); }} />;
}
