import {memoryMovieLimit} from '../../shared/memoryMovieSupport';
import { readSoundtrack, type SoundtrackSelection } from '../../shared/soundtrack';
import { libraryExportAudio, assertLibraryExportRights } from './libraryExportAudio';
import { MEMORY_SCORE_DUCK, memoryFilmItems, memoryPageSoundtrack, memoryFilmVideoWindow, type MemoryFilmPage } from '../../shared/memoryFilm';
import {planMemoryMovie,memoryMovieTimeline,memoryMovieVisual,type MemoryMovieTimelineItem} from '../../shared/memoryMoviePlan';
import { memoryStoryStickers } from '../../shared/memoryStoryPresentation';
import { storyPhotoColorMatrix } from '../../shared/storyColorMatrix';
import { storyVideoLayerWindows, storyVideoMime, type StoryVideoRecipe } from '../../shared/storyVideoComposition';
import { createStoryVideoRenderer } from './storyVideoExport';
import { finalizeRecordedWebm } from './recordedWebm';
import { decodeExportAudio, exportCancelled, exportStep, playExportAudio, type LocalExportAudio } from './videoExportAudio';

export const MEMORY_MOVIE_WIDTH = 720, MEMORY_MOVIE_HEIGHT = 1280;
export const MEMORY_MOVIE_MAX_PAGES = 80, MEMORY_MOVIE_MAX_SECONDS = 300;
type ExportPage = MemoryFilmPage & { dual_front_url?: string | null; audio_url?: string | null; audio_title?: string | null };
export type MemoryMovieProgress = { phase: 'preparing' | 'rendering' | 'finishing'; message: string; percent: number };
export type MemoryMovieCapture = { item: MemoryMovieTimelineItem; layer: 'background' | 'overlay'; clock: number };
type Raster = { image: Blob; start: number; end: number };
type Scene = { item: MemoryMovieTimelineItem; pageSound: SoundtrackSelection | null; duration: number; start: number; recipe: StoryVideoRecipe | null; background: Blob; layers: Raster[] };
type ReadyScene = { scene: Scene; pageAudio: {buffer:AudioBuffer;selection:LocalExportAudio}|null; video: HTMLVideoElement | null; renderer: ReturnType<typeof createStoryVideoRenderer> | null; background: ImageBitmap; layers: { image: ImageBitmap; start: number; end: number }[]; gain: GainNode | null; source: MediaElementAudioSourceNode | null; dispose: () => void };

