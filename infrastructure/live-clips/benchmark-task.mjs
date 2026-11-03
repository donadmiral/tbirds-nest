// Execute as node --input-type=module -e <this file> -- --run in the exact image.
// Synthetic media only. No broker, AWS SDK, credentials, provider or network calls.
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const { renderClip } = await import('/app/workers/live-clips/render.mjs');
const { command, probe } = await import('/app/workers/media-renditions/transcode.mjs');

export async function benchmark({ durations = [15, 30, 60, 90, 600], totalMs = 900000,
  sourceMs = 240000, renderMs = 240000, emit = value => process.stdout.write(JSON.stringify(value) + '\n') } = {}) {
  if (!Array.isArray(durations) || durations.length > 5 || !durations.length
    || durations.some(v => !Number.isInteger(v) || v < 1 || v > 600)
    || ![totalMs, sourceMs, renderMs].every(v => Number.isInteger(v) && v >= 1000 && v <= 900000)) throw Error('benchmark_input_invalid');
  const started = Date.now(), total = new AbortController(), timer = setTimeout(() => total.abort(), totalMs);
  timer.unref();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pc-clip-benchmark-'));
  const results = [], budget = 536870912;
  let sourceBytes = 0, sourceElapsed = null, sourceOk = false;
  emit({ event: 'renderer_benchmark_started', durations_seconds: durations, absolute_limit_ms: totalMs,
    render_limit_ms: renderMs, synthetic_media_only: true, broker_calls: 0 });
  try {
    const sourceStarted = Date.now(), sourceAbort = new AbortController();
    const sourceSignal = AbortSignal.any([total.signal, sourceAbort.signal, AbortSignal.timeout(sourceMs)]);
    let sampling = false;
    const monitor = setInterval(async () => {
      if (sampling) return; sampling = true;
      try {
        let bytes = 0;
        for (const name of await readdir(directory)) bytes += (await stat(path.join(directory, name))).size;
        if (bytes > budget) sourceAbort.abort();
      } catch { sourceAbort.abort(); } finally { sampling = false; }
    }, 500);
    try {
      await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
        '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', String(Math.max(...durations)),
        '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-crf', '30', '-maxrate', '2400k', '-bufsize', '4800k',
        '-pix_fmt', 'yuv420p', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-f', 'hls', '-hls_time', '6', '-hls_list_size', '0',
        '-hls_playlist_type', 'vod', '-hls_segment_filename', 'segment%04d.ts', 'source.m3u8'],
      { cwd: directory, signal: sourceSignal });
    } finally { clearInterval(monitor); }
    for (const name of await readdir(directory)) sourceBytes += (await stat(path.join(directory, name))).size;
    if (sourceBytes > budget) throw Error('benchmark_source_budget');
    sourceOk = true; sourceElapsed = Date.now() - sourceStarted;
    emit({ event: 'renderer_benchmark_source_ready', duration_seconds: Math.max(...durations),
      source_bytes: sourceBytes, elapsed_ms: sourceElapsed, high_motion: true, width: 1280, height: 720, fps: 30 });
    for (const seconds of durations) {
      if (total.signal.aborted) break;
      const caseStarted = Date.now(), output = path.join(directory, 'out-' + seconds);
      let renderElapsed = null, phase = 'render';
      const renderSignal = AbortSignal.any([total.signal, AbortSignal.timeout(renderMs)]);
      try {
        const coverMs = Math.min(1000, Math.floor(seconds * 500));
        const manifest = await renderClip({ filename: path.join(directory, 'source.m3u8'), seekSeconds: 0,
          durationSeconds: seconds }, output, {
          formats: ['horizontal', 'vertical'], cover_ms: coverMs, watermark: true,
          brand_text: 'Synthetic renderer benchmark', burn_captions: true,
          subtitles: [{ start_ms: 0, end_ms: Math.min(seconds * 1000, 2000), text: 'Synthetic clip acceptance' }],
        }, { signal: renderSignal, threads: 2, maxBytes: budget });
        renderElapsed = Date.now() - caseStarted;
        if (renderElapsed >= renderMs) throw Error('benchmark_render_deadline');
        phase = 'decode';
        const decodeSignal = AbortSignal.any([total.signal, AbortSignal.timeout(60000)]), videos = [];
        for (const name of ['horizontal.mp4', 'vertical.mp4']) {
          const media = await probe(path.join(output, name), { signal: decodeSignal });
          const [width, height] = name === 'horizontal.mp4' ? [1280, 720] : [720, 1280];
          if (media.width !== width || media.height !== height || !media.audio || Math.abs(media.duration - seconds) > 0.15) throw Error('benchmark_video_invalid');
          await command('ffmpeg', ['-v', 'error', '-nostdin', '-threads', '2', '-i', path.join(output, name),
            '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { signal: decodeSignal });
          videos.push({ name, width, height, duration_seconds: media.duration, audio: true, decoded: true });
        }
        const captions = await readFile(path.join(output, 'captions.vtt'), 'utf8');
        if (!captions.startsWith('WEBVTT\n') || !captions.includes('Synthetic clip acceptance')) throw Error('benchmark_captions_invalid');
        const cover = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height',
          '-of', 'json', path.join(output, 'thumbnail.jpg')], { signal: decodeSignal }));
        if (cover.streams?.[0]?.width !== 640 || cover.streams[0].height < 1) throw Error('benchmark_cover_invalid');
        results.push({ duration_seconds: seconds, ok: true, render_ms: renderElapsed, total_case_ms: Date.now() - caseStarted,
          within_render_deadline: renderElapsed < renderMs, videos, captions_verified: true, cover_ms: coverMs,
          cover_width: cover.streams[0].width, cover_height: cover.streams[0].height,
          output_bytes: manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0) });
      } catch {
        results.push({ duration_seconds: seconds, ok: false, render_ms: renderElapsed, total_case_ms: Date.now() - caseStarted,
          phase, code: total.signal.aborted ? 'absolute_deadline' : renderSignal.aborted ? 'render_deadline' : 'encoder_or_decode_validation_failed' });
      } finally { await rm(output, { recursive: true, force: true }); }
      emit({ event: 'renderer_benchmark_case', ...results.at(-1) });
    }
  } catch {
    emit({ event: 'renderer_benchmark_source_failed', code: total.signal.aborted ? 'absolute_deadline' : 'source_generation_failed' });
  } finally { clearTimeout(timer); await rm(directory, { recursive: true, force: true }); }
  const receipt = { schema_version: 1, event: 'renderer_benchmark_complete',
    ok: sourceOk && results.length === durations.length && results.every(result => result.ok),
    scope: 'synthetic_local_encoding_on_exact_task_image', source_profile: 'high-motion-720p30-H264-AAC',
    source_generation_ms: sourceElapsed, source_bytes: sourceBytes, cases: results,
    elapsed_ms: Date.now() - started, absolute_limit_ms: totalMs, render_limit_ms: renderMs,
    download_and_upload_included: false, provider_broadcast_verified: false, measured_capacity_verified: false };
  emit(receipt); return receipt;
}
if (process.argv.includes('--run')) {
  const hardStop = setTimeout(() => { process.stderr.write('{"event":"renderer_benchmark_forced_timeout"}\n'); process.exit(124); }, 910000);
  try { process.exitCode = (await benchmark()).ok ? 0 : 1; }
  catch { process.stderr.write('{"event":"renderer_benchmark_failed"}\n'); process.exitCode = 1; }
  finally { clearTimeout(hardStop); }
}
