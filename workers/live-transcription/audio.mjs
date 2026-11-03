import { open, stat, statfs } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { deadline, fail, LIMITS } from './protocol.mjs';

export async function downloadSource(url, filename, parent, { fetcher = fetch } = {}) {
  const signal = deadline(parent, LIMITS.downloadMs); let response, file;
  try {
    const free = await statfs(path.dirname(filename)); if (Number(free.bavail) * Number(free.bsize) < LIMITS.sourceBytes + 50000000) fail('SCRATCH_UNAVAILABLE');
    response = await fetcher(url, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal });
    if (response.status !== 200 || response.redirected) fail('SOURCE_DOWNLOAD_FAILED', true);
    if (Number(response.headers.get('content-length') || 0) > LIMITS.sourceBytes) fail('MEDIA_TOO_LARGE');
    const reader = response.body?.getReader(); if (!reader) fail('SOURCE_DOWNLOAD_FAILED', true);
    file = await open(filename, 'wx', 0o600); let size = 0;
    const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
    try {
      for (;;) {
        if (signal.aborted) fail('DEADLINE', true);
        const next = await reader.read(); if (signal.aborted) fail('DEADLINE', true); if (next.done) break;
        size += next.value.length; if (size > LIMITS.sourceBytes) fail('MEDIA_TOO_LARGE');
        let offset = 0; while (offset < next.value.length) offset += (await file.write(next.value, offset, next.value.length - offset)).bytesWritten;
      }
    } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (size < 32) fail('AUDIO_INVALID'); return size;
  } catch (error) { if (error?.code && typeof error.retryable === 'boolean') throw error; fail(signal.aborted ? 'DEADLINE' : 'SOURCE_DOWNLOAD_FAILED', true); }
  finally { await file?.close().catch(() => {}); void response?.body?.cancel().catch(() => {}); }
}
export function runTool(binary, args, { cwd, signal, maxOutput = 65536 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, LANG: 'C.UTF-8' } });
    const output = []; let size = 0, finished = false, excessive = false, killTimer;
    const kill = () => { child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 1000); killTimer.unref(); };
    const onAbort = () => kill(); signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) kill();
    const collect = (bytes, keep) => { size += bytes.length; if (size > maxOutput) { excessive = true; kill(); } else if (keep) output.push(bytes); };
    child.stdout.on('data', bytes => collect(bytes, true)); child.stderr.on('data', bytes => collect(bytes, false));
    const end = error => { if (finished) return; finished = true; clearTimeout(killTimer); signal?.removeEventListener('abort', onAbort); if (error) reject(error); else resolve(Buffer.concat(output).toString('utf8')); };
    child.once('error', () => { try { fail('ENCODE_FAILED'); } catch (error) { end(error); } });
    child.once('close', code => { try { if (signal?.aborted) fail('DEADLINE', true); if (code !== 0 || excessive) fail('ENCODE_FAILED'); end(); } catch (error) { end(error); } });
  });
}
export async function prepareAudio(source, output, durationMs, parent) {
  const signal = deadline(parent, LIMITS.encodeMs);
  await runTool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-discard:v', 'all', '-f', 'mov', '-i', source,
    '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1', '-t', String(durationMs / 1000 + 0.25), '-ac', '1', '-ar', '16000',
    '-c:a', 'flac', '-compression_level', '5', '-fs', String(LIMITS.audioBytes), output], { signal });
  const size = (await stat(output)).size; if (size < 100 || size >= LIMITS.audioBytes) fail('MEDIA_TOO_LARGE');
  let probe;
  try { probe = JSON.parse(await runTool('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration:stream=codec_name,codec_type,sample_rate,channels', '-of', 'json', output], { signal })); }
  catch (error) { if (error?.code) throw error; fail('AUDIO_INVALID'); }
  const audio = probe.streams?.[0], actual = Number(probe.format?.duration) * 1000;
  if (probe.streams?.length !== 1 || audio?.codec_type !== 'audio' || audio.codec_name !== 'flac' || audio.sample_rate !== '16000' || audio.channels !== 1
    || !Number.isFinite(actual) || Math.abs(actual - durationMs) > 750 || actual > LIMITS.durationMs + 250) fail('AUDIO_INVALID');
  const hash = createHash('sha256'); for await (const bytes of createReadStream(output)) hash.update(bytes);
  return { path: output, bytes: size, sha256: hash.digest('hex'), duration_ms: Math.round(actual) };
}
