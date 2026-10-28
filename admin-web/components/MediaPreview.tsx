'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export default function MediaPreview({ url, video = false, thumbnail = false }: {
  url: string; video?: boolean; thumbnail?: boolean;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, startTransition] = useTransition();
  if (failed) return (
    <button type="button" disabled={pending} aria-label="Reload media preview"
      onClick={event => {
        event.stopPropagation();
        setRetry(value => value + 1);
        setFailed(false);
        // The server rechecks the staff session and obtains a fresh capability.
        startTransition(() => router.refresh());
      }}
      style={{ width: '100%', minHeight: thumbnail ? 42 : 120, background: 'var(--panel)',
        color: 'var(--txt-muted)', border: 0, cursor: 'pointer', padding: thumbnail ? 4 : 16 }}>
      {thumbnail ? '↻' : 'Preview unavailable. Reload preview'}
    </button>
  );
  const style = { display: 'block', width: '100%', height: thumbnail ? '100%' : undefined,
    maxHeight: thumbnail ? undefined : 320, objectFit: thumbnail ? 'cover' as const : 'contain' as const };
  return video
    ? <video key={`${url}:${retry}`} src={url} controls={!thumbnail} muted={thumbnail} playsInline
        preload="metadata" onError={() => setFailed(true)}
        onLoadedMetadata={event => {
          if (thumbnail && Number.isFinite(event.currentTarget.duration) && event.currentTarget.duration > 0) {
            event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration / 2);
          }
        }} style={{ ...style, background: '#000' }} />
    : <img key={`${url}:${retry}`} src={url} alt={thumbnail ? '' : 'Content preview'}
        onError={() => setFailed(true)} style={style} />;
}
