import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { command, probe } from '../media-renditions/transcode.mjs';
const fail = code => Object.assign(new Error(code), { permanent: true });
const timestamp = ms => {
  const value = Math.round(ms), hours = Math.floor(value / 3600000), minutes = Math.floor(value / 60000) % 60, seconds = Math.floor(value / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
};
export function captionsVtt(cues, durationMs) {
  if (!Array.isArray(cues) || cues.length > 500) throw fail('captions_invalid');
  let previous = -1;
  const lines = cues.map((cue, index) => {
    if (!cue || !Number.isSafeInteger(cue.start_ms) || !Number.isSafeInteger(cue.end_ms) || cue.start_ms < 0
      || cue.start_ms < previous || cue.end_ms <= cue.start_ms || cue.end_ms > durationMs
      || typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 500) throw fail('captions_invalid');
    previous = cue.start_ms;
    const text = cue.text.trim().replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\r', '').replace(/\n{2,}/g, '\n');
    return `${index + 1}\n${timestamp(cue.start_ms)} --> ${timestamp(cue.end_ms)}\n${text}\n`;
  });
  return 'WEBVTT\n\n' + lines.join('\n');
}
export async function renderClip(source, output, spec, { signal, threads = 2, maxBytes = 536870912 } = {}) {
  const duration = source.durationSeconds;
  if (!Number.isFinite(duration) || duration < 1 || duration > 600 || !Number.isFinite(source.seekSeconds) || source.seekSeconds < 0) throw fail('clip_range_invalid');
  if (!Number.isSafeInteger(spec.cover_ms) || spec.cover_ms < 0 || spec.cover_ms >= duration * 1000) throw fail('cover_invalid');
  if (!Array.isArray(spec.formats) || !spec.formats.length || spec.formats.length > 2 || new Set(spec.formats).size !== spec.formats.length
    || spec.formats.some(f => !['vertical', 'horizontal'].includes(f))) throw fail('format_invalid');
  if (typeof spec.watermark !== 'boolean') throw fail('watermark_invalid');
  await mkdir(output, { recursive: true });
  const cues = spec.subtitles || [];
  await writeFile(path.join(output, 'captions.vtt'), captionsVtt(cues, Math.round(duration * 1000)), { mode: 0o600 });
  // The brand is text data read by drawtext, never part of a filter expression.
  const brand = typeof spec.brand_text === 'string' && spec.brand_text.trim() ? spec.brand_text.trim().slice(0, 80) : 'Platinum Circles';
  await writeFile(path.join(output, 'brand.txt'), brand.replace(/[\u0000-\u001f]/g, ' '), { mode: 0o600 });
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  let budgetError = false, busy = false;
  const watchdog = setInterval(async () => {
    if (busy) return; busy = true;
    try {
      const files = await readdir(output); let bytes = 0;
      for (const file of files) bytes += (await stat(path.join(output, file))).size;
      if (bytes > maxBytes) { budgetError = true; controller.abort(); }
    } catch {} finally { busy = false; }
  }, 500);
  const videos = [];
  try {
    for (const format of spec.formats) {
      const [width, height] = format === 'vertical' ? [720, 1280] : [1280, 720];
      let filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
      if (spec.burn_captions && cues.length) filter += ",subtitles=captions.vtt:force_style='FontSize=22,Outline=1,MarginV=34'";
      if (spec.watermark) filter += ',drawtext=textfile=brand.txt:expansion=none:fontcolor=white:fontsize=18:box=1:boxcolor=black@0.45:boxborderw=6:x=w-tw-18:y=h-th-18';
      const filename = `${format}.mp4`;
      await command(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-protocol_whitelist', 'file', '-format_whitelist', 'hls,mpegts,mov',
        '-allowed_extensions', 'm3u8,ts,m4s,mp4', '-threads', String(threads), '-i', source.filename,
        '-ss', String(source.seekSeconds), '-t', String(duration), '-map', '0:v:0', '-map', '0:a:0?',
        '-sn', '-dn', '-map_metadata', '-1', '-vf', filter, '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
        '-pix_fmt', 'yuv420p', '-maxrate', '2400k', '-bufsize', '4800k', '-threads', String(threads),
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', filename],
      { cwd: output, signal: controller.signal });
      const checked = await probe(path.join(output, filename), { signal: controller.signal });
      if (checked.width !== width || checked.height !== height || Math.abs(checked.duration - duration) > 0.15) throw fail('clip_output_invalid');
      videos.push({ name: filename, width, height, duration_ms: Math.round(checked.duration * 1000), format });
    }
    await command(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file',
      '-ss', String(spec.cover_ms / 1000), '-i', videos[0].name, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '3', 'thumbnail.jpg'],
    { cwd: output, signal: controller.signal });
    const names = [...videos.map(v => v.name), 'thumbnail.jpg', ...(cues.length ? ['captions.vtt'] : [])];
    let bytes = 0; const assets = [];
    for (const name of names) {
      const filename = path.join(output, name), info = await stat(filename); bytes += info.size;
      if (!info.isFile() || !info.size || bytes > maxBytes) throw fail('clip_output_budget');
      const hash = createHash('sha256'); for await (const chunk of createReadStream(filename)) hash.update(chunk);
      const video = videos.find(v => v.name === name);
      assets.push({ name, bytes: info.size, sha256: hash.digest('hex'), content_type: name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.jpg') ? 'image/jpeg' : 'text/vtt',
        ...(video ? { width: video.width, height: video.height, duration_ms: video.duration_ms, format: video.format } : {}) });
    }
    return { assets, duration_ms: Math.round(duration * 1000), width: videos[0].width, height: videos[0].height };
  } catch (error) { throw budgetError ? fail('clip_output_budget') : error; }
  finally { clearInterval(watchdog); signal?.removeEventListener('abort', abort); }
}
