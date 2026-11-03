import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { digest } from './protocol.mjs';
export const text = 'Platinum Circles live caption acceptance. This is synthetic speech. The first marker is blue. The second marker is silver. End of the verification.';
export async function createSpeechFixture(parent = tmpdir()) {
  const folder = await mkdtemp(path.join(path.resolve(parent), 'pc-caption-canary-'));
  await writeFile(path.join(folder, 'reference.txt'), text + '\n', { mode: 0o600 });
  const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', 'flite=textfile=reference.txt:voice=slt',
    '-map_metadata', '-1', '-ac', '1', '-ar', '16000', '-c:a', 'flac', 'source.flac'], { cwd: folder, timeout: 20000, maxBuffer: 65536 });
  if (generated.status !== 0 || generated.error) throw Error('SYNTHETIC_SPEECH_GENERATION_FAILED');
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type,sample_rate,channels', '-of', 'json', 'source.flac'],
    { cwd: folder, timeout: 5000, maxBuffer: 65536, encoding: 'utf8' });
  if (probe.status !== 0 || probe.error) throw Error('SYNTHETIC_SPEECH_PROBE_FAILED');
  const media = JSON.parse(probe.stdout), duration = Number(media.format?.duration), audio = media.streams?.[0];
  if (!(duration >= 3 && duration <= 45) || audio?.codec_name !== 'flac' || audio?.sample_rate !== '16000' || audio?.channels !== 1 || media.streams.length !== 1) throw Error('SYNTHETIC_SPEECH_LAYOUT_INVALID');
  const bytes = await readFile(path.join(folder, 'source.flac')), id = randomUUID();
  const manifest = { version: 1, generated_at: new Date().toISOString(), synthetic_only: true, generated_locally_with: 'ffmpeg flite',
    uploaded: false, provider_called: false, job_id: id, job_name: 'pc-live-caption-' + id.replaceAll('-', ''), language: 'en-US',
    reference_text: text, duration_seconds: duration, bytes: bytes.length, sha256: digest(bytes), sample_rate: 16000, channels: 1 };
  await writeFile(path.join(folder, 'fixture.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  return { folder, manifest };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2); if (args.length && (args.length !== 2 || args[0] !== '--directory')) throw Error();
    process.stdout.write(JSON.stringify(await createSpeechFixture(args[1]), null, 2) + '\n');
  } catch { process.stderr.write('{"error":"SYNTHETIC_SPEECH_GENERATION_FAILED"}\n'); process.exitCode = 1; }
}
