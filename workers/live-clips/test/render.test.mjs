import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { command, probe } from '../../media-renditions/transcode.mjs';
import { materializeSource } from '../source.mjs';
import { renderClip } from '../render.mjs';
import { withSyntheticEncoderDiagnostics, runSyntheticIsolationMatrix } from './synthetic-diagnostics.mjs';
for (const inputSize of ['320x180', '180x320']) test(`real ${inputSize} HLS range becomes precise faststart vertical/horizontal exports, captions and a chosen cover`, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pc-live-clip-test-'));
  try { await withSyntheticEncoderDiagnostics(dir, async stage => {
    const original = path.join(dir, 'original'); await mkdir(original);
    const signal = AbortSignal.timeout(60000);
    stage('fixture_generation');
    await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${inputSize}:rate=30`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '6', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast',
      '-g', '60', '-sc_threshold', '0', '-c:a', 'aac', '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'vod',
      '-hls_segment_filename', path.join(original, 'seg%03d.ts'), path.join(original, 'master.m3u8')], { signal });
    const requests = [];
    stage('materialize_source');
    const source = await materializeSource({ url: 'https://source.synthetic.invalid/session/master.m3u8', startMs: 1500, endMs: 4500 }, path.join(dir, 'source'), {
      signal, fetcher: async url => {
        requests.push(url); assert.ok(url.startsWith('https://source.synthetic.invalid/session/'));
        return new Response(await readFile(path.join(original, path.basename(new URL(url).pathname))));
      },
    });
    assert.equal(source.seekSeconds, 1.5); assert.equal(source.durationSeconds, 3);
    const output = path.join(dir, 'out');
    stage('render_clip');
    const rendered = await renderClip(source, output, { formats: ['horizontal', 'vertical'], cover_ms: 1200,
      watermark: true, brand_text: 'Creator 100%', burn_captions: true, subtitles: [{ start_ms: 0, end_ms: 2500, text: 'A real clip export' }] }, { signal });
    assert.equal(rendered.assets.length, 4); assert.equal(rendered.duration_ms, 3000);
    for (const [file, width, height] of [['horizontal.mp4', 1280, 720], ['vertical.mp4', 720, 1280]]) {
      stage(file.startsWith('horizontal') ? 'validate_horizontal' : 'validate_vertical');
      const media = await probe(path.join(output, file), { signal });
      assert.equal(media.width, width); assert.equal(media.height, height);
      assert.ok(Math.abs(media.duration - 3) <= .15); assert.equal(media.audio, true);
      const bytes = await readFile(path.join(output, file));
      assert.ok(bytes.indexOf('moov') < bytes.indexOf('mdat'), 'faststart metadata precedes media');
      await command('ffmpeg', ['-v', 'error', '-i', path.join(output, file), '-f', 'null', '-'], { signal });
    }
    assert.ok((await readFile(path.join(output, 'thumbnail.jpg'))).length > 100);
    assert.ok(rendered.assets.every(a => a.bytes > 0 && /^[a-f0-9]{64}$/.test(a.sha256)));
    assert.ok(requests.length <= 5);
  });
  } catch (error) {
    await runSyntheticIsolationMatrix(dir);
    throw error;
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('synthetic diagnostics report only scoped failures and restore production subprocess bindings', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pc-encoder-diagnostic-'));
  const records = [];
  try {
    await withSyntheticEncoderDiagnostics(dir, async stage => {
      stage('diagnostic_regression');
      await assert.rejects(command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin',
        '-f', 'synthetic_missing_format', '-i', path.join(dir, 'fixture.synthetic'), '-f', 'null', '-'],
      { signal: AbortSignal.timeout(5000) }), /decode_failed/);
    }, value => records.push(value));
    assert.equal(records.length, 1); assert.equal(records[0].stage, 'diagnostic_regression');
    assert.equal(records[0].scope, 'offline_generated_fixture'); assert.equal(records[0].binary, 'ffmpeg');
    assert.ok(records[0].stderr.length > 0 && records[0].stderr.length <= 6000);
    assert.equal(JSON.stringify(records).includes(dir), false);
    await assert.rejects(command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'synthetic_missing_format',
      '-i', path.join(dir, 'fixture.synthetic'), '-f', 'null', '-'], { signal: AbortSignal.timeout(5000) }), /decode_failed/);
    assert.equal(records.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
