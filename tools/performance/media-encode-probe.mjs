#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, transcode, probe } from '../../workers/media-renditions/transcode.mjs';
import metrics from './bounded-workload.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function run() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pc-capacity-encode-'));
  const concurrency = 2, jobs = 4, completed = [];
  let next = 0;
  try {
    const input = path.join(directory, 'fixture.mp4');
    await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=8',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-threads', '1', '-c:a', 'aac', '-shortest', input], { signal: AbortSignal.timeout(30000) });
    const inputBytes = await readFile(input), inputSha256 = digest(inputBytes);
    const start = performance.now();
    async function worker() {
      while (next < jobs) {
        const index = next++, output = path.join(directory, 'job-' + index), at = performance.now();
        const result = await transcode(input, output, { duration_max_seconds: 600, output_max_bytes: 805306368 },
          { threads: 1, signal: AbortSignal.timeout(60000) });
        const encodedAt = performance.now();
        assert.ok(result.assets.some(asset => asset.name === 'master.m3u8'));
        const variants = result.assets.filter(asset => /^r[0-9]+\/index\.m3u8$/.test(asset.name));
        assert.ok(variants.length >= 2);
        for (const variant of variants) await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist',
          'file,crypto', '-i', path.join(output, variant.name), '-f', 'null', '-'], { signal: AbortSignal.timeout(20000) });
        const fallback = await probe(path.join(output, 'fallback.mp4'));
        assert.equal(fallback.audio, true);
        assert.ok(Math.abs(fallback.duration - 8) < .25);
        assert.equal(digest(await readFile(input)), inputSha256);
        completed.push({ index, encodeMs: encodedAt - at, verifyMs: performance.now() - encodedAt,
          durationSeconds: fallback.duration, variants: variants.length, assets: result.assets.length,
          outputBytes: result.assets.reduce((sum, asset) => sum + asset.bytes, 0) });
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    const elapsedMs = performance.now() - start;
    return { version: 1, kind: 'isolated-encoder-throughput-probe', passed: completed.length === jobs,
      measuredAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      encoderSha256: digest(await readFile(path.join(root, 'workers/media-renditions/transcode.mjs'))),
      ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0],
      environment: { platform: os.platform(), arch: os.arch(), cpuCount: os.availableParallelism(), node: process.version },
      fixture: { width: 640, height: 360, durationSeconds: 8, inputBytes: inputBytes.length, inputSha256 },
      jobs, concurrency, threadsPerEncoder: 1, elapsedMs, verifiedJobsPerSecond: jobs / (elapsedMs / 1000),
      encodeMs: metrics.distribution(completed.map(row => row.encodeMs)), completed: completed.sort((a, b) => a.index - b.index),
      originalPreserved: true, everyHlsVariantDecoded: true, fallbackAudioVerified: true, providerCalls: 0, productionCapacityEstablished: false,
      limitations: ['Four repeated small fixtures measure only this host and codec mix.',
        'Elapsed throughput includes verification. It excludes download, upload, queue time, Sandbox startup, and CDN delivery.',
        'No inference about a multi-million-user production workload or reserved encoder fleet is valid.'] };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output) throw Error('Pass an explicit JSON report path');
  const report = await run();
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ kind: report.kind, passed: report.passed, jobs: report.jobs, elapsedMs: report.elapsedMs, verifiedJobsPerSecond: report.verifiedJobsPerSecond, output }));
}
