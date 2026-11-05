'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { getOfflineMediaStore } from './offlineMedia';
import { getNavigationStore } from './navigationCache';
import { previewObject } from './feedPreviewCache';
import type { OfflineMediaAsset } from './offlineMediaCache';

type Media = { id: string; url: string; media_type: string | null; is_sensitive?: boolean | null; edit?: object | null; _startupPreview?: boolean; _startupPlaceholder?: boolean; _previewObject?: string; _offlineOriginal?: boolean; _sourceVersion?: string };
const EMPTY = { owner: null as string | null, revision: 0 }, empty = () => EMPTY, noop = () => () => {};
/** One mounted media surface decrypts one original. Object URLs are never persisted. */
export function useOfflineMedia<T extends Media>(postId: string, media: T | undefined | null): T | undefined | null {
  const store = getOfflineMediaStore(), navigation = getNavigationStore();
  const snapshot = useSyncExternalStore(store?.subscribe ?? noop, store?.getSnapshot ?? empty, empty);
  const auth = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getServerSnapshot);
  const [local, setLocal] = useState<{ asset: OfflineMediaAsset; uri: string; owner: string; version: string } | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine); update();
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const object = media?._startupPreview ? media._previewObject : media ? previewObject(media.url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '') : null;
  const sourceVersion = media?._sourceVersion;
  const restricted = !!media?.is_sensitive || !!(media?.edit as { sensitive?: boolean } | null)?.sensitive;
  const enabled = !!media && !restricted && !!auth.owner && auth.owner === snapshot.owner && (!!object || !!media._startupPreview) && !!sourceVersion
    && (media.media_type !== 'video' || offline || media._startupPreview === true
      || (local?.asset.postId === postId && local.asset.mediaId === media.id && local.asset.object === object));
  const version = media && enabled ? store?.version(postId, media.id, object, sourceVersion) ?? null : null;
  useEffect(() => {
    if (!version || !enabled || !store || !media || !auth.owner) return;
    let live = true, uri: string | null = null, timer: ReturnType<typeof setTimeout> | undefined;
    void store.read(postId, media.id, object, sourceVersion).then(asset => {
      if (!live || !asset) return;
      uri = URL.createObjectURL(asset.blob);
      setLocal({ asset, uri, owner: auth.owner!, version });
      timer = setTimeout(() => { if (uri) URL.revokeObjectURL(uri); uri = null; setLocal(null); }, Math.max(0, asset.expiresAt - Date.now()));
    });
    return () => { live = false; if (timer) clearTimeout(timer); if (uri) URL.revokeObjectURL(uri); };
  }, [enabled, store, postId, media?.id, auth.owner, version]);
  if (!enabled || !media || !local || local.owner !== auth.owner || local.version !== version || local.asset.postId !== postId
    || local.asset.mediaId !== media.id || (object && local.asset.object !== object) || local.asset.expiresAt <= Date.now()) return media;
  return { ...media, url: local.uri, media_type: local.asset.mediaType, _startupPreview: false, _startupPlaceholder: false, _offlineOriginal: true, _sourceVersion: local.asset.sourceVersion, _previewObject: local.asset.object };
}
