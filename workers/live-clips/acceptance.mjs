// Offline encoder acceptance for the actual image. No broker, cloud or provider call.
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { command, probe } from '../media-renditions/transcode.mjs';
import { createClipWorker } from './worker.mjs';
import { checkRuntimeFiles } from './encoder-policy.mjs';
import { withSyntheticEncoderDiagnostics } from './test/synthetic-diagnostics.mjs';

export async function runLocalAcceptance({ tempRoot = os.tmpdir() } = {}) {
  const directory = await mkdtemp(path.join(tempRoot, 'pc-renderer-acceptance-')), started = Date.now();
  const abort = AbortSignal.timeout(90000), verified = [];
  try { return await withSyntheticEncoderDiagnostics(directory, async stage => {
    stage('acceptance_fixture_generation');
    await command(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'color=c=0x15263e:s=320x180:r=30',
      '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '3',
      '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p',
      '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '64k', '-ac', '1',
      '-f', 'hls', '-hls_time', '1', '-hls_list_size', '0', '-hls_playlist_type', 'vod',
      '-hls_segment_filename', 'segment%03d.ts', 'media.m3u8'], { cwd: directory, signal: abort });
    const files = new Map();
    for (const name of await readdir(directory)) files.set(name, await readFile(path.join(directory, name)));
    files.set('master.m3u8', Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=250000,RESOLUTION=320x180\nmedia.m3u8\n'));
    const job = { id: randomUUID(), lease_id: randomUUID(), clip_id: randomUUID(), session_id: randomUUID(), owner_id: randomUUID(),
      start_ms: 500, end_ms: 2500, cover_ms: 1000, formats: ['horizontal', 'vertical'], watermark: true,
      brand_text: 'Platinum Circles acceptance', burn_captions: true,
      subtitles: [{ start_ms: 0, end_ms: 1500, text: 'Private renderer acceptance' }] };
    job.source_path = 'live/' + job.session_id + '/' + randomUUID() + '/master.m3u8';
    job.output_prefix = job.owner_id + '/' + job.session_id + '/' + job.clip_id + '/' + job.lease_id + '/';
    const base = 'https://fixture.invalid/_live/offline/' + job.source_path;
    const expectedPrefix = new URL('.', base).href;
    let claimed = false, completed = false;
    const worker = createClipWorker({
      claim: async () => { if (claimed) return null; claimed = true; return job; },
      source: async () => base,
      check: async value => value.id === job.id && value.lease_id === job.lease_id,
      upload: async (_, asset, file, signal) => {
        stage(asset.name.endsWith('.mp4') ? 'acceptance_validate_video' : 'acceptance_validate_auxiliary');
        const bytes = await readFile(file);
        if (asset.bytes !== bytes.length || asset.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw Error('acceptance_hash_mismatch');
        if (asset.name.endsWith('.mp4')) {
          const media = await probe(file, { signal });
          if (!media.audio || Math.abs(media.duration - 2) > 0.15) throw Error('acceptance_video_mismatch');
          const dimensions = asset.name === 'horizontal.mp4' ? [1280, 720] : [720, 1280];
          if (media.width !== dimensions[0] || media.height !== dimensions[1]) throw Error('acceptance_video_mismatch');
          await command(process.env.FFMPEG_PATH || 'ffmpeg',
            ['-v', 'error', '-nostdin', '-i', file, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { signal });
        } else if (asset.name === 'captions.vtt' && !bytes.toString().startsWith('WEBVTT\n')) throw Error('acceptance_caption_mismatch');
        verified.push({ name: asset.name, bytes: asset.bytes, sha256: asset.sha256 });
      },
      complete: async (_, manifest) => {
        completed = verified.length === 4 && manifest.assets.length === 4 && manifest.duration_ms === 2000;
        return completed;
      },
      fail: async () => ({ ok: true, state: 'failed' }),
    }, { tempRoot: directory, deadlineMs: 80000, fetcher: async (value, options = {}) => {
      if (options.signal?.aborted) throw Error('acceptance_aborted');
      const url = new URL(value);
      if (!url.href.startsWith(expectedPrefix)) throw Error('acceptance_external_request_forbidden');
      const name = url.href.slice(expectedPrefix.length), bytes = files.get(name);
      if (!bytes) throw Error('acceptance_unknown_asset');
      return new Response(bytes);
    } });
    stage('acceptance_render_clip');
    const result = await worker.drain(abort);
    if (result.state !== 'ready' || !completed || worker.active) throw Error('acceptance_render_failed');
    if ((await readdir(directory)).some(name => name.startsWith('pc-live-clip-'))) throw Error('acceptance_cleanup_failed');
    return { schema_version: 1, ok: true, scope: 'offline_actual_encoder', broker_mocked: true,
      hosted_publication_verified: false, provider_broadcast_verified: false, measured_capacity_verified: false,
      duration_ms: 2000, formats: ['horizontal', 'vertical'], decoded_video_and_audio: true,
      watermark_and_reviewed_captions_rendered: true, scratch_cleanup_verified: true,
      assets: verified, elapsed_ms: Date.now() - started };
  });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const permissions = checkRuntimeFiles();
    process.stdout.write(JSON.stringify({ ...await runLocalAcceptance(), ...permissions }) + '\n');
  }
  catch { process.stderr.write('{"ok":false,"error":"offline_renderer_acceptance_failed"}\n'); process.exitCode = 1; }
}
