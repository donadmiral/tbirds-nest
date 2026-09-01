// src/services/mediaService.ts
import * as ImagePicker from 'expo-image-picker';
import { useSettingsStore } from '../stores/settingsStore';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';

import { resolveTrueMeta } from '../utils/sniffMedia';

export type MediaKind = 'image' | 'video' | 'gif' | 'document' | 'audio';

export type PickedMedia = {
  uri: string;
  kind: MediaKind;
  mimeType: string;
  ext: string;
  width?: number;
  height?: number;
  fileSize?: number;
  thumbnailUri?: string;
  base64?: string | null;
};

export type UploadResult = {
  url: string;
  path: string;
  kind: MediaKind;
  width?: number;
  height?: number;
};

export const MEDIA_LIMITS = {
  imageBytes: 10 * 1024 * 1024,
  documentBytes: 25 * 1024 * 1024,
  audioBytes: 15 * 1024 * 1024,
};

export type Bucket =
  | 'post-media'
  | 'chat-media'
  | 'chat-files'
  | 'avatars'
  | 'mingle-media'
  | 'business-media'
  | 'startup-media'
  | 'market-media';

function mimeFor(kind: MediaKind, ext: string): string {
  if (kind === 'image') {
    if (ext === 'png') return 'image/png';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    return 'image/jpeg';
  }
  if (kind === 'video') return 'video/mp4';
  if (kind === 'audio') return ext === 'm4a' ? 'audio/m4a' : 'audio/mpeg';
  return 'application/octet-stream';
}

function safeExt(uri: string, fallback: string): string {
  const raw = uri.split('.').pop()?.toLowerCase().split('?')[0] ?? fallback;
  return raw === 'jpeg' ? 'jpg' : raw;
}

async function getAuthToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || SUPABASE_ANON_KEY;
}

export async function pickFromLibrary(opts?: {
  allowVideos?: boolean;
  multiple?: boolean;
  selectionLimit?: number;
  quality?: number;
  includeBase64?: boolean;
}): Promise<PickedMedia[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo library permission denied');

  const mediaTypes = (opts?.allowVideos
    ? ['images', 'videos']
    : ['images']) as ImagePicker.MediaType[];

  const result = await ImagePicker.launchImageLibraryAsync({
        preferredAssetRepresentationMode: "compatible" as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
    mediaTypes,
    allowsMultipleSelection: !!opts?.multiple,
    selectionLimit: opts?.selectionLimit ?? 10,
    // Data saver halves upload weight; explicit quality from callers wins.
    quality: opts?.quality ?? (useSettingsStore.getState().uploadQuality === 'data-saver' ? 0.5 : 0.85),
    base64: !!opts?.includeBase64,
  });
  if (result.canceled || !result.assets?.length) return [];

  const out: PickedMedia[] = [];
  for (const a of result.assets) {
    let isVideo = a.type === 'video';
    let kind: MediaKind = isVideo ? 'video' : 'image';
    let ext = safeExt(a.uri, isVideo ? 'mp4' : 'jpg');
    let sniffMime: string | null = null;
    try {
      const tm = await resolveTrueMeta(a.uri, isVideo ? 'video' : 'image', ext, mimeFor(kind, ext));
      ext = tm.ext; sniffMime = tm.mime;
      if (tm.kind === 'video' && !isVideo) { isVideo = true; kind = 'video'; }
      if (tm.kind === 'image' && isVideo) { isVideo = false; kind = 'image'; }
    } catch {}
    const fileSize = (a as any).fileSize as number | undefined;

    // Only enforce size limits on images, not videos
    if (!isVideo && fileSize && fileSize > MEDIA_LIMITS.imageBytes) {
      throw new Error(`Image too large: ${(fileSize / 1024 / 1024).toFixed(0)} MB. Max 10 MB.`);
    }

    let thumbnailUri: string | undefined;
    if (isVideo) {
      try {
        const th = await VideoThumbnails.getThumbnailAsync(a.uri, { time: 0, quality: 0.7 });
        thumbnailUri = th.uri;
      } catch {}
    }

    out.push({
      uri: a.uri,
      kind,
      ext,
      mimeType: sniffMime || mimeFor(kind, ext),
      width: a.width ?? undefined,
      height: a.height ?? undefined,
      fileSize,
      thumbnailUri,
      base64: a.base64 ?? null,
    });
  }
  return out;
}

