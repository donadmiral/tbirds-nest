import { previewObject } from './feedPreviewCache';

export const OFFLINE_MEDIA_TTL = 24 * 60 * 60_000;
export const OFFLINE_MEDIA_BUDGET = 128 * 1024 * 1024;
export const OFFLINE_MEDIA_ITEM_LIMIT = 32 * 1024 * 1024;
export const OFFLINE_MEDIA_COUNT = 24;
export type OfflineMediaIndex = { id: string; identity: string; postId: string; mediaId: string; object: string; sourceVersion: string; mediaType: 'image' | 'video'; mime: string; width: number; height: number; bytes: number; savedAt: number; expiresAt: number };
export type OfflineMediaRecord = OfflineMediaIndex & { iv: Uint8Array; encrypted: ArrayBuffer };
export type OfflineMediaSession = { version: 1; identity: string; key: CryptoKey };
export type OfflineMediaStorage = {
  session(): Promise<OfflineMediaSession | null>; indexes(): Promise<OfflineMediaIndex[]>;
  start(value: OfflineMediaSession): Promise<void>; read(id: string): Promise<OfflineMediaRecord | null>;
  write(value: OfflineMediaRecord): Promise<void>; remove(ids: string[]): Promise<void>; clear(): Promise<void>;
};
type Media = { id: string; url: string; media_type?: string | null; width?: number | null; height?: number | null; [key: string]: unknown };
type Row = { post_id: string; media?: Media[]; [key: string]: unknown };
export type OfflineMediaAsset = OfflineMediaIndex & { blob: Blob };
const restricted = (row: Record<string, unknown>) => !!(row.is_sensitive || row.is_ephemeral || row.view_once || row.is_view_once || row.view_limit || row.expires_at || row.deleted_at || row.is_deleted || row.revoked_at || row.is_restricted || row.restricted || row.is_paywalled || (row.edit as { sensitive?: boolean } | null)?.sensitive);
const mimeAllowed = (mime: string, kind: string) => kind === 'image' ? /^image\/(jpeg|png|webp|avif|gif)$/.test(mime) : /^video\/(mp4|webm|quicktime)$/.test(mime);
const dimensions = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100_000 ? n : 0;
const aad = (item: OfflineMediaIndex) => new TextEncoder().encode(JSON.stringify([item.id, item.identity, item.postId, item.mediaId, item.object, item.sourceVersion, item.mediaType, item.mime, item.width, item.height, item.bytes, item.savedAt, item.expiresAt]));
const EMPTY = { owner: null as string | null, revision: 0 };

