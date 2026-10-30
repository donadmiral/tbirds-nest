import { storyVideoMime, type StoryVideoRecipe } from '../../shared/storyVideoComposition';
import { finalizeRecordedWebm } from './recordedWebm';

const abortError = () => new Error('Video export was cancelled.');
function check(signal: AbortSignal) { if (signal.aborted) throw abortError(); }
async function bounded<T>(work: Promise<T>, signal: AbortSignal, milliseconds = 20000): Promise<T> {
  check(signal); let timer: ReturnType<typeof setTimeout>; let cancel: () => void;
  return Promise.race([work, new Promise<never>((_, reject) => { cancel = () => reject(abortError()); signal.addEventListener('abort', cancel, { once: true }); timer = setTimeout(() => reject(new Error('A video export step took too long. Retry with a shorter clip.')), milliseconds); })]).finally(() => { clearTimeout(timer); signal.removeEventListener('abort', cancel); });
}
const dataURL = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('A story image could not be read.')); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob); });
async function loadedImage(source: string, signal: AbortSignal) {
  const image = new Image();
  try { await bounded(new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('This browser could not render the story artwork.')); image.src = source; }), signal); }
  finally { image.onload = null; image.onerror = null; }
  check(signal); return image;
}

/** Rasterizes the actual static artwork, including its loaded images and font faces. */
export async function captureStoryArtwork(element: HTMLElement, width: number, height: number, signal: AbortSignal): Promise<HTMLCanvasElement> {
  check(signal);
  await bounded(document.fonts.ready, signal);
  const clone = element.cloneNode(true) as HTMLElement;
  const sources: Element[] = [element, ...element.querySelectorAll('*')], targets: Element[] = [clone, ...clone.querySelectorAll('*')];
  const assets = new Map<string, Promise<string>>();
  const inline = (url: string) => {
    const absolute = new URL(url, location.href).href;
    if (absolute.startsWith('data:')) return Promise.resolve(absolute);
    let pending = assets.get(absolute);
    if (!pending) { pending = bounded(fetch(absolute, { signal, credentials: 'same-origin' }).then(response => { if (!response.ok) throw new Error('A story image could not be downloaded for export.'); return response.blob(); }).then(dataURL), signal); assets.set(absolute, pending); }
    return pending;
  };
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i], target = targets[i];
    if (source instanceof HTMLVideoElement) throw new Error('Embedded video layers cannot be exported yet.');
    const style = getComputedStyle(source);
    if (target instanceof HTMLElement || target instanceof SVGElement) {
      for (let index = 0; index < style.length; index++) { const key = style[index]; const value = style.getPropertyValue(key).replace(/url\(["']?[^"')]*#([^"')]+)["']?\)/g, 'url(#$1)'); target.style.setProperty(key, value, style.getPropertyPriority(key)); }
      target.style.animation = 'none'; target.style.transition = 'none'; target.style.caretColor = 'transparent';
      // Background images need the same CORS checks as ordinary image stickers.
      const background = style.backgroundImage;
      const urls = [...background.matchAll(/url\(["']?([^"')]+)["']?\)/g)];
      let embedded = background;
      for (const match of urls) embedded = embedded.replace(match[0], `url("${await inline(match[1])}")`);
      target.style.backgroundImage = embedded;
    }
    if (source instanceof HTMLImageElement && target instanceof HTMLImageElement) { target.src = await inline(source.currentSrc || source.src); target.removeAttribute('srcset'); target.removeAttribute('loading'); }
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  clone.style.position = 'relative'; clone.style.left = '0'; clone.style.top = '0'; clone.style.margin = '0'; clone.style.transform = 'none'; clone.style.opacity = '1';
  const rect = element.getBoundingClientRect();
  clone.style.width = rect.width + 'px'; clone.style.height = rect.height + 'px';
  let fonts = '';
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) if (rule instanceof CSSFontFaceRule) {
      let css = rule.cssText;
      for (const match of [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)]) {
        const url = new URL(match[1], sheet.href || location.href).href;
        css = css.replace(match[0], `url("${await inline(url)}")`);
      }
      fonts += css;
    }
  }
  const style = document.createElement('style'); style.textContent = fonts; clone.prepend(style);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${rect.width} ${rect.height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(clone)}</foreignObject></svg>`;
  const image = await loadedImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), signal);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas export is unavailable in this browser.');
  context.drawImage(image, 0, 0, width, height);
  try { context.getImageData(0, 0, 1, 1); } catch { throw new Error('This browser cannot export the story artwork securely. Try a current desktop browser or the iPhone app.'); }
  return canvas;
}

function gradeRenderer(video: HTMLVideoElement, recipe: StoryVideoRecipe) {
  const canvas = document.createElement('canvas'); canvas.width = recipe.width; canvas.height = recipe.height;
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('Video color export needs WebGL in this browser.');
  const shaders: WebGLShader[] = [];
  const shader = (type: number, source: string) => { const value = gl.createShader(type); if (!value) throw new Error('The video renderer could not start.'); shaders.push(value); gl.shaderSource(value, source); gl.compileShader(value); if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error('The video grade is unsupported by this device.'); return value; };
  const program = gl.createProgram(); if (!program) throw new Error('The video renderer could not start.');
  gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 pos; attribute vec2 tex; varying vec2 uv; void main(){gl_Position=vec4(pos,0.,1.);uv=tex;}'));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'precision mediump float; varying vec2 uv; uniform sampler2D image; uniform vec4 red; uniform vec4 green; uniform vec4 blue; uniform vec4 alpha; uniform vec4 bias; void main(){vec4 p=texture2D(image,uv);gl_FragColor=clamp(vec4(dot(red,p),dot(green,p),dot(blue,p),dot(alpha,p))+bias,0.,1.);}'));
  gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('The video grade could not be linked.'); gl.useProgram(program);
  const ratio = (recipe.fit === 'cover' ? Math.max(recipe.width / video.videoWidth, recipe.height / video.videoHeight) : Math.min(recipe.width / video.videoWidth, recipe.height / video.videoHeight)) * recipe.scale;
  const w = video.videoWidth * ratio / recipe.width, h = video.videoHeight * ratio / recipe.height, x = recipe.x * 2, y = -recipe.y * 2;
  const vertices = new Float32Array([-w+x,-h+y,0,1, w+x,-h+y,1,1, -w+x,h+y,0,0, w+x,h+y,1,0]);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  for (const [name, offset] of [['pos', 0], ['tex', 8]] as const) { const location = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset); }
  ['red', 'green', 'blue', 'alpha'].forEach((name, index) => gl.uniform4fv(gl.getUniformLocation(program, name), recipe.matrix.slice(index*5,index*5+4)));
  gl.uniform4fv(gl.getUniformLocation(program, 'bias'), [recipe.matrix[4],recipe.matrix[9],recipe.matrix[14],recipe.matrix[19]]);
  const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { canvas, draw() { gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); if (gl.getError() !== gl.NO_ERROR) throw new Error('The video pixels could not be read. Check that this media is still available.'); }, dispose() { gl.deleteTexture(texture); gl.deleteBuffer(buffer); shaders.forEach(value => gl.deleteShader(value)); gl.deleteProgram(program); gl.getExtension('WEBGL_lose_context')?.loseContext(); } };
}

export async function exportStoryVideo(options: { url: string; recipe: StoryVideoRecipe; signal: AbortSignal; capture: () => Promise<{ background: CanvasImageSource; layers: { image: CanvasImageSource; start: number; end: number }[] }>; progress: (message: string) => void }): Promise<{ blob: Blob; extension: 'mp4' | 'webm'; duration: number }> {
  const { signal, recipe } = options;
  if (typeof MediaRecorder === 'undefined') throw new Error('Video export is unavailable in this browser. Use a current desktop browser or the new iPhone build.');
  const mime = storyVideoMime(type => MediaRecorder.isTypeSupported(type)); if (!mime) throw new Error('This browser has no supported video export codec.');
  check(signal);
  const video = document.createElement('video'); video.crossOrigin = 'anonymous'; video.playsInline = true; video.preload = 'auto';
  const canvas = document.createElement('canvas'); canvas.width = recipe.width; canvas.height = recipe.height;
  if (!canvas.captureStream) throw new Error('This browser cannot record the story canvas.');
  const context = canvas.getContext('2d'); if (!context) throw new Error('This browser cannot draw the story canvas.');
  let audio: AudioContext | null = null, audioSource: MediaElementAudioSourceNode | null = null, gain: GainNode | null = null;
  let renderer: ReturnType<typeof gradeRenderer> | null = null, stream: MediaStream | null = null, recorder: MediaRecorder | null = null;
  let frame = 0, watchdog: ReturnType<typeof setTimeout> | null = null, recordedSeconds = 0;
  let recordingCleanup = () => {};
  const chunks: Blob[] = []; let recordedBytes = 0;
  try {
    // Starts within the Save button's user gesture, before any asynchronous capture.
    if (recipe.volume > 0) { audio = new AudioContext(); await bounded(audio.resume(), signal); }
    const metadata = new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error('The video could not load for export. Its private media link may need refreshing.')); });
    video.src = options.url; video.load(); await bounded(metadata, signal);
    if (!Number.isFinite(video.duration) || video.duration < recipe.trimEnd - .1 || !video.videoWidth || !video.videoHeight) throw new Error('The video duration or dimensions changed. Reopen this draft before exporting.');
    video.playbackRate = recipe.speed; video.preservesPitch = true;
    if (recipe.trimStart > .001) {
      const seeked = new Promise<void>(resolve => { video.onseeked = () => resolve(); });
      video.currentTime = recipe.trimStart;
      await bounded(seeked, signal);
      // Some browsers fire seeked at zero when an origin cannot serve a byte
      // range. Never export the untrimmed beginning as if the edit succeeded.
      if (Math.abs(video.currentTime - recipe.trimStart) > .05) throw new Error('The video could not seek to the selected trim. Download it and reopen the local file before exporting.');
    }
    else if (video.readyState < 2) await bounded(new Promise<void>(resolve => { video.onloadeddata = () => resolve(); }), signal);
    options.progress('Preparing story artwork…'); const artwork = await options.capture(); check(signal);
    renderer = gradeRenderer(video, recipe);
    const draw = () => { renderer!.draw(); context.clearRect(0,0,recipe.width,recipe.height); context.drawImage(artwork.background,0,0,recipe.width,recipe.height); context.drawImage(renderer!.canvas,0,0); const time = Math.max(0,(video.currentTime-recipe.trimStart)/recipe.speed); for (const layer of artwork.layers) if (time >= layer.start && time < layer.end) context.drawImage(layer.image,0,0,recipe.width,recipe.height); };
    draw(); stream = canvas.captureStream(30);
    if (audio) { audioSource = audio.createMediaElementSource(video); gain = audio.createGain(); gain.gain.value = recipe.volume; const destination = audio.createMediaStreamDestination(); audioSource.connect(gain); gain.connect(destination); destination.stream.getAudioTracks().forEach(track => stream!.addTrack(track)); video.muted = false; video.volume = 1; }
    else video.muted = true;
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 7_000_000, audioBitsPerSecond: 128_000 });
    const outputDuration = (recipe.trimEnd-recipe.trimStart)/recipe.speed;
    const finished = new Promise<void>((resolve, reject) => {
      let ended = false;
      // start is an asynchronously delivered event. It can arrive hundreds of
      // milliseconds after recording/playback began while an encoder warms up.
      // The monotonic clock must cover those already-recorded media timestamps.
      const started = performance.now();
      const stop = (error?: Error) => {
        // The last dataavailable event follows stop(). Its size/error must still
        // reject the export instead of returning the earlier, truncated chunks.
        if (error) reject(error);
        if (ended) return;
        ended = true; recordedSeconds = (performance.now()-started)/1000;
        video.pause(); cancelAnimationFrame(frame);
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      };
      recorder!.ondataavailable = event => { if (event.data.size) { recordedBytes += event.data.size; if (recordedBytes > 160 * 1024 * 1024) { stop(new Error('The export is too large. Use a shorter clip.')); return; } chunks.push(event.data); } };
      recorder!.onerror = () => stop(new Error('The browser video recorder failed.'));
      recorder!.onstop = () => resolve();
      const abort = () => stop(abortError()), hidden = () => { if (document.hidden) stop(new Error('Keep this tab open while exporting. No file was saved.')); }, mediaError = () => stop(new Error('The source video became unavailable during export.'));
      signal.addEventListener('abort', abort, { once: true }); document.addEventListener('visibilitychange', hidden); video.addEventListener('error', mediaError);
      recordingCleanup = () => { signal.removeEventListener('abort', abort); document.removeEventListener('visibilitychange', hidden); video.removeEventListener('error', mediaError); };
      const tick = () => {
        try {
          check(signal); if (document.hidden) throw new Error('Export paused because this tab was hidden. Keep it open and retry.');
          if (video.currentTime >= recipe.trimEnd - .015 || video.ended) { stop(); return; }
          draw();
          const percent = Math.floor((video.currentTime-recipe.trimStart)/(recipe.trimEnd-recipe.trimStart)*100);
          options.progress(`Rendering edited video… ${Math.max(0,Math.min(99,percent))}%`);
          frame = requestAnimationFrame(tick);
        } catch (error) { stop(error instanceof Error ? error : new Error('Video rendering failed.')); }
      };
      watchdog = setTimeout(() => stop(new Error('The video stalled during export. Try a shorter clip.')), Math.min(180000, (outputDuration+30)*1000));
      recorder!.start(1000);
      // Request the selected first frame before the media clock advances.
      draw();
      const canvasTrack = stream!.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
      canvasTrack?.requestFrame?.();
      void video.play().then(() => { frame = requestAnimationFrame(tick); }, () => stop(new Error('Your browser blocked video playback. Click Save again to retry.')));
    });
    await finished; check(signal);
    const blob = await finalizeRecordedWebm(new Blob(chunks, { type: recorder.mimeType || mime }), recordedSeconds);
    check(signal);
    if (blob.size < 1024) throw new Error('The video export is empty. No file was saved.');
    return { blob, extension: blob.type.includes('mp4') ? 'mp4' : 'webm', duration: outputDuration };
  } finally {
    recordingCleanup();
    cancelAnimationFrame(frame); if (watchdog) clearTimeout(watchdog);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream?.getTracks().forEach(track => track.stop()); video.pause(); video.removeAttribute('src'); video.load();
    audioSource?.disconnect(); gain?.disconnect(); if (audio) await audio.close().catch(() => {}); renderer?.dispose();
  }
}
