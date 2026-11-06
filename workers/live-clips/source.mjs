import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';

const fail = code => Object.assign(new Error(code), { permanent: true });
const textLimit = 2 * 1024 * 1024;
export function sourceUrl(value, root) {
  const base = new URL(root), url = new URL(value, base);
  const prefix = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
  if (url.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password || url.hash
    || !url.pathname.startsWith(prefix) || /%(?:2f|5c|00|2e)/i.test(url.pathname) || url.pathname.includes('\\')) throw fail('source_url_rejected');
  return url.href;
}
async function readText(fetcher, url, signal) {
  const response = await fetcher(url, { signal, redirect: 'error' });
  if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 404 ? 'source_not_ready' : 'source_download_failed'); }
  const reader = response.body?.getReader(); if (!reader) throw fail('empty_playlist');
  let bytes = 0; const chunks = [];
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length;
    if (bytes > textLimit) { await reader.cancel(); throw fail('playlist_budget'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString('utf8').replaceAll('\r\n', '\n');
  if (!text.startsWith('#EXTM3U\n') || text.includes('\0')) throw fail('invalid_playlist');
  return text;
}
export function selectVariant(text, url) {
  const lines = text.split('\n'), variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const bandwidth = Number(lines[i].match(/(?:^|[:,])BANDWIDTH=(\d+)/)?.[1] || 0);
    const resolution = lines[i].match(/RESOLUTION=(\d+)x(\d+)/);
    if (!lines[i + 1] || lines[i + 1].startsWith('#')) throw fail('invalid_variant');
    if (variants.length >= 12) throw fail('variant_budget');
    if (!resolution || Math.max(+resolution[1], +resolution[2]) <= 1920) variants.push({ bandwidth, url: sourceUrl(lines[i + 1], url) });
  }
  if (!variants.length) return null;
  return variants.sort((a, b) => b.bandwidth - a.bandwidth)[0].url;
}
export function selectSegments(text, startMs, endMs) {
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs - startMs < 1000 || endMs - startMs > 600000) throw fail('clip_range_invalid');
  // A retained recording starts at zero. A rolling live window lacks the
  // absolute timeline needed for accurate clipping and is never guessed.
  if (Number(text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1] || 0) !== 0) throw fail('recording_timeline_unavailable');
  if (/#EXT-X-(?:KEY|SESSION-KEY|BYTERANGE|MEDIA):/.test(text)) throw fail('unsupported_playlist');
  const segments = []; let position = 0, duration, init = null, discontinuity = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#EXT-X-MAP:')) { const match = line.match(/^#EXT-X-MAP:URI="([^"\r\n]+)"$/); if (!match) throw fail('unsupported_init'); init = match[1]; }
    else if (line === '#EXT-X-DISCONTINUITY') discontinuity = true;
    else if (line.startsWith('#EXTINF:')) {
      duration = Number(line.slice(8).split(',')[0]);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 30) throw fail('segment_duration_invalid');
    } else if (line && !line.startsWith('#')) {
      if (duration === undefined) throw fail('segment_duration_missing');
      const finish = position + duration * 1000;
      if (finish > startMs && position < endMs) segments.push({ uri: line, duration, startMs: position, init, discontinuity });
      position = finish; duration = undefined; discontinuity = false;
      if (segments.length > 600) throw fail('segment_budget');
    }
  }
  if (position + 50 < endMs) throw new Error('source_not_ready');
  if (!segments.length) throw fail('empty_clip');
  return { segments, seekSeconds: (startMs - segments[0].startMs) / 1000, durationSeconds: (endMs - startMs) / 1000 };
}
async function download(fetcher, url, filename, signal, reserve) {
  const response = await fetcher(url, { signal, redirect: 'error' });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('segment_download_failed'); }
  const output = createWriteStream(filename, { flags: 'wx', mode: 0o600 });
  let error; output.on('error', e => { error = e; });
  let size = 0;
  try {
    for await (const chunk of response.body) {
      if (signal?.aborted) throw new Error('worker_deadline');
      size += chunk.length; reserve(chunk.length);
      if (size > 16 * 1024 * 1024) throw fail('segment_budget');
      if (!output.write(chunk)) await once(output, 'drain');
      if (error) throw error;
    }
    if (!size) throw fail('empty_segment');
    output.end(); await once(output, 'close');
  } catch (e) { output.destroy(); throw e; }
}
export async function materializeSource({ url, startMs, endMs }, directory, { fetcher = fetch, signal, maxBytes = 536870912 } = {}) {
  // Caller obtains this URL from a service-side authorized source capability.
  const trusted = new URL(url); sourceUrl(url, url);
  const master = await readText(fetcher, trusted.href, signal);
  const variant = selectVariant(master, trusted.href);
  const mediaUrl = variant || trusted.href;
  const media = variant ? await readText(fetcher, mediaUrl, signal) : master;
  const chosen = selectSegments(media, startMs, endMs);
  await mkdir(directory, { recursive: true });
  let bytes = 0, index = 0, previousInit = null;
  const reserve = count => { bytes += count; if (bytes > maxBytes) throw fail('source_budget'); };
  let playlist = '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:30\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n';
  const inits = new Map();
  for (const segment of chosen.segments) {
    if (segment.init) {
      // Resolve relative variant paths without allowing escape from session root.
      const resolved = sourceUrl(new URL(segment.init, mediaUrl).href, trusted.href);
      if (!inits.has(resolved)) { const name = `init-${inits.size}.mp4`; await download(fetcher, resolved, path.join(directory, name), signal, reserve); inits.set(resolved, name); }
      if (previousInit !== resolved) { playlist += `#EXT-X-MAP:URI="${inits.get(resolved)}"\n`; previousInit = resolved; }
    }
    if (segment.discontinuity && index) playlist += '#EXT-X-DISCONTINUITY\n';
    const resolved = sourceUrl(new URL(segment.uri, mediaUrl).href, trusted.href);
    const name = `segment-${String(index++).padStart(4, '0')}.${segment.init ? 'm4s' : 'ts'}`;
    await download(fetcher, resolved, path.join(directory, name), signal, reserve);
    playlist += `#EXTINF:${segment.duration},\n${name}\n`;
  }
  const filename = path.join(directory, 'source.m3u8');
  await writeFile(filename, playlist + '#EXT-X-ENDLIST\n', { mode: 0o600 });
  return { filename, seekSeconds: chosen.seekSeconds, durationSeconds: chosen.durationSeconds, bytes };
}
