import { MEMORY_SCORE_DUCK, memoryFilmItems, memoryFilmPhotoDuration, memoryFilmVideoWindow, type MemoryFilmItem, type MemoryFilmPage } from '../../shared/memoryFilm';
import { memoryStoryStickers } from '../../shared/memoryStoryPresentation';
import { storyPhotoColorMatrix } from '../../shared/storyColorMatrix';
import { storyVideoExportLimit, storyVideoLayerWindows, storyVideoMime, type StoryVideoRecipe } from '../../shared/storyVideoComposition';
import { createStoryVideoRenderer } from './storyVideoExport';
import { finalizeRecordedWebm } from './recordedWebm';
import { decodeExportAudio, exportCancelled, exportStep, playExportAudio, type LocalExportAudio } from './videoExportAudio';

export const MEMORY_MOVIE_WIDTH = 720, MEMORY_MOVIE_HEIGHT = 1280;
export const MEMORY_MOVIE_MAX_PAGES = 30, MEMORY_MOVIE_MAX_SECONDS = 300;
type ExportPage = MemoryFilmPage & { dual_front_url?: string | null; audio_url?: string | null; audio_title?: string | null };
export type MemoryMovieProgress = { phase: 'preparing' | 'rendering' | 'finishing'; message: string; percent: number };
export type MemoryMovieCapture = { item: MemoryFilmItem; layer: 'background' | 'overlay'; clock: number };
type Raster = { image: Blob; start: number; end: number };
type Scene = { item: MemoryFilmItem; duration: number; start: number; recipe: StoryVideoRecipe | null; background: Blob; layers: Raster[] };
type ReadyScene = { scene: Scene; video: HTMLVideoElement | null; renderer: ReturnType<typeof createStoryVideoRenderer> | null; background: ImageBitmap; layers: { image: ImageBitmap; start: number; end: number }[]; gain: GainNode | null; source: MediaElementAudioSourceNode | null; dispose: () => void };

/** Whole movies are all-or-nothing. An unavailable layer is never replaced by its poster. */
export function memoryMovieLimit(pages: readonly ExportPage[], soundtrack?: unknown): string | null {
  if (!pages.length) return 'Add a memory before downloading a movie.';
  if (pages.length > MEMORY_MOVIE_MAX_PAGES) return `A browser movie can contain up to ${MEMORY_MOVIE_MAX_PAGES} memories. Create a shorter book before exporting.`;
  if (soundtrack) return 'This book has a saved soundtrack whose export rights are unavailable. Remove that soundtrack before making a movie, or keep reading this book.';
  const items = memoryFilmItems(pages);
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index], item = items[index], prefix = `Memory ${index + 1}: `;
    if (page.dual_front_url) return prefix + 'dual-camera composition cannot be exported yet. The second camera will not be discarded.';
    if (page.audio_url || page.audio_title) return prefix + 'saved added audio cannot be verified for movie export. Remove that saved track before exporting.';
    if ((page.media_type === 'image' || page.media_type === 'video') && !item.uri) return prefix + 'the original media is unavailable. Refresh the book and try again.';
    if (item.uri && /\.gif(?:[?#]|$)|^data:image\/gif/i.test(item.uri)) return prefix + 'animated GIF media cannot be exported yet.';
    const stickers = memoryStoryStickers(page.stickers);
    const posts = stickers.filter(sticker => sticker.kind === 'post');
    if (posts.length && (page.media_url || posts.length > 1)) return prefix + 'a shared-post card layered over another memory cannot be exported yet. The card will not be left out.';
    if (posts.length && !page.media_url && (posts[0].postMediaType === 'image' || posts[0].postMediaType === 'video') && !item.uri) return prefix + 'the original shared media is unavailable. Refresh the book and try again.';
    if (posts.some(post => post.postMediaEdit || post.postMediaPlayback)) return prefix + 'this shared post has its own media edits that movie export cannot reproduce yet. Its edits will not be discarded.';
    // A shared post may itself be the primary media. Any other embedded video
    // remains unsupported; the primary one is rendered as an actual video.
    const artwork = stickers.filter(sticker => !(sticker.kind === 'post' && !page.media_url && sticker.postMediaUrl === item.uri));
    const problem = storyVideoExportLimit(artwork);
    if (problem) return prefix + problem;
  }
  return null;
}

async function videoReady(url: string, signal: AbortSignal, start?: number) {
  const video = document.createElement('video'); video.crossOrigin = 'anonymous'; video.playsInline = true; video.preload = start == null ? 'metadata' : 'auto'; video.muted = true;
  const wait = (event: 'loadedmetadata' | 'loadeddata' | 'seeked') => {
    let success: () => void, failure: () => void;
    return exportStep(new Promise<void>((resolve, reject) => {
      success = () => resolve(); failure = () => reject(new Error('A memory video could not load. Refresh its private media link and retry.'));
      video.addEventListener(event, success, { once: true }); video.addEventListener('error', failure, { once: true });
    }), signal, 'A memory video took too long to load. Refresh the book and retry.').finally(() => { video.removeEventListener(event, success); video.removeEventListener('error', failure); });
  };
  try {
    const metadata = wait('loadedmetadata'); video.src = url; video.load(); await metadata;
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) throw new Error('A memory video has no finite duration or readable dimensions.');
    if (start != null) {
      if (start > .001) { const sought = wait('seeked'); video.currentTime = start; await sought; if (Math.abs(video.currentTime - start) > .05) throw new Error('A memory video could not seek to its saved trim. No movie was created.'); }
      else if (video.readyState < 2) await wait('loadeddata');
    }
    exportCancelled(signal); return video;
  } catch (error) { video.pause(); video.removeAttribute('src'); video.load(); throw error; }
}

