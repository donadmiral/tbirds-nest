#!/usr/bin/env node
// Local synthetic source only. No upload, authentication, or provider calls.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const durationSeconds = 150;
const timestamp = seconds => `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000`;
export function clipSpecifications() {
  return [15, 30, 60, 90, 120].map(seconds => ({
    title: `Live acceptance ${seconds}s`, caption: 'Synthetic acceptance recording; no personal media.', tags: ['live-acceptance'],
    start_ms: 10_000, end_ms: (10 + seconds) * 1000, cover_ms: 5000,
    formats: ['horizontal', 'vertical'], watermark: true, brand_text: 'Platinum Circles', burn_captions: true,
    subtitles: [{ start_ms: 0, end_ms: 2000, text: `Acceptance clip: ${seconds} seconds` },
      { start_ms: (seconds - 2) * 1000, end_ms: seconds * 1000, text: 'End marker' }],
  }));
}
export async function prepareFixture(parent = tmpdir()) {
  const directory = await mkdtemp(join(resolve(parent), 'platinum-live-e2e-'));
  const label = join(directory, 'label.txt');
  await writeFile(label, 'PLATINUM LIVE ACCEPTANCE\nSYNTHETIC VIDEO / AUDIO MARKERS', { mode: 0o600 });
  // A small moving chart, burned-in elapsed clock and short five-second chirps
  // expose frozen video, missing audio, drift and incorrect clip boundaries.
  const videoFilter = `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:textfile=label.txt:fontcolor=white:fontsize=28:box=1:boxcolor=black@0.65:x=24:y=24,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='%{pts\\:hms}':fontcolor=white:fontsize=42:box=1:boxcolor=black@0.65:x=(w-tw)/2:y=h-90`;
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', String(durationSeconds), '-vf', videoFilter,
    '-af', "volume='if(lt(mod(t,5),0.2),0.20,0)':eval=frame", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
    '-pix_fmt', 'yuv420p', '-g', '48', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', 'source.mp4'];
  const encoded = spawnSync('ffmpeg', args, { cwd: directory, timeout: 120_000, maxBuffer: 65_536, encoding: 'utf8' });
  if (encoded.error || encoded.status !== 0) throw new Error('FIXTURE_ENCODING_FAILED');
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type,width,height,sample_rate',
    '-of', 'json', 'source.mp4'], { cwd: directory, timeout: 10_000, maxBuffer: 65_536, encoding: 'utf8' });
  if (probe.error || probe.status !== 0) throw new Error('FIXTURE_PROBE_FAILED');
  const media = JSON.parse(probe.stdout);
  if (Math.abs(Number(media.format?.duration) - durationSeconds) > 0.1
    || !media.streams.some(stream => stream.codec_type === 'video' && stream.codec_name === 'h264')
    || !media.streams.some(stream => stream.codec_type === 'audio' && stream.codec_name === 'aac')) throw new Error('FIXTURE_LAYOUT_INVALID');
  const captions = 'WEBVTT\n\n' + Array.from({ length: durationSeconds / 5 }, (_, index) =>
    `${index + 1}\n${timestamp(index * 5)} --> ${timestamp(index * 5 + 5)}\nSynthetic marker ${index * 5}s\n`).join('\n');
  await writeFile(join(directory, 'source-captions.vtt'), captions, { mode: 0o600 });
  await writeFile(join(directory, 'clip-specifications.json'), JSON.stringify(clipSpecifications(), null, 2) + '\n', { mode: 0o600 });
  const files = await Promise.all(['source.mp4', 'source-captions.vtt', 'clip-specifications.json'].map(async name => {
    const bytes = await readFile(join(directory, name));
    return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }));
  const manifest = { schema_version: 1, purpose: 'real_live_source_acceptance', created_at: new Date().toISOString(), duration_seconds: durationSeconds,
    visual_clock: true, chirp_interval_seconds: 5, generated_locally: true, uploaded: false,
    instructions: 'Play this source in a shared window or film its moving clock with the physical test camera. Start source playback when the broadcast starts. Read actual recording bounds before submitting any clip range.',
    streams: media.streams, files };
  await writeFile(join(directory, 'fixture.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  return { directory, manifest };
}
export async function main(argv = process.argv.slice(2), write = value => process.stdout.write(value)) {
  if (argv.length === 1 && argv[0] === '--help') {
    write('Usage: node prepare-live-e2e-fixture.mjs [--directory /scratch/parent]\nGenerates a 150-second local synthetic MP4, timed captions, and five clip specifications. No upload or provider calls.\n'); return 0;
  }
  try {
    if (argv.length && (argv.length !== 2 || argv[0] !== '--directory' || !argv[1])) throw new Error();
    const result = await prepareFixture(argv[1]); write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n'); return 0;
  } catch { write('{"ok":false,"error":"LIVE_FIXTURE_PREPARATION_FAILED"}\n'); return 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
