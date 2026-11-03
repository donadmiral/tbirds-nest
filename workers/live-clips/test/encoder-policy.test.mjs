import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, COMPILE_DEPENDENCIES, RUNTIME_METADATA, checkRuntimeFiles, validateComponents } from '../encoder-policy.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { command } from '../../media-renditions/transcode.mjs';

const configuration = '--disable-everything --disable-autodetect --disable-network --enable-static --enable-libx264 --enable-libass';
const packages = ['musl-1.2.6-r0', 'libass-0.17.4-r1', 'x264-libs-0.164-r0', 'fontconfig-2.17.1-r0', 'freetype-2.14.1-r0'];
const config = '#define CONFIG_NETWORK 0\n#define CONFIG_FRAME_THREAD_ENCODER 1\n';
const header = Object.entries(COMPONENTS)
  .flatMap(([kind, names]) => names.map(name => '#define CONFIG_' + name + '_' + kind + ' 1')).join('\n') + '\n';

test('actual image gate requires UID 1000, readable public metadata and the explicit read-only base COPY', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /^COPY --chmod=0444 renderer-base-image\.json \/usr\/local\/share\/pc-live-clips\/base-image\.json$/m);
  const base = { uid: 1000, stat: name => ({ isFile: () => true, uid: 0, mode: name.endsWith('/base-image.json') ? 0o100444 : 0o100644 }),
    read: () => Buffer.from('public synthetic metadata') };
  assert.deepEqual(checkRuntimeFiles(base), { runtime_uid: 1000, runtime_metadata_readable: true, public_base_mode: '0444' });
  assert.throws(() => checkRuntimeFiles({ ...base, uid: 0 }), /runtime_identity/);
  // Exact failure from the first social image: root-owned COPY preserved 0600.
  assert.throws(() => checkRuntimeFiles({ ...base, stat: () => ({ isFile: () => true, uid: 0, mode: 0o100600 }) }), /metadata_permissions/);
  for (const name of RUNTIME_METADATA) {
    assert.throws(() => checkRuntimeFiles({ ...base, read: filename => {
      if (filename.endsWith('/' + name)) throw Object.assign(Error('EACCES'), { code: 'EACCES' });
      return Buffer.from('public synthetic metadata');
    } }), /EACCES/);
  }
  for (const mode of [0o100664, 0o100666]) assert.throws(() => checkRuntimeFiles({ ...base,
    stat: () => ({ isFile: () => true, uid: 0, mode }) }), /metadata_permissions/);
});

test('encoder security gate rejects restored network protocols, unsupported codecs and broad packages', () => {
  const valid = validateComponents(config, header, configuration, packages);
  assert.equal(valid.protocol, 2); assert.equal(valid.hwaccel, 0);
  assert.throws(() => validateComponents(config.replace('CONFIG_NETWORK 0', 'CONFIG_NETWORK 1'), header, configuration, packages), /network_enabled/);
  for (const item of ['LIBRIST_PROTOCOL', 'HTTP_PROTOCOL', 'TIFF_DECODER', 'HUFFYUV_DECODER', 'HEVC_DECODER', 'VVC_DECODER', 'VP9_DECODER', 'AC3_DECODER', 'EAC3_DECODER', 'IMF_DEMUXER', 'DVD_SUBTITLE_PARSER', 'HQDN3D_FILTER']) {
    assert.throws(() => validateComponents(config, header + '#define CONFIG_' + item + ' 1\n', configuration, packages), /unapproved_/);
  }
  for (const name of ['libtiff-4.7.0-r0', 'librist-0.2.10-r0', 'ffmpeg-libavcodec-9.0.2-r0', 'librsvg-2.58.5-r0', 'glibc-2.43-r0']) {
    assert.throws(() => validateComponents(config, header, configuration, [...packages, name]), /unapproved_package/);
  }
});