async function raster(canvas: HTMLCanvasElement, signal: AbortSignal, background = false) {
  try {
    if (canvas.width !== MEMORY_MOVIE_WIDTH || canvas.height !== MEMORY_MOVIE_HEIGHT) throw new Error('The memory canvas changed size. Reopen the movie download and retry.');
    if (background && canvas.getContext('2d')?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3] !== 255) throw new Error('A memory background did not render. No blank movie was saved.');
    const blob = await exportStep(new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('A memory could not be rendered. No movie was created.')), 'image/png')), signal, 'A memory illustration took too long to render.');
    exportCancelled(signal); return blob;
  } finally { canvas.width = 0; canvas.height = 0; }
}

/** A finite, local movie with one continuous media timeline and bounded decoded memory. */
export async function exportMemoryMovie(options: {
  pages: readonly ExportPage[]; soundtrack?: unknown; signal: AbortSignal;
  originalAudio: boolean; score: { url: string; volume: number } | null; localAudio?: LocalExportAudio | null;
  capture: (request: MemoryMovieCapture, signal: AbortSignal) => Promise<HTMLCanvasElement>;
  progress: (progress: MemoryMovieProgress) => void;
}): Promise<{ blob: Blob; extension: 'mp4' | 'webm'; duration: number; memories: number }> {
  const problem = memoryMovieLimit(options.pages, options.soundtrack); if (problem) throw new Error(problem);
  if (typeof MediaRecorder === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('Movie export needs a current desktop browser with canvas recording.');
  const mime = storyVideoMime(type => MediaRecorder.isTypeSupported(type)); if (!mime) throw new Error('This browser has no supported movie export codec.');
  const controller = new AbortController(), signal = controller.signal;
  const fail = (message: string) => { if (!signal.aborted) controller.abort(new Error(message)); };
  const cancel = () => fail('Movie export was cancelled.');
  const visibility = () => { if (document.hidden) fail('This tab was hidden. Keep it open and retry; no incomplete movie was saved.'); };
  const call = () => { if (document.documentElement.dataset.platinumCallActive === 'true') fail('Movie export stopped for a call. Retry after the call finishes.'); };
  const interrupted = () => fail('Movie export stopped for another media session. Retry when it has finished.');
  options.signal.addEventListener('abort', cancel, { once: true }); if (options.signal.aborted) cancel();
  document.addEventListener('visibilitychange', visibility); window.addEventListener('platinum:stop-media', interrupted);
  const observer = new MutationObserver(call); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-platinum-call-active'] });
  let audio: AudioContext | null = null, audioDestination: MediaStreamAudioDestinationNode | null = null, mix: WaveShaperNode | null = null;
  let scoreBuffer: AudioBuffer | null = null, localBuffer: AudioBuffer | null = null, scoreGain: GainNode | null = null;
  const stopAudio: (() => void)[] = [], ready = new Map<number, ReadyScene>(), pending = new Map<number, Promise<ReadyScene>>();
  let stream: MediaStream | null = null, recorder: MediaRecorder | null = null, frame = 0, watchdog: ReturnType<typeof setTimeout> | undefined, cleanupRecording = () => {};
  const scenes: Scene[] = [], chunks: Blob[] = []; let duration = 0, recordedSeconds = 0, bytes = 0, captures = 0;
  try {
    visibility(); call(); exportCancelled(signal);
    // Resume in the deliberate Download button gesture, before any fetch/capture.
    if (options.score || options.localAudio || options.originalAudio && memoryFilmItems(options.pages).some(item => item.kind === 'video')) {
      audio = new AudioContext(); await exportStep(audio.resume(), signal, 'The browser could not start movie audio. Click Create movie again.');
      audioDestination = audio.createMediaStreamDestination(); mix = audio.createWaveShaper();
      // A unity-gain ceiling keeps overlapping tracks in range without a
      // compressor's automatic makeup gain changing the author's saved level.
      mix.curve = Float32Array.from({ length: 2049 }, (_, index) => Math.max(-.98, Math.min(.98, index / 1024 - 1))); mix.connect(audioDestination);
    }
    if (options.localAudio && audio) localBuffer = await decodeExportAudio(audio, options.localAudio, signal);
    if (options.score && audio) {
      if (!Number.isFinite(options.score.volume) || options.score.volume < 0 || options.score.volume > 1) throw new Error('Choose a background music level between 0 and 100%.');
      const response = await exportStep(fetch(options.score.url, { signal, credentials: 'same-origin' }), signal, 'The original memory score could not load. Retry or turn off background music.');
      if (!response.ok) throw new Error('The original memory score could not load. Retry or turn off background music.');
      const score = await exportStep(response.arrayBuffer(), signal, 'The original memory score could not load.');
      if (score.byteLength > 12 * 1024 * 1024) throw new Error('The memory score is too large to export.');
      scoreBuffer = await exportStep(audio.decodeAudioData(score), signal, 'The original memory score could not be decoded.');
      if (!Number.isFinite(scoreBuffer.duration) || scoreBuffer.duration <= 0 || scoreBuffer.duration > 180) throw new Error('The original memory score is invalid.');
    }
    const items = memoryFilmItems(options.pages);
    for (let index = 0; index < items.length; index++) {
      exportCancelled(signal); const item = items[index];
      options.progress({ phase: 'preparing', message: `Preparing memory ${index + 1} of ${items.length}…`, percent: Math.round(index / items.length * 100) });
      let seconds = memoryFilmPhotoDuration(item) / 1000, recipe: StoryVideoRecipe | null = null;
      if (item.kind === 'video') {
        const video = await videoReady(item.uri!, signal);
        try {
          const window = memoryFilmVideoWindow(item.page, video.duration); seconds = window.seconds!;
          recipe = { width: MEMORY_MOVIE_WIDTH, height: MEMORY_MOVIE_HEIGHT, trimStart: window.start, trimEnd: window.end!, speed: window.speed, volume: options.originalAudio ? window.volume : 0, fit: window.fit, scale: window.scale, x: window.x, y: window.y, matrix: storyPhotoColorMatrix({ filterId: item.page.filter_id, filterAmt: window.filterAmt, adjust: window.adjust }) };
        } finally { video.pause(); video.removeAttribute('src'); video.load(); }
      }
      if (duration + seconds > MEMORY_MOVIE_MAX_SECONDS) throw new Error('This movie is longer than five minutes. Create a shorter book before exporting.');
      const windows = storyVideoLayerWindows(memoryStoryStickers(item.page.stickers), recipe || { trimStart: 0, trimEnd: seconds, speed: 1 });
      captures += 1 + windows.length; if (captures > 120) throw new Error('This book has too many timed artwork changes for a browser movie. Simplify its layers before exporting.');
      const background = await raster(await options.capture({ item, layer: 'background', clock: recipe?.trimStart || 0 }, signal), signal, true), layers: Raster[] = [];
      for (const window of windows) layers.push({ image: await raster(await options.capture({ item, layer: 'overlay', clock: window.clock }, signal), signal), start: window.start, end: window.end });
      scenes.push({ item, duration: seconds, start: duration, recipe, background, layers }); duration += seconds;
    }
    const prepare = (index: number): Promise<ReadyScene> => {
      const existing = pending.get(index); if (existing) return existing;
      const work = (async () => {
        const scene = scenes[index], bitmaps: ImageBitmap[] = [];
        let video: HTMLVideoElement | null = null, renderer: ReturnType<typeof createStoryVideoRenderer> | null = null, source: MediaElementAudioSourceNode | null = null, gain: GainNode | null = null;
        let disposed = false;
        const dispose = () => { if (disposed) return; disposed = true; bitmaps.forEach(bitmap => bitmap.close()); source?.disconnect(); gain?.disconnect(); renderer?.dispose(); if (video) { video.pause(); video.removeAttribute('src'); video.load(); } ready.delete(index); };
        try {
          const decode = async (blob: Blob) => { const bitmap = await createImageBitmap(blob); bitmaps.push(bitmap); exportCancelled(signal); return bitmap; };
          const background = await decode(scene.background), layers = [];
          for (const layer of scene.layers) layers.push({ image: await decode(layer.image), start: layer.start, end: layer.end });
          if (scene.recipe) {
            video = await videoReady(scene.item.uri!, signal, scene.recipe.trimStart);
            if (video.duration < scene.recipe.trimEnd - .05) throw new Error('A memory video changed during preparation. Reopen the book and retry.');
            video.playbackRate = scene.recipe.speed; video.preservesPitch = true; renderer = createStoryVideoRenderer(video, scene.recipe); renderer.draw();
            if (audio && mix && scene.recipe.volume > 0) { source = audio.createMediaElementSource(video); gain = audio.createGain(); gain.gain.value = 0; source.connect(gain); gain.connect(mix); video.muted = false; video.volume = 1; }
          }
          exportCancelled(signal);
          const result = { scene, background, layers, video, renderer, source, gain, dispose }; ready.set(index, result); return result;
        } catch (error) { dispose(); throw error; }
      })();
      // A future page failure aborts the entire movie; never skip that memory.
      work.catch(error => { if (!signal.aborted) controller.abort(error); }); pending.set(index, work); return work;
    };
    await prepare(0); if (scenes.length > 1) await prepare(1);
    const canvas = document.createElement('canvas'); canvas.width = MEMORY_MOVIE_WIDTH; canvas.height = MEMORY_MOVIE_HEIGHT;
    const context = canvas.getContext('2d'); if (!context || !canvas.captureStream) throw new Error('This browser cannot record a memory movie.');
    const draw = (item: ReadyScene, time: number) => {
      context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(item.background, 0, 0);
      if (item.renderer) { item.renderer.draw(); context.drawImage(item.renderer.canvas, 0, 0); }
      for (const layer of item.layers) if (time >= layer.start && time < layer.end) context.drawImage(layer.image, 0, 0);
    };
    draw(ready.get(0)!, 0); stream = canvas.captureStream(30);
    audioDestination?.stream.getAudioTracks().forEach(track => stream!.addTrack(track));
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 160_000 });
    await new Promise<void>((resolve, reject) => {
      let ended = false, activeIndex = -1, started = 0, previous = 0;
      const stop = (error?: Error) => {
        if (error) reject(error);
        if (ended) return; ended = true; recordedSeconds = (performance.now() - started) / 1000;
        cancelAnimationFrame(frame); ready.forEach(item => item.video?.pause()); stopAudio.forEach(stop => stop());
        if (recorder?.state !== 'inactive') recorder?.stop();
      };
      recorder!.ondataavailable = event => { if (event.data.size) { bytes += event.data.size; if (bytes > 160 * 1024 * 1024) { stop(new Error('The movie exceeded the browser download size limit. Create a shorter book and retry.')); return; } chunks.push(event.data); } };
      recorder!.onerror = () => stop(new Error('The browser could not finish recording this movie. No incomplete file was saved.'));
      recorder!.onstop = () => resolve();
      const aborted = () => stop(signal.reason instanceof Error ? signal.reason : new Error('Movie export was cancelled.'));
      signal.addEventListener('abort', aborted, { once: true }); cleanupRecording = () => signal.removeEventListener('abort', aborted);
      const activate = (index: number) => {
        if (index === activeIndex) return;
        const next = ready.get(index); if (!next) throw new Error('The next memory is not ready. No partial movie was saved; retry on a faster connection.');
        if (activeIndex >= 0) ready.get(activeIndex)?.dispose(); activeIndex = index;
        if (next.gain && next.scene.recipe) next.gain.gain.value = next.scene.recipe.volume;
        if (scoreGain && options.score) scoreGain.gain.value = options.score.volume * (next.scene.recipe && next.scene.recipe.volume > 0 ? MEMORY_SCORE_DUCK : 1);
        if (next.video) void next.video.play().catch(() => stop(new Error('A memory video could not start. Click Create movie again.')));
        if (index + 1 < scenes.length) void prepare(index + 1);
      };
      const tick = () => {
        try {
          exportCancelled(signal); const now = performance.now(), elapsed = (now - started) / 1000;
          if (now - previous > 1000) throw new Error('The browser paused movie rendering. Keep this tab active and retry.'); previous = now;
          if (elapsed >= duration) { stop(); return; }
          let index = activeIndex; while (index + 1 < scenes.length && elapsed >= scenes[index + 1].start) index++;
          activate(Math.max(0, index)); const current = ready.get(activeIndex)!, local = elapsed - current.scene.start;
          if (current.video && current.scene.recipe) {
            if (current.video.error) throw new Error('A memory video became unavailable during export. Refresh the book and retry.');
            const expected = current.scene.recipe.trimStart + local * current.scene.recipe.speed;
            if (local > .5 && Math.abs(current.video.currentTime - expected) / current.scene.recipe.speed > .35) throw new Error('A memory video could not keep up with the movie. Retry on a faster connection.');
          }
          draw(current, local); options.progress({ phase: 'rendering', message: `Creating movie · Memory ${activeIndex + 1} of ${scenes.length}`, percent: Math.min(99, Math.floor(elapsed / duration * 100)) }); frame = requestAnimationFrame(tick);
        } catch (error) { stop(error instanceof Error ? error : new Error('Movie rendering failed.')); }
      };
      exportCancelled(signal); started = previous = performance.now(); recorder!.start(1000);
      if (scoreBuffer && audio && mix && options.score) {
        scoreGain = audio.createGain(); scoreGain.connect(mix); const source = audio.createBufferSource(); source.buffer = scoreBuffer; source.loop = true; source.connect(scoreGain); source.start();
        stopAudio.push(() => { try { source.stop(); } catch { /* Already finished. */ } source.disconnect(); scoreGain?.disconnect(); });
      }
      if (localBuffer && audio && mix && options.localAudio) stopAudio.push(playExportAudio(audio, mix, localBuffer, options.localAudio));
      activate(0); (stream!.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack)?.requestFrame?.();
      watchdog = setTimeout(() => stop(new Error('The movie took too long to finish. No incomplete movie was saved.')), (duration + 20) * 1000); frame = requestAnimationFrame(tick);
    });
    exportCancelled(signal); options.progress({ phase: 'finishing', message: 'Preparing your download…', percent: 100 });
    const blob = await finalizeRecordedWebm(new Blob(chunks, { type: recorder.mimeType || mime }), recordedSeconds, MEMORY_MOVIE_MAX_SECONDS + 30); exportCancelled(signal);
    if (blob.size < 1024) throw new Error('The movie file is empty. No file was saved.');
    return { blob, extension: blob.type.includes('mp4') ? 'mp4' : 'webm', duration, memories: scenes.length };
  } finally {
    if (!signal.aborted) controller.abort(new Error('Movie export finished.'));
    options.signal.removeEventListener('abort', cancel); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('platinum:stop-media', interrupted); observer.disconnect();
    cleanupRecording(); cancelAnimationFrame(frame); clearTimeout(watchdog); stopAudio.forEach(stop => stop());
    if (recorder && recorder.state !== 'inactive') recorder.stop(); stream?.getTracks().forEach(track => track.stop());
    ready.forEach(item => item.dispose()); mix?.disconnect(); if (audio) await audio.close().catch(() => {});
    // Pending decodes observe the abort before publishing a ready scene and dispose themselves.
    pending.clear(); scenes.length = 0;
  }
}