/** Original bytes are encrypted separately so launching never reads/decrypts the entire disk budget. */
export function createOfflineMediaCache(options: {
  storage: OfflineMediaStorage; crypto: Crypto; base: string; now?: () => number;
  download(source: string, kind: 'image' | 'video', signal: AbortSignal): Promise<Blob | null>;
}) {
  const now = options.now ?? Date.now;
  let owner: string | null = null, identity: string | null = null, session: OfflineMediaSession | null = null;
  let generation = 0, initialized = false, ready: Promise<void> = Promise.resolve(), writes: Promise<unknown> = Promise.resolve();
  let indexes: OfflineMediaIndex[] = [], snapshot = EMPTY, run: AbortController | null = null;
  const listeners = new Set<() => void>(), reads = new Map<string, Promise<OfflineMediaAsset | null>>();
  const publish = () => { snapshot = { owner, revision: snapshot.revision + 1 }; listeners.forEach(fn => fn()); };
  const enqueue = (action: () => Promise<unknown>) => { writes = writes.catch(() => {}).then(action); return writes; };
  const current = (token: number) => generation === token && !!owner && !!identity;
  const hash = async (value: string) => Array.from(new Uint8Array(await options.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
  const validIndex = (item: OfflineMediaIndex, expected: string) => item?.identity === expected && typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.id)
    && typeof item.postId === 'string' && item.postId.length <= 80 && typeof item.mediaId === 'string' && item.mediaId.length <= 80
    && typeof item.object === 'string' && /^post-media\/[^?\x00-\x1f]{1,1100}$/.test(item.object)
    && typeof item.sourceVersion === 'string' && item.sourceVersion.length > 0 && item.sourceVersion.length <= 128
    && ['image', 'video'].includes(item.mediaType) && mimeAllowed(item.mime, item.mediaType)
    && Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= OFFLINE_MEDIA_ITEM_LIMIT
    && dimensions(item.width) === item.width && dimensions(item.height) === item.height
    && Number.isFinite(item.savedAt) && item.savedAt <= now() && item.expiresAt === item.savedAt + OFFLINE_MEDIA_TTL && item.expiresAt > now();
  const clear = async () => {
    generation++; run?.abort(); indexes = []; reads.clear(); publish();
    const keep = session, previousOwner = owner, previousIdentity = identity;
    await enqueue(() => keep ? options.storage.start(keep) : options.storage.clear()).catch(() => {});
    if (!keep && owner && identity && owner === previousOwner && identity === previousIdentity) { initialized = false; await setSession(owner, identity); }
  };
  const setSession = (nextOwner: string | null, nextIdentity: string | null) => {
    if (initialized && owner === nextOwner && identity === nextIdentity) return ready;
    const first = !initialized; initialized = true; owner = nextOwner; identity = nextIdentity;
    const token = ++generation; run?.abort(); session = null; indexes = []; reads.clear(); publish();
    ready = (async () => {
      try {
        await writes;
        if (!current(token)) { if (!nextOwner || !nextIdentity) await enqueue(() => options.storage.clear()); return; }
        const expected = await hash(nextIdentity!); if (!current(token)) return;
        const previous = first ? await options.storage.session() : null;
        if (!current(token)) return;
        if (previous?.version === 1 && previous.identity === expected && previous.key?.extractable === false && previous.key.algorithm.name === 'AES-GCM') {
          const stored = await options.storage.indexes(); if (!current(token)) return;
          let budget = 0;
          indexes = stored.filter(item => validIndex(item, expected)).sort((a, b) => b.savedAt - a.savedAt).filter((item, index) => index < OFFLINE_MEDIA_COUNT && (budget += item.bytes) <= OFFLINE_MEDIA_BUDGET);
          const keep = new Set(indexes.map(item => item.id));
          await enqueue(() => options.storage.remove(stored.filter(item => !keep.has(item.id)).map(item => item.id)));
          if (!current(token)) return;
          session = previous; publish(); return;
        }
        const key = await options.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        if (!current(token)) return;
        const value: OfflineMediaSession = { version: 1, identity: expected, key };
        await enqueue(async () => { if (current(token)) await options.storage.start(value); });
        if (current(token)) session = value;
      } catch { if (current(token)) { indexes = []; session = null; await enqueue(() => options.storage.clear()).catch(() => {}); } }
    })();
    return ready;
  };
  const read = async (postId: string, mediaId: string, object?: string | null, sourceVersion?: string | null): Promise<OfflineMediaAsset | null> => {
    const token = generation; await ready;
    if (!current(token) || !session) return null;
    const item = indexes.find(value => value.postId === postId && value.mediaId === mediaId && (!object || value.object === object) && (!sourceVersion || value.sourceVersion === sourceVersion) && validIndex(value, session!.identity));
    if (!item) return null;
    const pending = reads.get(item.id); if (pending) return pending;
    const task = (async () => {
      try {
        await writes; if (!current(token) || !session) return null;
        const record = await options.storage.read(item.id);
        if (!record || !current(token) || !session || !validIndex(record, session.identity) || record.encrypted?.byteLength !== record.bytes + 16 || record.iv?.byteLength !== 12) return null;
        if (new TextDecoder().decode(aad(record)) !== new TextDecoder().decode(aad(item))) return null;
        const bytes = await options.crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(record.iv), additionalData: aad(item) }, session.key, record.encrypted);
        if (!current(token) || !indexes.some(value => value.id === item.id) || item.expiresAt <= now()) return null;
        return { ...item, blob: new Blob([bytes], { type: item.mime }) };
      } catch { return null; }
      finally { reads.delete(item.id); }
    })();
    reads.set(item.id, task); return task;
  };
  const write = async (account: string, rows: Row[], eligible: Set<string>) => {
    const token = generation; await ready;
    if (!current(token) || owner !== account || !session) return;
    run?.abort(); const controller = run = new AbortController();
    const permitted = (row: Row) => eligible.has(row.post_id) && !restricted(row) && !row.media?.some(restricted);
    const denied = new Set(rows.filter(row => !permitted(row)).map(row => row.post_id));
    const freshRows = new Map(rows.map(row => [row.post_id, row]));
    const expired = indexes.filter(item => {
      const fresh = freshRows.get(item.postId);
      return denied.has(item.postId) || item.expiresAt <= now() || (!!fresh && !fresh.media?.some(media => media.id === item.mediaId && previewObject(media.url, options.base) === item.object && (fresh._mediaVersions as Record<string, string> | undefined)?.[item.object] === item.sourceVersion));
    });
    if (expired.length) {
      const removed = new Set(expired.map(item => item.id)); indexes = indexes.filter(item => !removed.has(item.id)); publish();
      await enqueue(() => options.storage.remove([...removed])).catch(() => {});
    }
    let attempts = 0;
    for (const row of rows.slice(0, 20)) {
      if (!permitted(row) || typeof row.post_id !== 'string' || row.post_id.length > 80) continue;
      for (const media of (row.media ?? []).slice(0, 10)) {
        if (!current(token) || controller.signal.aborted || !session || attempts >= 6) return;
        if (typeof media.id !== 'string' || media.id.length > 80 || !['image', 'video'].includes(media.media_type ?? '') || restricted(media)) continue;
        const object = previewObject(media.url, options.base); if (!object) continue;
        const sourceVersion = (row._mediaVersions as Record<string, string> | undefined)?.[object];
        if (typeof sourceVersion !== 'string' || !sourceVersion || sourceVersion.length > 128) continue;
        if (indexes.some(item => item.postId === row.post_id && item.mediaId === media.id && item.object === object && item.sourceVersion === sourceVersion && item.expiresAt > now())) continue;
        attempts++;
        try {
          const blob = await options.download(media.url, media.media_type as 'image' | 'video', controller.signal);
          if (!current(token) || controller.signal.aborted || !session) return;
          if (!blob || !blob.size || blob.size > OFFLINE_MEDIA_ITEM_LIMIT || !mimeAllowed(blob.type, media.media_type!)) continue;
          const savedAt = now(), id = await hash(`${session.identity}\n${row.post_id}\n${media.id}\n${object}\n${sourceVersion}`);
          const item: OfflineMediaIndex = { id, identity: session.identity, postId: row.post_id, mediaId: media.id, object, sourceVersion,
            mediaType: media.media_type as 'image' | 'video', mime: blob.type, width: dimensions(media.width), height: dimensions(media.height),
            bytes: blob.size, savedAt, expiresAt: savedAt + OFFLINE_MEDIA_TTL };
          const iv = options.crypto.getRandomValues(new Uint8Array(12));
          const encrypted = await options.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(item) }, session.key, await blob.arrayBuffer());
          if (!current(token) || controller.signal.aborted) return;
          await enqueue(async () => {
            if (!current(token) || controller.signal.aborted) return;
            let bytes = item.bytes;
            const keep = indexes.filter(old => old.id !== item.id && old.expiresAt > now()).sort((a, b) => b.savedAt - a.savedAt)
              .filter((old, index) => index < OFFLINE_MEDIA_COUNT - 1 && (bytes += old.bytes) <= OFFLINE_MEDIA_BUDGET);
            const retained = new Set(keep.map(old => old.id)), removed = indexes.filter(old => !retained.has(old.id)).map(old => old.id);
            await options.storage.remove(removed);
            // Storage quota failure leaves current media usable and never holds the visible feed open.
            await options.storage.write({ ...item, iv, encrypted });
            if (current(token) && !controller.signal.aborted) { indexes = [item, ...keep]; publish(); }
          });
        } catch { /* Optional prefetch is best effort, including quota and network failures. */ }
      }
    }
  };
  const version = (postId: string, mediaId: string, object?: string | null, sourceVersion?: string | null) => {
    const item = session && indexes.find(value => value.postId === postId && value.mediaId === mediaId && (!object || value.object === object) && (!sourceVersion || value.sourceVersion === sourceVersion) && validIndex(value, session!.identity));
    return item ? `${item.id}:${item.savedAt}:${item.expiresAt}` : null;
  };
  return { setSession, ready: () => ready, clear, read, write, version, getSnapshot: () => snapshot, getServerSnapshot: () => EMPTY,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
}
