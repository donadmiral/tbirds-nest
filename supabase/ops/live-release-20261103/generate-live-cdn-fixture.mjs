#!/usr/bin/env node
// Local-only synthetic media. This script never reads credentials or calls a provider.
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function generateFixture({ bucket, region = 'us-east-2', directory }) {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket || '')
    || !/^[a-z]{2}-[a-z]+-\d$/.test(region)) throw Error('INVALID_FIXTURE_DESTINATION');
  const folder = await mkdtemp(join(directory ? resolve(directory) : tmpdir(), 'platinum-live-cdn-fixture-'));
  const session = randomUUID(), instance = randomUUID(), prefix = 'live/' + session + '/' + instance + '/';
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=c=0x14263d:s=160x90:r=24',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-crf', '32', '-g', '24', '-keyint_min', '24', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '48k', '-ac', '1', '-f', 'hls', '-hls_time', '1', '-hls_list_size', '0',
    '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments', '-hls_segment_filename', 'segment%03d.ts', 'media.m3u8'];
  const encoded = spawnSync('ffmpeg', args, { cwd: folder, encoding: 'utf8', timeout: 30_000, maxBuffer: 64_000 });
  if (encoded.error || encoded.status !== 0) throw Error('FIXTURE_ENCODING_FAILED');
  const master = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=128000,RESOLUTION=160x90,CODECS="avc1.42c00b,mp4a.40.2"\nmedia.m3u8\n';
  await writeFile(join(folder, 'master.m3u8'), master, { mode: 0o600 });
  const media = await readFile(join(folder, 'media.m3u8'), 'utf8');
  const segments = media.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (segments.length !== 3 || !segments.every(name => /^segment\d{3}\.ts$/.test(name))) throw Error('FIXTURE_LAYOUT_INVALID');
  const decoded = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', 'master.m3u8',
    '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { cwd: folder, encoding: 'utf8', timeout: 30_000, maxBuffer: 64_000 });
  if (decoded.error || decoded.status !== 0) throw Error('FIXTURE_DECODE_FAILED');
  const files = [];
  for (const name of ['master.m3u8', 'media.m3u8', ...segments]) {
    const filename = join(folder, name), bytes = await readFile(filename), playlist = name.endsWith('.m3u8');
    files.push({ relative_path: name, storage_path: prefix + name, local_path: filename, size: bytes.length,
      sha256: hash(bytes), range_0_31_sha256: hash(bytes.subarray(0, 32)),
      content_type: playlist ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      cache_control: playlist ? 'public, max-age=1' : 'public, max-age=86400, immutable' });
  }
  const fixture = { schema_version: 1, purpose: 'isolated_cdn_acceptance', created_at: new Date().toISOString(),
    duration_seconds: 3, local_decode_passed: true, session_id: session, instance_id: instance, bucket, region, prefix,
    entrypoint: prefix + 'master.m3u8', files };
  const fixtureFile = join(folder, 'fixture.json');
  await writeFile(fixtureFile, JSON.stringify(fixture, null, 2) + '\n', { mode: 0o600 });
  return { fixture_file: fixtureFile, fixture };
}

export async function main(argv = process.argv.slice(2), write = text => process.stdout.write(text)) {
  if (argv.length === 1 && argv[0] === '--help') {
    write('Usage: node generate-live-cdn-fixture.mjs --bucket <actual-bucket> [--region us-east-2] [--directory /scratch/parent]\nLocal-only: creates and decodes a three-second synthetic HLS fixture. No upload or credentials.\n');
    return 0;
  }
  try {
    const options = {};
    for (let i = 0; i < argv.length; i += 2) {
      const flag = argv[i], value = argv[i + 1];
      if (!['--bucket', '--region', '--directory'].includes(flag) || !value || value.startsWith('--') || flag in options) throw Error();
      options[flag] = value;
    }
    const result = await generateFixture({ bucket: options['--bucket'], region: options['--region'], directory: options['--directory'] });
    write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n');
    return 0;
  } catch {
    write('{"ok":false,"error":"FIXTURE_GENERATION_FAILED"}\n');
    return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