export async function pickFromCamera(opts?: {
  quality?: number;
  includeBase64?: boolean;
}): Promise<PickedMedia | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Camera permission denied');
  const result = await ImagePicker.launchCameraAsync({
    // Data saver halves upload weight; explicit quality from callers wins.
    quality: opts?.quality ?? (useSettingsStore.getState().uploadQuality === 'data-saver' ? 0.5 : 0.85),
    base64: !!opts?.includeBase64,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const a = result.assets[0];
  let ext = safeExt(a.uri, 'jpg');
  let camMime: string | null = null;
  try { const tm = await resolveTrueMeta(a.uri, 'image', ext, mimeFor('image', ext)); ext = tm.ext; camMime = tm.mime; } catch {}
  return {
    uri: a.uri,
    kind: 'image',
    ext,
    mimeType: camMime || mimeFor('image', ext),
    width: a.width ?? undefined,
    height: a.height ?? undefined,
    fileSize: (a as any).fileSize,
    base64: a.base64 ?? null,
  };
}

export async function uploadMedia(
  bucket: Bucket,
  userId: string,
  media: PickedMedia,
  opts?: { pathPrefix?: string; filename?: string }
): Promise<UploadResult> {
  if (!userId) throw new Error('uploadMedia: userId is required');

  const filename =
    opts?.filename ??
    `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${media.ext}`;
  const path = opts?.pathPrefix
    ? `${opts.pathPrefix}/${userId}/${filename}`
    : `${userId}/${filename}`;

  const token = await getAuthToken();
  const formData = new FormData();
  formData.append('file', {
    uri: media.uri,
    type: media.mimeType,
    name: filename,
  } as any);

  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'x-upsert': 'true',
      },
      body: formData,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = (err as any)?.error || (err as any)?.message || `HTTP ${res.status}`;
    console.log('[mediaService.upload]', bucket, path, res.status, message);
    throw new Error(`Upload failed (${bucket}): ${message}`);
  }

  // Cache-bust. Forces RN Image loader to fetch fresh bytes, avoids blank
  // renders from stale or partial cache entries.
  const url = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}?t=${Date.now()}`;
  return { url, path, kind: media.kind, width: media.width, height: media.height };
}

export async function uploadBatch(
  bucket: Bucket,
  userId: string,
  items: PickedMedia[],
  opts?: { pathPrefix?: string }
): Promise<{
  uploaded: UploadResult[];
  failed: { index: number; error: string }[];
}> {
  const uploaded: UploadResult[] = [];
  const failed: { index: number; error: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    try {
      const r = await uploadMedia(bucket, userId, items[i], opts);
      uploaded.push(r);
    } catch (e: any) {
      failed.push({ index: i, error: e?.message ?? 'Upload failed' });
    }
  }
  return { uploaded, failed };
}

export async function uploadDocument(
  userId: string,
  asset: {
    uri: string;
    name: string;
    mimeType?: string | null;
    size?: number | null;
  }
): Promise<UploadResult & { originalName: string }> {
  if (!userId) throw new Error('uploadDocument: userId is required');
  if (asset.size && asset.size > MEDIA_LIMITS.documentBytes) {
    throw new Error(`File too large: ${(asset.size / 1024 / 1024).toFixed(0)} MB. Max 25 MB.`);
  }

  const safeName = asset.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const path = `${userId}/${Date.now()}_${encodeURIComponent(safeName)}`;
  const token = await getAuthToken();

  const formData = new FormData();
  formData.append('file', {
    uri: asset.uri,
    type: 'application/octet-stream',
    name: asset.name,
  } as any);

  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/chat-files/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'x-upsert': 'true',
      },
      body: formData,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = (err as any)?.error || (err as any)?.message || `HTTP ${res.status}`;
    throw new Error(`Document upload failed: ${message}`);
  }

  return {
    url: `${SUPABASE_URL}/storage/v1/object/public/chat-files/${path}?t=${Date.now()}`,
    path,
    kind: 'document',
    originalName: asset.name,
  };
}

export async function deleteMedia(bucket: Bucket, path: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) console.log('[mediaService.delete]', bucket, path, error.message);
}