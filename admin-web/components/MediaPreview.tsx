'use client';

import { useEffect, useRef, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { applyPostPlayback } from '../../shared/postVoiceEffects';
import { postAspectRatio, postCaptionAt, postTimeLabel, postTrimWindow, type PostFrameRecipe } from '../../shared/postMediaEditing';
import { STORY_FILTERS, filterCss } from '../../shared/storyFilterAppearance';
import { AdjustOverlay, type StoryAdjust } from './StoryAdjustOverlay';

export type MediaPreviewEdit = PostFrameRecipe & {
  rotation?: number; flipX?: boolean; scale?: number; translateNX?: number; translateNY?: number;
  fit?: 'cover' | 'contain'; filterId?: string | null; filterAmt?: number; adjust?: StoryAdjust | null;
  trimStart?: number | null; trimEnd?: number | null; speed?: number | null; muted?: boolean;
  coverAt?: number | null; coverUrl?: string | null;
};
export type ReviewMedia = { url: string; video?: boolean; width?: number | null; height?: number | null; edit?: MediaPreviewEdit | null };

const bounded = (value: number | null | undefined, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;

type PreviewProps = ReviewMedia & { thumbnail?: boolean };

export default function MediaPreview(props: PreviewProps) {
  // Renewed capabilities and a different attachment must get a fresh media
  // lifecycle, including failure, duration and playback state.
  return <MediaPreviewSource key={`${props.url}:${props.video ? 'video' : 'image'}:${props.edit?.coverUrl ?? ''}`} {...props} />;
}

function MediaPreviewSource({ url, video = false, thumbnail = false, edit, width, height }: PreviewProps) {
  const router = useRouter();
  const player = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, startTransition] = useTransition();
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [muted, setMuted] = useState(!!edit?.muted);
  useEffect(() => {
    if (!video || thumbnail) return;
    const element = player.current;
    const pause = () => element?.pause();
    const visibility = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('platinum:stop-media', pause);
    return () => {
      pause();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('platinum:stop-media', pause);
    };
  }, [video, thumbnail, retry]);
  const trim = postTrimWindow(duration, edit?.trimStart, edit?.trimEnd);
  const aspect = postAspectRatio(edit, width, height, width && height ? width / height : 4 / 5);
  const scale = bounded(edit?.scale, 1, .1, 10);
  const nx = bounded(edit?.translateNX, 0, -2, 2), ny = bounded(edit?.translateNY, 0, -2, 2);
  const rotation = bounded(edit?.rotation, 0, -360, 360);
  const mediaStyle: CSSProperties = { display: 'block', width: '100%', height: '100%', objectFit: edit?.fit ?? (thumbnail ? 'cover' : 'contain'),
    transform: `translate(${nx * 100}%, ${ny * 100}%) scale(${scale}) rotate(${rotation}deg) scaleX(${edit?.flipX ? -1 : 1})` };
  const filter = STORY_FILTERS.find(item => item.id === edit?.filterId);
  const intensity = bounded(edit?.filterAmt, 100, 0, 100) / 100;
  const cue = video && (thumbnail || !hasStarted) ? null : postCaptionAt(edit?.captions, time);
  const showCover = video && !!edit?.coverUrl && !coverFailed && !hasStarted;
  if (failed) return (
    <button type="button" disabled={pending} aria-label="Reload media preview"
      onClick={event => {
        event.stopPropagation();
        setRetry(value => value + 1);
        setFailed(false);
        setCoverFailed(false);
        setPlaying(false);
        setHasStarted(false);
        setDuration(0);
        // The server rechecks the staff session and obtains a fresh capability.
        startTransition(() => router.refresh());
      }}
      style={{ width: '100%', minHeight: thumbnail ? 42 : 120, background: 'var(--panel)',
        color: 'var(--txt-muted)', border: 0, cursor: 'pointer', padding: thumbnail ? 4 : 16 }}>
      {thumbnail ? '↻' : 'Preview unavailable. Reload preview'}
    </button>
  );
  return <div style={{ width: '100%', height: thumbnail ? '100%' : undefined }}>
    <div style={{ position: 'relative', overflow: 'hidden', background: '#10141C', margin: '0 auto',
      width: thumbnail ? '100%' : `min(100%, ${320 * aspect}px)`, height: thumbnail ? '100%' : undefined, aspectRatio: aspect }}>
      {video && !(thumbnail && showCover) ? <video ref={player} key={`${url}:${retry}`} src={url} poster={edit?.coverUrl || undefined} muted={thumbnail || muted} playsInline
        preload="metadata" onError={() => setFailed(true)} onPlay={() => { setPlaying(true); setHasStarted(true); }} onPause={() => setPlaying(false)}
        onLoadedMetadata={event => {
          const element = event.currentTarget;
          if (!Number.isFinite(element.duration) || element.duration <= 0) return;
          const window = postTrimWindow(element.duration, edit?.trimStart, edit?.trimEnd);
          setDuration(element.duration);
          applyPostPlayback(element,edit);
          element.currentTime = thumbnail ? bounded(edit?.coverAt, Math.min(window.start + .1, window.coverEnd), window.start, window.coverEnd) : window.start;
          setTime(element.currentTime);
        }} onTimeUpdate={event => {
          const element = event.currentTarget;
          if (!thumbnail && trim.duration && (element.currentTime >= trim.end || element.currentTime < trim.start - .05)) {
            element.pause(); element.currentTime = trim.start;
          }
          setTime(element.currentTime);
        }} style={mediaStyle} /> : <img key={`${url}:${retry}`} src={thumbnail && showCover ? edit!.coverUrl! : url} alt={thumbnail ? '' : 'Content preview'} onError={() => thumbnail && showCover ? setCoverFailed(true) : setFailed(true)} style={mediaStyle} />}
      {showCover && !thumbnail ? <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}><img src={edit!.coverUrl!} alt="Selected video cover" onError={() => setCoverFailed(true)} style={mediaStyle} /></div> : null}
      {filter ? <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backdropFilter: filterCss(filter.id, intensity), WebkitBackdropFilter: filterCss(filter.id, intensity) }}>
        {filter.layers.map((layer, index) => <div key={index} style={{ position: 'absolute', inset: 0, backgroundColor: layer.color, opacity: layer.opacity * intensity }} />)}
      </div> : null}
      {edit?.adjust ? <AdjustOverlay adjust={edit.adjust} /> : null}
      {cue ? <div style={{ position: 'absolute', left: '8%', right: '8%', zIndex: 2, pointerEvents: 'none', textAlign: 'center',
        ...(cue.position === 'top' ? { top: '10%' } : cue.position === 'middle' ? { top: '44%' } : { bottom: '16%' }) }}>
        <span style={{ display: 'inline-block', maxWidth: '100%', padding: '7px 11px', borderRadius: 5, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
          fontSize: thumbnail ? 12 : 18, lineHeight: 1.35, fontFamily: cue.style === 'clean' ? 'Georgia, serif' : undefined,
          fontWeight: cue.style === 'bold' ? 800 : cue.style === 'highlight' ? 700 : 400,
          color: cue.style === 'highlight' ? '#10213E' : '#FFF', background: cue.style === 'highlight' ? '#F0E4CE' : 'rgba(0,0,0,.58)' }}>{cue.text}</span>
      </div> : null}
    </div>
    {video && !thumbnail ? <div className="pc-media-player-controls" onClick={event => event.stopPropagation()}>
      <button type="button" disabled={!duration} aria-label={playing ? 'Pause video preview' : 'Play video preview'} onClick={() => {
        const element = player.current; if (!element) return;
        if (playing) element.pause(); else { if (element.currentTime >= trim.end - .05) element.currentTime = trim.start; void element.play().catch(() => setFailed(true)); }
      }}>{playing ? 'Pause' : 'Play'}</button>
      <input type="range" aria-label="Video preview position" min={trim.start} max={trim.coverEnd || 1} step={.01} value={Math.min(trim.coverEnd || 1, Math.max(trim.start, time))} disabled={!duration}
        onChange={event => { const next = Math.max(trim.start, Math.min(trim.coverEnd, Number(event.target.value))); if (player.current) player.current.currentTime = next; setHasStarted(true); setTime(next); }} />
      <span>{postTimeLabel(Math.max(0, time - trim.start))} / {postTimeLabel(trim.duration)}</span>
      <button type="button" aria-label={muted ? 'Unmute video preview' : 'Mute video preview'} aria-pressed={muted} onClick={() => setMuted(value => !value)}>{muted ? 'Unmute' : 'Mute'}</button>
    </div> : null}
  </div>;
}
