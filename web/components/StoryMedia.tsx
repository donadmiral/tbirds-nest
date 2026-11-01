'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import type { StoryRow } from '@/lib/stories';
import { watchStoryVideoFrame } from '@/lib/storyMediaReadiness';
import { memoryStoryRecipe } from '../../shared/memoryStoryPresentation';
import { StoryPixelGrade } from './StoryPixelGrade';

function mediaStyle(story: StoryRow): CSSProperties {
  const transform = story.media_transform;
  if (!transform || typeof transform !== 'object') return { objectFit: 'contain' };
  return { objectFit: transform.fit === 'contain' ? 'contain' : 'cover',
    transform: `translate(${(transform.translateNX || 0) * 100}%, ${(transform.translateNY || 0) * 100}%) scale(${transform.scale || 1})` };
}

/** The upcoming slot becomes the displayed slot without replacing its media node. */
export function StoryMedia({ story, active, paused, muted, player, onReady, onError, onBlocked, onTime, onEnd }: {
  story: StoryRow; active: boolean; paused: boolean; muted: boolean;
  player: MutableRefObject<HTMLVideoElement | null>;
  onReady: () => void; onError: () => void; onBlocked: () => void;
  onTime: (time: number) => void; onEnd: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null), image = useRef<HTMLImageElement>(null);
  const [decoded, setDecoded] = useState(false), [posterFailed, setPosterFailed] = useState(false);
  const live = useRef(true), configured = useRef(false), finished = useRef(false);
  const state = useRef({ active, paused, onReady, onError, onBlocked, onTime, onEnd });
  useLayoutEffect(() => { state.current = { active, paused, onReady, onError, onBlocked, onTime, onEnd }; }, [active, paused, onReady, onError, onBlocked, onTime, onEnd]);
  useLayoutEffect(() => {
    const node = video.current;
    if (active) player.current = node;
    return () => { if (player.current === node) player.current = null; };
  }, [active, player]);
  const allowed = () => live.current && state.current.active && !state.current.paused && !document.hidden && document.documentElement.dataset.platinumCallActive !== 'true';
  const play = () => {
    const node = video.current;
    if (!node || !configured.current) return;
    if (!allowed()) { node.pause(); return; }
    void node.play().then(() => { if (!allowed()) node.pause(); }).catch(error => {
      if (!allowed()) return;
      if (error?.name === 'NotAllowedError') state.current.onBlocked();
      else if (error?.name !== 'AbortError') state.current.onError();
    });
  };
  const configure = () => {
    const node = video.current;
    if (!node || node.readyState < 1) return;
    const recipe = memoryStoryRecipe(story.media_transform, node.duration);
    node.playbackRate = recipe.speed; node.volume = recipe.volume;
    if (!configured.current) {
      configured.current = true;
      if (Math.abs(node.currentTime - recipe.start) > .01) node.currentTime = recipe.start;
    }
    play();
  };
  useEffect(() => {
    live.current = true;
    const node = video.current;
    if (!node || !story.media_url) return () => { live.current = false; };
    // React Strict Mode can replay this effect after its resource cleanup.
    if (node.getAttribute('src') !== story.media_url) { configured.current = false; node.src = story.media_url; node.load(); }
    configure();
    const cancel = watchStoryVideoFrame(node, { source: story.media_url,
      start: () => memoryStoryRecipe(story.media_transform, node.duration).start,
      current: () => live.current && video.current === node,
      ready: () => setDecoded(true) });
    return () => { live.current = false; cancel(); node.pause(); node.removeAttribute('src'); node.load(); };
    // The parent keys each slot by its exact media source and edit recipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.media_url]);
  useEffect(() => { play(); }, [active, paused]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (active && decoded) state.current.onReady(); }, [active, decoded]);
  const imageLoaded = (node: HTMLImageElement) => {
    const current = () => live.current && image.current === node && node.isConnected && node.getAttribute('src') === story.media_url;
    if (!current() || !node.complete || !node.naturalWidth) return;
    void (typeof node.decode === 'function' ? node.decode() : Promise.resolve()).then(() => {
      if (current()) setDecoded(true);
    }).catch(() => { if (current() && state.current.active) state.current.onError(); });
  };
  useEffect(() => { if (image.current) imageLoaded(image.current); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const failed = () => { if (live.current && state.current.active) state.current.onError(); };
  const finish = () => { if (allowed() && !finished.current) { finished.current = true; video.current?.pause(); state.current.onEnd(); } };
  return <div className="absolute inset-0" style={{ visibility: active ? 'visible' : 'hidden', pointerEvents: active ? undefined : 'none' }} aria-hidden={!active} inert={!active} data-story-media={story.id} data-story-media-owner={story.user_id} data-story-media-active={active} data-story-frame-ready={decoded}>
    <StoryPixelGrade className="h-full w-full" look={{ filterId: story.filter_id, filterAmt: story.media_transform?.filterAmt, adjust: story.media_transform?.adjust }}>
      {story.media_type === 'video' ? <>
        {!decoded && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60" aria-hidden>
          {story.thumbnail_url && !posterFailed
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={story.thumbnail_url} alt="" className="h-full w-full" style={mediaStyle(story)} onError={() => setPosterFailed(true)} /> : 'Video story'}
        </div>}
        <video ref={video} src={story.media_url || undefined} preload="auto" playsInline muted={!active || muted || memoryStoryRecipe(story.media_transform).volume === 0}
          onLoadedMetadata={configure} onCanPlay={configure} onError={failed}
          onPlay={event => { if (!allowed()) event.currentTarget.pause(); }}
          onTimeUpdate={event => {
            if (!allowed()) return;
            const node = event.currentTarget, recipe = memoryStoryRecipe(story.media_transform, node.duration);
            state.current.onTime(node.currentTime);
            if (recipe.end != null && node.currentTime >= recipe.end - .025) finish();
          }} onEnded={finish} className="h-full w-full" style={{ ...mediaStyle(story), opacity: decoded ? 1 : 0 }} />
      </> : (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={image} src={story.media_url || undefined} alt="" onLoad={event => imageLoaded(event.currentTarget)} onError={failed}
          className="h-full w-full" style={{ ...mediaStyle(story), opacity: decoded ? 1 : 0 }} />
      )}
    </StoryPixelGrade>
  </div>;
}
