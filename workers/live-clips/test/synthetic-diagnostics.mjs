// Offline fixture instrumentation only. Production command() stays redacted.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { mkdir, access } from 'node:fs/promises';

/** Runs only after the generated-fixture test fails; never accepts customer media. */
export async function runSyntheticIsolationMatrix(directory, emit = value => process.stderr.write(JSON.stringify(value) + '\n')) {
  const root = path.resolve(directory);
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !/^pc-live-clip-test-[A-Za-z0-9_-]+$/.test(path.basename(root))) throw Error('synthetic_matrix_scope_invalid');
  const input = path.join(root, 'source/source.m3u8'), output = path.join(root, 'out'), matrix = path.join(root, 'matrix');
  try { await access(input); await access(path.join(output, 'captions.vtt')); } catch { return; }
  await mkdir(matrix, { mode: 0o700 });
  const clean = value => String(value || '').replaceAll(root, '<synthetic>').replace(/https?:\/\/[^\s"']+/g, '<url-redacted>')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(-6000);
  const run = (stage, binary, args) => new Promise(resolve => {
    childProcess.execFile(binary, args, { cwd: output, env: { PATH: process.env.PATH, HOME: output, LANG: 'C' },
      encoding: 'utf8', timeout: 8000, killSignal: 'SIGKILL', maxBuffer: 65536 }, (error, stdout, stderr) => {
      emit({ event: 'synthetic_encoder_isolation', scope: 'offline_generated_fixture', stage,
        ok: !error, exit_code: error && Number.isInteger(error.code) ? error.code : error ? null : 0,
        signal: error?.signal || null, timed_out: error?.killed === true, stderr: error ? clean(stderr) : '' });
      resolve(!error);
    });
  });
  const global = ['-hide_banner', '-loglevel', 'verbose', '-nostdin', '-y', '-protocol_whitelist', 'file'];
  const strict = ['-format_whitelist', 'hls,mpegts,mov', '-allowed_extensions', 'm3u8,ts,m4s,mp4'];
  const read = extra => [...global, ...extra, '-threads', '2', '-i', input, '-t', '0.25', '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn'];
  const scale = 'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,setsar=1';
  const captions = "subtitles=captions.vtt:force_style='FontSize=22,Outline=1,MarginV=34'";
  const watermark = 'drawtext=textfile=brand.txt:expansion=none:fontcolor=white:fontsize=18:box=1:boxcolor=black@0.45:boxborderw=6:x=w-tw-18:y=h-th-18';
  const encode = (filter, name) => ['-vf', filter, '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', path.join(matrix, name + '.mp4')];
  const probe = extra => ['-v', 'verbose', '-protocol_whitelist', 'file', ...extra,
    '-show_entries', 'stream=codec_name,codec_type:format=duration', '-of', 'json', input];
  await run('probe_hls_strict', 'ffprobe', probe(strict));
  await run('probe_hls_default_formats', 'ffprobe', probe([]));
  await run('hls_remux_copy', 'ffmpeg', [...read(strict), '-c', 'copy', '-movflags', '+faststart', path.join(matrix, 'remux.mp4')]);
  await run('hls_decode_null', 'ffmpeg', [...read(strict), '-f', 'null', '-']);
  await run('hls_decode_default_formats', 'ffmpeg', [...read([]), '-f', 'null', '-']);
  for (const [name, filter, options] of [
    ['plain', scale, []], ['captions', scale + ',' + captions, []], ['watermark', scale + ',' + watermark, []],
    ['combined', scale + ',' + captions + ',' + watermark, []],
    ['combined_filter_threads', scale + ',' + captions + ',' + watermark, ['-filter_threads', '2', '-filter_complex_threads', '2']],
    ['combined_scalar_cpu', scale + ',' + captions + ',' + watermark, ['-cpuflags', '0']],
  ]) await run('hls_encode_' + name, 'ffmpeg', [...options, ...read(strict), ...encode(filter, name)]);
  const direct = path.join(matrix, 'direct.mp4');
  const created = await run('generate_direct_mp4', 'ffmpeg', [...global, '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '1', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', direct]);
  if (created) {
    await run('probe_direct_mp4', 'ffprobe', ['-v', 'verbose', '-protocol_whitelist', 'file', '-show_entries', 'stream=codec_name,codec_type:format=duration', '-of', 'json', direct]);
    await run('direct_mp4_combined', 'ffmpeg', [...global, '-threads', '2', '-i', direct, '-t', '0.25', ...encode(scale + ',' + captions + ',' + watermark, 'direct-combined')]);
  }
}

export async function withSyntheticEncoderDiagnostics(directory, run, emit = value => process.stderr.write(JSON.stringify(value) + '\n')) {
  const root = path.resolve(directory), parent = path.resolve(os.tmpdir());
  if (path.dirname(root) !== parent || !/^pc-(?:live-clip-test|renderer-acceptance|encoder-diagnostic)-[A-Za-z0-9_-]+$/.test(path.basename(root))) {
    throw Error('synthetic_diagnostics_scope_invalid');
  }
  const inside = value => typeof value === 'string' && (value === root || value.startsWith(root + path.sep));
  const clean = value => String(value).replaceAll(root, '<synthetic>')
    .replace(/https?:\/\/[^\s"']+/g, '<url-redacted>').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 6000);
  const original = childProcess.spawn;
  let stage = 'fixture_setup', reported = 0;
  childProcess.spawn = function (binary, args, options) {
    const child = original.call(this, binary, args, options);
    const name = typeof binary === 'string' ? path.basename(binary) : '';
    const scoped = ['ffmpeg', 'ffprobe'].includes(name) && Array.isArray(args)
      && (inside(options?.cwd) || args.some(inside)) && !args.some(value => /^https?:\/\//.test(String(value)));
    if (scoped && child.stderr) {
      const phase = stage, chunks = [];
      let bytes = 0;
      child.stderr.on('data', chunk => {
        if (bytes >= 8192) return;
        const part = Buffer.from(chunk).subarray(0, 8192 - bytes); chunks.push(part); bytes += part.length;
      });
      child.once('close', (code, signal) => {
        if (code === 0 || reported++ >= 4) return;
        emit({ event: 'synthetic_encoder_failure', scope: 'offline_generated_fixture', stage: phase,
          binary: name, exit_code: code, signal: signal || null,
          arguments: args.slice(0, 100).map(value => clean(value).slice(0, 1200)),
          stderr: clean(Buffer.concat(chunks).toString('utf8')) });
      });
    }
    return child;
  };
  syncBuiltinESMExports();
  try {
    return await run(value => {
      if (!/^[a-z][a-z0-9_]{0,47}$/.test(value)) throw Error('synthetic_diagnostics_stage_invalid');
      stage = value;
    });
  } finally {
    childProcess.spawn = original;
    syncBuiltinESMExports();
  }
}
