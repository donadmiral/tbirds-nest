/**
 * enhancementCacheService.ts
 *
 * Manages temporary files for AI enhancement variations.
 *
 * Owns: temp file creation, cleanup, orphan sweep, disk pressure.
 * Does NOT own: inference, face detection, draft state, UI.
 *
 * Lifecycle:
 *   - Variations downloaded to cache dir after inference
 *   - On apply: unselected variations deleted, selected stays until upload completes
 *   - On discard: all variations deleted
 *   - On unmount: all active session variations deleted
 *   - On app launch: sweep orphaned enhancement files older than 1 hour
 *
 * Cache dir: FileSystem.cacheDirectory + 'enhancements/'
 * File naming: enhancement_{draftId}_{timestamp}_{toneIndex}.jpg
 * Max cache: 50MB (roughly 12 sessions worth)
 */

import * as FileSystem from 'expo-file-system/legacy';

const CACHE_SUBDIR = 'enhancements/';
const MAX_CACHE_AGE_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_BYTES = 50 * 1024 * 1024; // 50MB

function getCacheDir(): string {
  return (FileSystem.cacheDirectory || '') + CACHE_SUBDIR;
}

/**
 * Ensure cache directory exists.
 */
export async function ensureCacheDir(): Promise<void> {
  const dir = getCacheDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

/**
 * Download a variation image from URL to local cache.
 * Returns local URI.
 */
export async function cacheVariation(
  url: string,
  draftId: string,
  toneIndex: number
): Promise<string> {
  await ensureCacheDir();
  const filename = `enhancement_${draftId}_${Date.now()}_${toneIndex}.jpg`;
  const localUri = getCacheDir() + filename;

  const download = await FileSystem.downloadAsync(url, localUri);
  if (download.status !== 200) {
    throw new Error(`Failed to cache variation: HTTP ${download.status}`);
  }

  return download.uri;
}

/**
 * Delete a single cached file.
 */
export async function deleteCachedFile(uri: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch (err) {
    console.warn('[EnhancementCache] Delete failed:', uri, err);
  }
}

/**
 * Delete multiple cached files.
 */
export async function deleteCachedFiles(uris: string[]): Promise<void> {
  await Promise.all(uris.map(uri => deleteCachedFile(uri)));
}

/**
 * Delete all cached files for a specific draft.
 */
export async function cleanDraftCache(draftId: string): Promise<void> {
  try {
    const dir = getCacheDir();
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return;

    const files = await FileSystem.readDirectoryAsync(dir);
    const draftFiles = files.filter(f => f.startsWith(`enhancement_${draftId}_`));
    await Promise.all(
      draftFiles.map(f => FileSystem.deleteAsync(dir + f, { idempotent: true }))
    );
  } catch (err) {
    console.warn('[EnhancementCache] Draft cleanup failed:', draftId, err);
  }
}

/**
 * Sweep orphaned enhancement files older than MAX_CACHE_AGE_MS.
 * Call on app launch.
 */
export async function sweepOrphanedFiles(): Promise<number> {
  let cleaned = 0;
  try {
    const dir = getCacheDir();
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return 0;

    const files = await FileSystem.readDirectoryAsync(dir);
    const now = Date.now();

    for (const file of files) {
      if (!file.startsWith('enhancement_')) continue;

      // Extract timestamp from filename: enhancement_{draftId}_{timestamp}_{index}.jpg
      const parts = file.split('_');
      if (parts.length >= 3) {
        const ts = parseInt(parts[2], 10);
        if (!isNaN(ts) && (now - ts) > MAX_CACHE_AGE_MS) {
          await FileSystem.deleteAsync(dir + file, { idempotent: true });
          cleaned++;
        }
      }
    }
  } catch (err) {
    console.warn('[EnhancementCache] Orphan sweep failed:', err);
  }
  return cleaned;
}

/**
 * Get total cache size in bytes.
 */
export async function getCacheSize(): Promise<number> {
  try {
    const dir = getCacheDir();
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return 0;

    const files = await FileSystem.readDirectoryAsync(dir);
    let total = 0;
    for (const file of files) {
      const fInfo = await FileSystem.getInfoAsync(dir + file);
      if (fInfo.exists && fInfo.size) {
        total += fInfo.size;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Check if cache is approaching limit. If so, evict oldest files.
 */
export async function enforceQuota(): Promise<void> {
  const size = await getCacheSize();
  if (size < MAX_CACHE_BYTES) return;

  try {
    const dir = getCacheDir();
    const files = await FileSystem.readDirectoryAsync(dir);
    const enhFiles = files.filter(f => f.startsWith('enhancement_'));

    // Sort by timestamp (extracted from filename), oldest first
    enhFiles.sort((a, b) => {
      const tsA = parseInt(a.split('_')[2] || '0', 10);
      const tsB = parseInt(b.split('_')[2] || '0', 10);
      return tsA - tsB;
    });

    // Delete oldest until under quota
    let currentSize = size;
    for (const file of enhFiles) {
      if (currentSize < MAX_CACHE_BYTES * 0.7) break; // target 70% capacity
      const fInfo = await FileSystem.getInfoAsync(dir + file);
      if (fInfo.exists && fInfo.size) {
        await FileSystem.deleteAsync(dir + file, { idempotent: true });
        currentSize -= fInfo.size;
      }
    }
  } catch (err) {
    console.warn('[EnhancementCache] Quota enforcement failed:', err);
  }
}
