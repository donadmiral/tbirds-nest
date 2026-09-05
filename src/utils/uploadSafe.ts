// src/utils/uploadSafe.ts
// One gate every upload passes through. Video leaves as H.264 MP4, images
// leave as JPEG/PNG/GIF/WebP. Never QuickTime, never HEIC. Real transcode
// when react-native-compressor is in the native build; until then the
// H.264 QuickTime file is uploaded as .mp4 / video/mp4, which browsers play.
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
    console.log('[uploadSafe] NitroModules not in this build, uploading untranscoded');
    return null;
  }
  try {
    const mod: any = require('react-native-compressor');
    const Video = mod?.Video || mod?.default?.Video;
    if (!Video?.compress) return null;
    const work: Promise<string | null> = Promise.resolve()
      .then(() => Video.compress(uri, { compressionMethod: 'manual', maxSize: 1920, bitrate: 6000000 }))
      .catch((e: any) => { console.log('[uploadSafe] native transcode failed', e?.message || e); return null; });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 45000));
    const out = await Promise.race([work, timeout]);
    if (!out || out === uri) return null;
    return out;
  } catch (e) {
    console.log('[uploadSafe] native transcode unavailable', (e as any)?.message || e);
    return null;
  }
}

async function toJpeg(uri: string): Promise<string | null> {
  try {
    const IM: any = require('expo-image-manipulator');
    if (!IM?.manipulateAsync) return null;
    const r = await IM.manipulateAsync(uri, [], { compress: 0.9, format: IM.SaveFormat?.JPEG || 'jpeg' });
    return r?.uri || null;
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
    return { uri, ext: 'mp4', mime: 'video/mp4', kind, converted: false };
  }
  const needsImg = !IMAGE_OK.has(ext) || /hei[cf]/i.test(mime);
  if (!needsImg) return { uri, ext, mime: mimeOf('image', ext), kind, converted: false };
  const out = await toJpeg(uri);
  if (out) return { uri: out, ext: 'jpg', mime: 'image/jpeg', kind, converted: true };
  return { uri, ext: 'jpg', mime: 'image/jpeg', kind, converted: false };
}