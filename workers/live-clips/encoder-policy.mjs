// Build/acceptance gate for the compiled attack surface. No environment/secret reads.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = '/usr/local/share/pc-live-clips';
export const RUNTIME_METADATA = Object.freeze(['base-image.json', 'config.h', 'config_components.h',
  'ffmpeg-buildconf.txt', 'ffmpeg-source.sha256', 'inventory.json']);

/** The real image gate runs this as UID 1000 on its read-only filesystem. */
export function checkRuntimeFiles({ uid = process.getuid?.(), stat = lstatSync, read = readFileSync } = {}) {
  if (uid !== 1000) throw Error('encoder_runtime_identity_invalid');
  for (const name of RUNTIME_METADATA) {
    const filename = ROOT + '/' + name, info = stat(filename);
    // These files contain public build evidence only. Root owns the immutable
    // image files; the runtime must be able to read them without writing them.
    if (!info.isFile() || info.uid !== 0 || !(info.mode & 0o004) || (info.mode & 0o022)
      || (name === 'base-image.json' && (info.mode & 0o777) !== 0o444)) throw Error('encoder_runtime_metadata_permissions');
    const bytes = read(filename);
    if (!bytes.length || bytes.length > 1048576) throw Error('encoder_runtime_metadata_invalid');
  }
  return { runtime_uid: uid, runtime_metadata_readable: true, public_base_mode: '0444' };
}
// Required by the authenticated n9.0.2 configure dependency graph and confirmed
// in the actual build. These are container/tool helpers, not enabled decoders.
export const COMPILE_DEPENDENCIES = Object.freeze({
  hls_demuxer: ['AC3_DEMUXER', 'EAC3_DEMUXER'],
  mov_muxer: ['VP9_SUPERFRAME_BSF'],
  mpegts_muxer: ['HEVC_MP4TOANNEXB_BSF', 'VVC_MP4TOANNEXB_BSF'],
  ffmpeg_tool: ['CROP_FILTER', 'HFLIP_FILTER', 'ROTATE_FILTER', 'TRANSPOSE_FILTER', 'VFLIP_FILTER'],
});
export const COMPONENTS = Object.freeze({
  PROTOCOL: ['FILE', 'PIPE'],
  DEMUXER: ['AAC', 'AC3', 'EAC3', 'HLS', 'MPEGTS', 'MOV', 'WEBVTT', 'IMAGE2', 'IMAGE2PIPE', 'MJPEG'],
  MUXER: ['MP4', 'MOV', 'IMAGE2', 'IMAGE2PIPE', 'NULL', 'HLS', 'MPEGTS', 'ADTS', 'LATM', 'WEBVTT'],
  DECODER: ['H264', 'AAC', 'AAC_LATM', 'MJPEG', 'WEBVTT', 'PCM_S16LE', 'RAWVIDEO', 'WRAPPED_AVFRAME'],
  ENCODER: ['LIBX264', 'AAC', 'MJPEG', 'PCM_S16LE', 'RAWVIDEO', 'WRAPPED_AVFRAME'],
  PARSER: ['H264', 'AAC', 'AAC_LATM', 'MJPEG', 'AC3'],
  BSF: ['AAC_ADTSTOASC', 'H264_MP4TOANNEXB', 'HEVC_MP4TOANNEXB', 'VVC_MP4TOANNEXB', 'VP9_SUPERFRAME', 'EXTRACT_EXTRADATA', 'NULL'],
  INDEV: ['LAVFI'], OUTDEV: [], HWACCEL: [],
  FILTER: ['SCALE', 'PAD', 'SETSAR', 'FORMAT', 'SUBTITLES', 'DRAWTEXT', 'ARESAMPLE', 'AFORMAT', 'ANULL',
    'ANULLSRC', 'NULL', 'TRIM', 'ATRIM', 'SETPTS', 'ASETPTS', 'FPS', 'COLOR', 'SINE', 'TESTSRC2',
    'BUFFER', 'BUFFERSINK', 'ABUFFER', 'ABUFFERSINK', 'CROP', 'HFLIP', 'ROTATE', 'TRANSPOSE', 'VFLIP'],
});
const REQUIRED = {
  PROTOCOL: ['FILE', 'PIPE'], DEMUXER: ['HLS', 'MPEGTS', 'MOV', 'WEBVTT'],
  MUXER: ['MP4', 'IMAGE2', 'NULL', 'HLS'], DECODER: ['H264', 'AAC', 'MJPEG', 'WEBVTT'],
  ENCODER: ['LIBX264', 'AAC', 'MJPEG'], INDEV: ['LAVFI'],
  FILTER: ['SCALE', 'PAD', 'SETSAR', 'SUBTITLES', 'DRAWTEXT', 'ARESAMPLE', 'COLOR', 'SINE', 'TESTSRC2'],
};
export function validateComponents(config, componentConfig, configuration, packages) {
  if (!/#define CONFIG_NETWORK 0(?:\n|$)/.test(config)) throw Error('encoder_network_enabled');
  const counts = {};
  for (const [kind, permitted] of Object.entries(COMPONENTS)) {
    // configure keeps registered components in this dedicated header. Internal
    // config.h support macros such as FRAME_THREAD_ENCODER are not codecs.
    const enabled = [...componentConfig.matchAll(new RegExp('^#define CONFIG_([A-Z0-9_]+)_' + kind + ' 1$', 'gm'))].map(value => value[1]);
    if (enabled.some(value => !permitted.includes(value))) throw Error('encoder_unapproved_' + kind.toLowerCase());
    if ((REQUIRED[kind] || []).some(value => !enabled.includes(value))) throw Error('encoder_missing_' + kind.toLowerCase());
    counts[kind.toLowerCase()] = enabled.length;
  }
  for (const flag of ['--disable-everything', '--disable-autodetect', '--disable-network', '--enable-static', '--enable-libx264', '--enable-libass']) {
    if (!configuration.split(/\s+/).includes(flag)) throw Error('encoder_build_policy_invalid');
  }
  if (!Array.isArray(packages) || packages.length < 5 || packages.some(value => /^(?:ffmpeg|tiff|libtiff|librist|librsvg|libjxl|cjson|speex|libxi|libx11|glibc|util-linux)(?:-[0-9]|-)/.test(value))) {
    throw Error('encoder_unapproved_package');
  }
  return counts;
}
export function inspectEncoder() {
  if (process.versions.node !== '24.22.2') throw Error('encoder_node_version_invalid');
  const run = args => execFileSync('ffmpeg', ['-hide_banner', ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 1048576 });
  const version = run(['-version']).split('\n')[0];
  if (!/^ffmpeg version 9\.0\.2(?:\s|$)/.test(version)) throw Error('encoder_version_invalid');
  const configuration = readFileSync(ROOT + '/ffmpeg-buildconf.txt', 'utf8');
  const config = readFileSync(ROOT + '/config.h', 'utf8');
  const componentConfig = readFileSync(ROOT + '/config_components.h', 'utf8');
  const packages = execFileSync('apk', ['info', '-v'], { encoding: 'utf8', timeout: 10000, maxBuffer: 1048576 }).trim().split('\n').sort();
  const counts = validateComponents(config, componentConfig, configuration, packages);
  const actualProtocols = [...new Set(run(['-protocols']).split('\n').map(value => value.trim()).filter(value => /^[a-z][a-z0-9_]*$/.test(value)))].sort();
  if (actualProtocols.join(',') !== 'file,pipe') throw Error('encoder_protocol_binary_mismatch');
  const source = readFileSync(ROOT + '/ffmpeg-source.sha256', 'utf8').split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/.test(source)) throw Error('encoder_source_digest_invalid');
  const base = JSON.parse(readFileSync(ROOT + '/base-image.json', 'utf8'));
  if (!/^node@sha256:[a-f0-9]{64}$/.test(base.image) || base.node_version !== '24.22.2') throw Error('encoder_base_invalid');
  const binaries = Object.fromEntries(['ffmpeg', 'ffprobe'].map(name => [name, createHash('sha256').update(readFileSync('/usr/local/bin/' + name)).digest('hex')]));
  return { schema_version: 1, ok: true, ffmpeg_version: '9.0.2', ffmpeg_source: 'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz',
    ffmpeg_source_sha256: source, source_signature_verified_at_build: true,
    release_signing_key: 'FCF986EA15E6E293A5644F10B4322F04D67658D8',
    source_component: { type: 'application', name: 'ffmpeg', version: '9.0.2', purl: 'pkg:generic/ffmpeg@9.0.2',
      cpe: 'cpe:2.3:a:ffmpeg:ffmpeg:9.0.2:*:*:*:*:*:*:*' },
    base, node_version: process.versions.node, alpine_version: readFileSync('/etc/alpine-release', 'utf8').trim(),
    component_counts: counts, required_compile_dependencies: COMPILE_DEPENDENCIES, protocols: actualProtocols, binaries, packages,
    remaining_review: ['CVE-2025-52290: reachable H.264/AAC probing DoS; upstream fixed-version status undetermined'],
    vulnerability_free_claim: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const writing = process.argv.includes('--write-inventory');
    const permissions = writing ? {} : checkRuntimeFiles();
    const receipt = { ...inspectEncoder(), ...permissions };
    if (writing) writeFileSync(ROOT + '/inventory.json', JSON.stringify(receipt, null, 2) + '\n');
    process.stdout.write(JSON.stringify(receipt) + '\n');
  } catch (error) {
    const code = /^encoder_[a-z_]+$/.test(error?.message || '') ? error.message : 'encoder_policy_failed';
    process.stderr.write(JSON.stringify({ ok: false, error: code }) + '\n'); process.exitCode = 1;
  }
}
