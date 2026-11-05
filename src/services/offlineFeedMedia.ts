import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';
import { AppState } from 'react-native';
import { secureMediaAvailable, transformMediaFile } from '../../modules/secure-media';
import { createChunkedSnapshotStorage } from './startupSnapshotCore';
import { createOfflineMediaCache, offlineMediaKeyInput, OFFLINE_MEDIA_ITEM_BYTES, type OfflineCandidate } from './offlineMediaCore';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { navigationSessionIdentity } from '../../shared/navigationCache';
import { contentObject, isContentCapability } from '../../shared/contentMedia';
import { SUPABASE_URL } from './supabase';

const root = `${FileSystem.cacheDirectory}pc-offline-v1/`;
const sealed = `${root}sealed/`, plain = `${root}active/`, incoming = `${root}incoming/`;
const keyName = 'pc.offline.media.key.v1', manifestName = 'pc.offline.media.index.v1';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const storage = createChunkedSnapshotStorage({
  getItem: key => SecureStore.getItemAsync(key, options),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, options),
  removeItem: key => SecureStore.deleteItemAsync(key, options),
});
const remove = (uri: string) => FileSystem.deleteAsync(uri, { idempotent: true });
const directories = () => Promise.all([sealed, plain, incoming].map(uri => FileSystem.makeDirectoryAsync(uri, { intermediates: true })));
const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heic', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };
const fileKey = async (secret: string, objectDigest: string) => Buffer.from(await Crypto.digestStringAsync(
  Crypto.CryptoDigestAlgorithm.SHA256, offlineMediaKeyInput(secret, objectDigest)), 'hex').toString('base64');

export const offlineFeedMedia = createOfflineMediaCache({
  digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
  readManifest: () => storage.getItem(manifestName),
  writeManifest: value => storage.setItem(manifestName, value).then(() => {}),
  readKey: () => SecureStore.getItemAsync(keyName, options),
  createKey: async () => {
    const key = Buffer.from(await Crypto.getRandomBytesAsync(32)).toString('base64');
    await SecureStore.setItemAsync(keyName, key, options); return key;
  },
  reset: async () => {
    // Remove the decryption key first. Failed file deletion cannot resurrect an account's bytes.
    await SecureStore.deleteItemAsync(keyName, options);
    await storage.removeItem(manifestName);
    await remove(root); await directories();
  },
  cleanTemporary: async () => { await Promise.all([remove(plain), remove(incoming)]); await directories(); },
  prune: async keys => {
    await directories(); const keep = new Set(keys.map(key => `${key}.bin`));
    for (const name of await FileSystem.readDirectoryAsync(sealed)) if (!keep.has(name)) await remove(sealed + name);
  },
  put: async (candidate, key, secret, signal) => {
    if (!secureMediaAvailable || !FileSystem.cacheDirectory || signal.aborted) throw new Error('Offline media unavailable');
    await directories();
    const destination = incoming + key, output = sealed + key + '.bin';
    let exceeded = false;
    const transfer = FileSystem.createDownloadResumable(candidate.uri, destination, {}, progress => {
      if (progress.totalBytesWritten > OFFLINE_MEDIA_ITEM_BYTES || progress.totalBytesExpectedToWrite > OFFLINE_MEDIA_ITEM_BYTES) {
        exceeded = true; void transfer.cancelAsync().catch(() => {});
      }
    });
    const abort = () => { void transfer.cancelAsync().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 30_000);
    try {
      const result = await transfer.downloadAsync();
      const mime = Object.entries(result?.headers ?? {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1]?.split(';')[0].trim().toLowerCase();
      const extension = mime ? extensions[mime] : undefined;
      const info = await FileSystem.getInfoAsync(destination);
      if (!result || result.status !== 200 || signal.aborted || exceeded || !extension || !mime?.startsWith(candidate.kind + '/')
        || !info.exists || info.isDirectory || info.size <= 0 || info.size > OFFLINE_MEDIA_ITEM_BYTES) throw new Error('Media could not be cached');
      // A distinct key binds authenticated ciphertext to account, media ID,
      // immutable source version and object identity. Swapped files fail GCM.
      await transformMediaFile(destination, output, await fileKey(secret, key), false);
      if (signal.aborted) { await remove(output); throw new Error('Account changed'); }
      return { bytes: info.size, extension };
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort); await remove(destination).catch(() => {});
    }
  },
  open: async (entry, secret) => {
    const output = `${plain}${entry.key}.${entry.extension}`;
    await transformMediaFile(`${sealed}${entry.key}.bin`, output, await fileKey(secret, entry.key), true);
    return output;
  },
  remove: async key => {
    await remove(`${sealed}${key}.bin`);
    for (const name of await FileSystem.readDirectoryAsync(plain).catch(() => [])) if (name.startsWith(key + '.')) await remove(plain + name);
  },
  removeOpen: async key => {
    for (const name of await FileSystem.readDirectoryAsync(plain).catch(() => [])) if (name.startsWith(key + '.')) await remove(plain + name);
  },
});

function syncAccount() {
  const state = useAuthStore.getState();
  if (!state.initialized && !state.session) return;
  void offlineFeedMedia.setScope(navigationSessionIdentity(state.session)).catch(() => {});
}
useAuthStore.subscribe(syncAccount);
syncAccount();
AppState.addEventListener('change', state => {
  offlineFeedMedia.setForeground(state === 'active');
  if (state === 'active') syncAccount();
});

const restricted = (value: any) => !!(value?.view_once || value?.is_view_once || value?.view_limit || value?.is_ephemeral
  || value?.expires_at || value?.deleted_at || value?.is_deleted || value?.revoked_at || value?.is_restricted
  || value?.restricted || value?.is_sensitive || value?.edit?.sensitive || value?.is_paywalled);

/** Admission requires a fresh server snapshot_eligible result. Original URLs
 * are used only for a bounded download and never written into the manifest. */
export async function saveOfflineFeedMedia(account: string, rows: any[], eligible: Set<string>, current: () => boolean) {
  if (!secureMediaAvailable || useAuthStore.getState().session?.user.id !== account) return;
  const cacheEligible = new Set<string>(rows.filter(row => eligible.has(row.post_id) && !restricted(row)
    && !(row.media ?? []).some(restricted)).map(row => row.post_id));
  await offlineFeedMedia.reconcile(rows.map(row => row.post_id), cacheEligible);
  if (useSettingsStore.getState().uploadQuality === 'data-saver') return;
  const candidates: OfflineCandidate[] = [];
  for (const row of rows.slice(0, 20)) {
    if (!cacheEligible.has(row.post_id)) continue;
    for (const item of (row.media ?? []).slice(0, 10)) {
      if (restricted(item) || !['image', 'video'].includes(item.media_type) || !isContentCapability(item.url, SUPABASE_URL)) continue;
      if (item.media_type === 'video' && !useSettingsStore.getState().autoplayVideos) continue;
      const object = contentObject(item.url, SUPABASE_URL);
      if (!object || !['post-media', 'media'].includes(object.bucket)) continue;
      const sourceVersion = item._sourceVersion || row._mediaVersions?.[object.key];
      if (typeof sourceVersion !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(sourceVersion)) continue;
      candidates.push({ postId: row.post_id, mediaId: item.id, objectKey: object.key, sourceVersion, kind: item.media_type, uri: item.url });
    }
  }
  await offlineFeedMedia.save(candidates, () => current() && useAuthStore.getState().session?.user.id === account);
}
