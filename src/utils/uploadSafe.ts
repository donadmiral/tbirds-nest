// src/utils/uploadSafe.ts
// One gate every upload passes through. Video leaves as H.264 MP4, images
// leave as JPEG/PNG/GIF/WebP. Never QuickTime, never HEIC. Real transcode
// when react-native-compressor is in the native build. Conversion failure
// keeps the draft local instead of disguising unsupported bytes as MP4/JPEG.
import { resolveTrueMeta } from './sniffMedia';

export type SafeKind = 'image' | 'video';
export type SafeMedia = { uri: string; ext: string; mime: string; kind: SafeKind; converted: boolean };

const VIDEO_OK = new Set(['mp4', 'm4v', 'webm']);
const IMAGE_OK = new Set(['jpg', 'png', 'gif', 'webp']);

function extOf(uri: string, fallback: string): string {
  const raw = (uri.split('?')[0].split('#')[0].split('.').pop() || fallback).toLowerCase();
  return raw === 'jpeg' ? 'jpg' : raw;
}
function mimeOf(kind: SafeKind, ext: string): string {
  if (kind === 'video') return ext === 'webm' ? 'video/webm' : 'video/mp4';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function nitroNativeAvailable(): boolean {
  // react-native-compressor 2.x runs on Nitro Modules. The JS package installs
  // fine, so require() succeeds even when the native side is missing from the
  // current build, and the first call into it throws or never resolves. Check
  // for the native module by name before touching the library at all.
  try {
    const RN: any = require('react-native');
    if (RN?.TurboModuleRegistry?.get?.('NitroModules')) return true;
    if (RN?.NativeModules?.NitroModules) return true;
  } catch {}
  return false;
}

async function transcodeVideo(uri: string): Promise<string | null> {
  if (!nitroNativeAvailable()) {
    console.log('[uploadSafe] Native video conversion is unavailable');
    return null;
  }
  try {
    const mod: any = require('react-native-compressor');
    const Video = mod?.Video || mod?.default?.Video;
    if (!Video?.compress) return null;
    let cancellationId: string | undefined;
    let timedOut = false;
    const work: Promise<string | null> = Promise.resolve()
      .then(() => Video.compress(uri, { compressionMethod: 'manual', maxSize: 1920, bitrate: 6000000, getCancellationId: (id: string) => { cancellationId = id; if (timedOut) { try { Video.cancelCompression(id); } catch {} } } }))
      .catch((e: any) => { console.log('[uploadSafe] native transcode failed', e?.message || e); return null; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => { timedOut = true; if (cancellationId) { try { Video.cancelCompression(cancellationId); } catch {} } resolve(null); }, 45000); });
    try {
      const out = await Promise.race([work, timeout]);
      if (!out || out === uri) return null;
      return out;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  } catch (e) {
    console.log('[uploadSafe] native transcode unavailable', (e as any)?.message || e);
    return null;
  }
}

async function toJpeg(uri: string): Promise<string | null> {
  try {
    const IM: any = require('expo-image-manipulator');
    if (!IM?.ImageManipulator?.manipulate) return null;
    const context = IM.ImageManipulator.manipulate(uri);
    let rendered: any;
    try {
      rendered = await context.renderAsync();
      const result = await rendered.saveAsync({ compress: 0.9, format: IM.SaveFormat?.JPEG || 'jpeg' });
      return result?.uri || null;
    } finally { rendered?.release?.(); context.release?.(); }
  } catch (e) {
    console.log('[uploadSafe] image convert unavailable', (e as any)?.message || e);
    return null;
  }
}

export async function ensureUploadSafe(uri: string, kindHint: SafeKind, extHint?: string): Promise<SafeMedia> {
  let kind: SafeKind = kindHint;
  let ext = (extHint || extOf(uri, kind === 'video' ? 'mp4' : 'jpg')).toLowerCase().replace('jpeg', 'jpg');
  let mime = mimeOf(kind, ext);
  try {
    const tm: any = await resolveTrueMeta(uri, kind, ext, mime);
    if (tm?.kind === 'video' || tm?.kind === 'image') kind = tm.kind;
    if (tm?.ext) ext = String(tm.ext).toLowerCase().replace('jpeg', 'jpg');
    if (tm?.mime) mime = String(tm.mime);
  } catch {}
  if (kind === 'video') {
    const needs = !VIDEO_OK.has(ext) || mime === 'video/quicktime';
    if (!needs) return { uri, ext, mime: mimeOf('video', ext), kind, converted: false };
    const out = await transcodeVideo(uri);
    if (out) return { uri: out, ext: 'mp4', mime: 'video/mp4', kind, converted: true };
    throw new Error('This video could not be converted to a supported format. Your original is kept. Please retry or choose an MP4 video.');
  }
  const needsImg = !IMAGE_OK.has(ext) || /hei[cf]/i.test(mime);
  if (!needsImg) return { uri, ext, mime: mimeOf('image', ext), kind, converted: false };
  const out = await toJpeg(uri);
  if (out) return { uri: out, ext: 'jpg', mime: 'image/jpeg', kind, converted: true };
  throw new Error('This photo could not be converted to a supported format. Your original is kept. Please retry or choose a JPEG or PNG photo.');
}