test('actual required HLS/MOV/MPEGTS/tool dependency set remains distinct from supported codecs', () => {
  assert.deepEqual(COMPILE_DEPENDENCIES.hls_demuxer, ['AC3_DEMUXER', 'EAC3_DEMUXER']);
  assert.deepEqual(COMPILE_DEPENDENCIES.mpegts_muxer, ['HEVC_MP4TOANNEXB_BSF', 'VVC_MP4TOANNEXB_BSF']);
  // Use the observed native configure set, not every name in the policy.
  const actual = {
    PROTOCOL: ['FILE', 'PIPE'], DEMUXER: ['AAC', 'AC3', 'EAC3', 'HLS', 'IMAGE2', 'IMAGE2PIPE', 'MJPEG', 'MOV', 'MPEGTS', 'WEBVTT'],
    DECODER: ['AAC', 'AAC_LATM', 'H264', 'MJPEG', 'PCM_S16LE', 'RAWVIDEO', 'WEBVTT', 'WRAPPED_AVFRAME'],
    ENCODER: ['AAC', 'LIBX264', 'MJPEG', 'PCM_S16LE', 'RAWVIDEO', 'WRAPPED_AVFRAME'],
    PARSER: ['AAC', 'AAC_LATM', 'AC3', 'H264', 'MJPEG'],
    BSF: ['AAC_ADTSTOASC', 'EXTRACT_EXTRADATA', 'H264_MP4TOANNEXB', 'HEVC_MP4TOANNEXB', 'NULL', 'VP9_SUPERFRAME', 'VVC_MP4TOANNEXB'],
    FILTER: ['AFORMAT', 'ANULL', 'ANULLSRC', 'ARESAMPLE', 'ASETPTS', 'ATRIM', 'COLOR', 'CROP', 'DRAWTEXT', 'FORMAT', 'FPS', 'HFLIP', 'NULL', 'PAD', 'ROTATE', 'SCALE', 'SETPTS', 'SETSAR', 'SINE', 'SUBTITLES', 'TESTSRC2', 'TRANSPOSE', 'TRIM', 'VFLIP'],
    MUXER: ['MP4', 'MOV', 'IMAGE2', 'IMAGE2PIPE', 'NULL', 'HLS', 'MPEGTS', 'ADTS', 'LATM', 'WEBVTT'], INDEV: ['LAVFI'],
  };
  const componentConfig = Object.entries(actual).flatMap(([kind, names]) => names.map(name => '#define CONFIG_' + name + '_' + kind + ' 1')).join('\n') + '\n';
  const counts = validateComponents(config, componentConfig, configuration, packages);
  assert.equal(counts.decoder, 8); assert.equal(counts.encoder, 6); assert.equal(counts.protocol, 2); assert.equal(counts.hwaccel, 0);
  for (const unsupported of ['HEVC', 'VVC', 'VP9', 'AC3', 'EAC3']) assert.equal(COMPONENTS.DECODER.includes(unsupported), false);
});

test('component inventory honors FFmpeg header boundaries without admitting unknown registered encoders', () => {
  // config.h contains internal implementation support, while configure writes
  // registered codec selections separately in config_components.h.
  const counts = validateComponents(config, header, configuration, packages);
  assert.equal(counts.encoder, 6);
  assert.throws(() => validateComponents(config, header + '#define CONFIG_FRAME_THREAD_ENCODER 1\n', configuration, packages), /unapproved_encoder/);
  assert.throws(() => validateComponents(config.replace('#define CONFIG_NETWORK 0\n', ''), header + '#define CONFIG_NETWORK 0\n', configuration, packages), /network_enabled/);
});

test('encoder policy fails closed if required captions, AAC, HLS or explicit minimal configuration are absent', () => {
  for (const item of ['SUBTITLES_FILTER', 'DRAWTEXT_FILTER', 'AAC_DECODER', 'HLS_DEMUXER', 'LIBX264_ENCODER']) {
    assert.throws(() => validateComponents(config, header.replace('#define CONFIG_' + item + ' 1\n', ''), configuration, packages), /missing_/);
  }
  assert.throws(() => validateComponents(config, header, configuration.replace('--disable-autodetect', ''), packages), /build_policy_invalid/);
});

test('a subprocess ignoring TERM is killed after cancellation and the next command still succeeds', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pc-encoder-cancel-'));
  const pidFile = path.join(directory, 'child.pid'), controller = new AbortController();
  let pid;
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const script = "process.on('SIGTERM',()=>{}); require('node:fs').writeFileSync(process.argv[1],String(process.pid)); setInterval(()=>{},1000);";
    const result = command(process.execPath, ['-e', script, pidFile], { signal: controller.signal }).catch(error => error);
    const waiting = Date.now();
    while (!pid && Date.now() - waiting < 3000) {
      try { pid = Number(await readFile(pidFile, 'utf8')); } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    assert.ok(Number.isSafeInteger(pid) && pid > 1);
    const started = Date.now(); controller.abort();
    assert.equal((await result).message, 'worker_deadline');
    assert.ok(Date.now() - started < 3000);
    assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
    assert.equal(await command(process.execPath, ['-e', "process.stdout.write('recovered')"]), 'recovered');
  } finally {
    clearTimeout(timer); controller.abort();
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await rm(directory, { recursive: true, force: true });
  }
});