export {memoryMovieLimit} from '../../shared/memoryMovieSupport';

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
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight || video.videoWidth>4096 || video.videoHeight>4096 || video.videoWidth*video.videoHeight>9_000_000) throw new Error('A memory video has no finite duration or readable dimensions.');
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
  pages: readonly ExportPage[]; title?:string; filmSettings?:unknown; reduceMotion?:boolean; soundtrack?: unknown; signal: AbortSignal;
  originalAudio: boolean; score: { url: string; volume: number } | null; localAudio?: LocalExportAudio | null;
  capture: (request: MemoryMovieCapture, signal: AbortSignal) => Promise<HTMLCanvasElement>;
  progress: (progress: MemoryMovieProgress) => void;
}): Promise<{ blob: Blob; extension: 'mp4' | 'webm'; duration: number; memories: number }> {
  const problem = memoryMovieLimit(options.pages, options.soundtrack,options.filmSettings); if (problem) throw new Error(problem);
  const selectedPages=planMemoryMovie(options.pages,options.filmSettings).scenes.map(scene=>options.pages[scene.sourceIndex]);
  const savedMusic=readSoundtrack(options.soundtrack),pageSounds=selectedPages.map(memoryPageSoundtrack).filter((value):value is SoundtrackSelection=>!!value);
  if(savedMusic&&options.localAudio)throw new Error('Remove the extra export audio to use your saved book soundtrack, or remove the book soundtrack first.');
  if(savedMusic)options={...options,score:null};
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
  let continuousAudio: ReturnType<typeof playExportAudio> | null=null;const pageAudioHandle:{stop:(()=>void)|null}={stop:null};
  let scoreBuffer: AudioBuffer | null = null, localBuffer: AudioBuffer | null = null, scoreGain: GainNode | null = null;
  const stopAudio: (() => void)[] = [], ready = new Map<number, ReadyScene>(), pending = new Map<number, Promise<ReadyScene>>();
  let stream: MediaStream | null = null, recorder: MediaRecorder | null = null, frame = 0, watchdog: ReturnType<typeof setTimeout> | undefined, cleanupRecording = () => {};
  const scenes: Scene[] = [], chunks: Blob[] = []; let duration = 0, recordedSeconds = 0, bytes = 0, captures = 0, rasterBytes=0;let selectedCount=0;
  try {
    visibility(); call(); exportCancelled(signal);
    // Resume in the deliberate Download button gesture, before any fetch/capture.
    if (savedMusic || options.score || options.localAudio || pageSounds.length || options.originalAudio && memoryFilmItems(options.pages).some(item => item.kind === 'video')) {
      audio = new AudioContext(); await exportStep(audio.resume(), signal, 'The browser could not start movie audio. Click Create movie again.');
      audioDestination = audio.createMediaStreamDestination(); mix = audio.createWaveShaper();
      // A unity-gain ceiling keeps overlapping tracks in range without a
      // compressor's automatic makeup gain changing the author's saved level.
      mix.curve = Float32Array.from({ length: 2049 }, (_, index) => Math.max(-.98, Math.min(.98, index / 1024 - 1))); mix.connect(audioDestination);
    }
    if(savedMusic)options={...options,localAudio:await libraryExportAudio(savedMusic,'memory_album',signal)};
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
    const initialPlan=planMemoryMovie(options.pages,options.filmSettings),sourceItems=memoryFilmItems(options.pages),durations:Record<string,number>={};
    for(const scene of initialPlan.scenes){if(scene.kind!=='video')continue;exportCancelled(signal);const source=sourceItems[scene.sourceIndex];
      options.progress({phase:'preparing',message:'Reading the movie’s video timing…',percent:0});
      const video=await videoReady(source.uri!,signal);try{durations[source.id]=video.duration;}finally{video.pause();video.removeAttribute('src');video.load();}
    }
    const plan=planMemoryMovie(options.pages,options.filmSettings,durations);if(plan.estimated)throw new Error('A movie video duration could not be verified.');
    const items=memoryMovieTimeline(options.pages,plan,options.title||'Memories');selectedCount=plan.selectedCount;
    for (let index = 0; index < items.length; index++) {
      exportCancelled(signal); const item = items[index];
      options.progress({ phase: 'preparing', message: `Preparing scene ${index + 1} of ${items.length}…`, percent: Math.round(index / items.length * 100) });
      const seconds=item.movie.durationSec;let recipe: StoryVideoRecipe | null = null;
      if (item.kind === 'video') {
        const window=memoryFilmVideoWindow(item.page,durations[item.id]);
        if(window.end==null||window.seconds==null||Math.abs(window.seconds-seconds)>.05)throw new Error('A memory’s video timing changed while preparing the movie.');
        recipe = { width: MEMORY_MOVIE_WIDTH, height: MEMORY_MOVIE_HEIGHT, trimStart: window.start, trimEnd: window.end, speed: window.speed, volume: options.originalAudio ? window.volume : 0, fit: window.fit, scale: window.scale, x: window.x, y: window.y, matrix: storyPhotoColorMatrix({ filterId: item.page.filter_id, filterAmt: window.filterAmt, adjust: window.adjust }) };
      }
      if (duration + seconds > MEMORY_MOVIE_MAX_SECONDS+.001) throw new Error('This movie is longer than five minutes. Create a shorter book before exporting.');
      const windows = storyVideoLayerWindows(memoryStoryStickers(item.page.stickers), recipe || { trimStart: 0, trimEnd: seconds, speed: 1 });
      captures += 1 + windows.length; if (captures > 322) throw new Error('This book has too many timed artwork changes for a browser movie. Simplify its layers before exporting.');
      const background = await raster(await options.capture({ item, layer: 'background', clock: recipe?.trimStart || 0 }, signal), signal, true), layers: Raster[] = [];
      rasterBytes+=background.size;
      for (const window of windows) {const image=await raster(await options.capture({ item, layer: 'overlay', clock: window.clock }, signal), signal);rasterBytes+=image.size;layers.push({image,start:window.start,end:window.end});}
      if(rasterBytes>192*1024*1024)throw new Error('The movie’s artwork exceeds the browser memory limit. Choose a shorter cut.');
      scenes.push({ item, pageSound:memoryPageSoundtrack(item.page), duration: seconds, start: duration, recipe, background, layers }); duration += seconds;
    }
    const prepare = (index: number): Promise<ReadyScene> => {
      const existing = pending.get(index); if (existing) return existing;
      const work = (async () => {
        const scene = scenes[index], bitmaps: ImageBitmap[] = [];
        let video: HTMLVideoElement | null = null, renderer: ReturnType<typeof createStoryVideoRenderer> | null = null, source: MediaElementAudioSourceNode | null = null, gain: GainNode | null = null;
        let disposed = false;
        const dispose = () => { if (disposed) return; disposed = true; bitmaps.forEach(bitmap => bitmap.close()); source?.disconnect(); gain?.disconnect(); renderer?.dispose(); if (video) { video.pause(); video.removeAttribute('src'); video.load(); } ready.delete(index);pending.delete(index); };
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
          let pageAudio:{buffer:AudioBuffer;selection:LocalExportAudio}|null=null;
          if(scene.pageSound&&audio){const selection=await libraryExportAudio(scene.pageSound,'memory_album',signal);pageAudio={selection,buffer:await decodeExportAudio(audio,selection,signal)};}
          exportCancelled(signal);
          const result = { scene, pageAudio, background, layers, video, renderer, source, gain, dispose }; ready.set(index, result); return result;
        } catch (error) { dispose(); throw error; }
      })();
      // A future page failure aborts the entire movie; never skip that memory.
      work.catch(error => { if (!signal.aborted) controller.abort(error); }); pending.set(index, work); return work;
    };
    await prepare(0); if (scenes.length > 1) await prepare(1);
    const canvas = document.createElement('canvas'); canvas.width = MEMORY_MOVIE_WIDTH; canvas.height = MEMORY_MOVIE_HEIGHT;
    const context = canvas.getContext('2d'); if (!context || !canvas.captureStream) throw new Error('This browser cannot record a memory movie.');
    const draw = (item: ReadyScene, time: number) => {
      const visual=memoryMovieVisual(item.scene.item,time/item.scene.duration,options.reduceMotion);
      context.save();context.fillStyle='#000000';context.fillRect(0,0,canvas.width,canvas.height);context.globalAlpha=visual.opacity;
      context.translate(canvas.width/2+visual.x*canvas.width,canvas.height/2+visual.y*canvas.height);context.scale(visual.scale,visual.scale);context.translate(-canvas.width/2,-canvas.height/2);context.drawImage(item.background, 0, 0);
      if (item.renderer) { item.renderer.draw(); context.drawImage(item.renderer.canvas, 0, 0); }
      for (const layer of item.layers) if (time >= layer.start && time < layer.end) context.drawImage(layer.image, 0, 0);
      context.restore();
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
        if (activeIndex >= 0) ready.get(activeIndex)?.dispose(); pageAudioHandle.stop?.();pageAudioHandle.stop=null;activeIndex = index;
        if (next.gain && next.scene.recipe) next.gain.gain.value = next.scene.recipe.volume;
        const duck=next.scene.recipe&&next.scene.recipe.volume>0||next.pageAudio?MEMORY_SCORE_DUCK:1;
        if (scoreGain && options.score) scoreGain.gain.value = options.score.volume * duck;
        if(savedMusic)continuousAudio?.setVolume(savedMusic.volume*duck);
        if(next.pageAudio&&audio&&mix)pageAudioHandle.stop=playExportAudio(audio,mix,next.pageAudio.buffer,next.pageAudio.selection);
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
      if (localBuffer && audio && mix && options.localAudio) {continuousAudio=playExportAudio(audio,mix,localBuffer,options.localAudio);stopAudio.push(continuousAudio);}
      activate(0); (stream!.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack)?.requestFrame?.();
      watchdog = setTimeout(() => stop(new Error('The movie took too long to finish. No incomplete movie was saved.')), (duration + 20) * 1000); frame = requestAnimationFrame(tick);
    });
    exportCancelled(signal); options.progress({ phase: 'finishing', message: 'Preparing your download…', percent: 100 });
    const blob = await finalizeRecordedWebm(new Blob(chunks, { type: recorder.mimeType || mime }), recordedSeconds, MEMORY_MOVIE_MAX_SECONDS + 30); exportCancelled(signal);
    if (blob.size < 1024) throw new Error('The movie file is empty. No file was saved.');
    if(savedMusic)await assertLibraryExportRights(savedMusic,'memory_album',signal);
    for(const selection of new Map(pageSounds.map(sound=>[sound.soundId,sound])).values())await assertLibraryExportRights(selection,'memory_album',signal);
    return { blob, extension: blob.type.includes('mp4') ? 'mp4' : 'webm', duration, memories: selectedCount };
  } finally {
    if (!signal.aborted) controller.abort(new Error('Movie export finished.'));
    options.signal.removeEventListener('abort', cancel); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('platinum:stop-media', interrupted); observer.disconnect();
    cleanupRecording(); cancelAnimationFrame(frame); clearTimeout(watchdog);pageAudioHandle.stop?.(); stopAudio.forEach(stop => stop());
    if (recorder && recorder.state !== 'inactive') recorder.stop(); stream?.getTracks().forEach(track => track.stop());
    ready.forEach(item => item.dispose()); mix?.disconnect(); if (audio) await audio.close().catch(() => {});
    // Pending decodes observe the abort before publishing a ready scene and dispose themselves.
    pending.clear(); scenes.length = 0;
  }
}
