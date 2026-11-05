/** A bounded cache of original bytes. It never grants access to private content. */
export const OFFLINE_MEDIA_BYTES = 128 * 1024 * 1024;
export const OFFLINE_MEDIA_ITEM_BYTES = 24 * 1024 * 1024;
export const OFFLINE_MEDIA_OPEN_BYTES = 32 * 1024 * 1024;
export const OFFLINE_MEDIA_TTL = 24 * 60 * 60_000;
export function offlineMediaKeyInput(secret: string, objectDigest: string): string {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(secret) || !/^[a-f0-9]{64}$/.test(objectDigest)) throw new Error('Invalid offline media key');
  return JSON.stringify(['pc-offline-file-v1', secret, objectDigest]);
}
export type OfflineCandidate = {
  postId: string; mediaId: string; objectKey: string; sourceVersion: string; kind: 'image' | 'video'; uri: string;
};
type Entry = Omit<OfflineCandidate, 'uri'> & { key: string; bytes: number; savedAt: number; expiresAt: number; extension: string };
export type OfflineFile = Entry & { uri: string };
export type OfflineMediaIO = {
  digest(value: string): Promise<string>;
  readManifest(): Promise<string | null>;
  writeManifest(value: string): Promise<void>;
  readKey(): Promise<string | null>;
  createKey(): Promise<string>;
  reset(): Promise<void>;
  cleanTemporary(): Promise<void>;
  prune(keys: string[]): Promise<void>;
  put(candidate: OfflineCandidate, key: string, secret: string, signal: AbortSignal): Promise<{ bytes: number; extension: string }>;
  open(entry: Entry, secret: string): Promise<string>;
  remove(key: string): Promise<void>;
  removeOpen(key: string): Promise<void>;
};
const validId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const objectKey = (v: unknown): v is string => typeof v === 'string' && v.length <= 1100 && /^(post-media|media)\/[^?#\\]+$/.test(v);
function validEntry(v: any, now: number): boolean {
  return v && validId(v.postId) && validId(v.mediaId) && validId(v.sourceVersion) && objectKey(v.objectKey)
    && /^(image|video)$/.test(v.kind) && /^[a-f0-9]{64}$/.test(v.key)
    && /^(jpg|png|webp|gif|heic|avif|mp4|mov)$/.test(v.extension)
    && Number.isSafeInteger(v.bytes) && v.bytes > 0 && v.bytes <= OFFLINE_MEDIA_ITEM_BYTES
    && Number.isSafeInteger(v.savedAt) && v.savedAt <= now && v.expiresAt > now
    && v.expiresAt === v.savedAt + OFFLINE_MEDIA_TTL;
}
const label = (postId: string, mediaId: string) => `${postId}:${mediaId}`;

export function createOfflineMediaCache(io: OfflineMediaIO, now = Date.now) {
  let scope: string | null | undefined, generation = 0, secret: string | null = null, fingerprint: string | null = null;
  let entries: Entry[] = [], opened = new Map<string, OfflineFile>();
  let pending: Promise<unknown> = Promise.resolve();
  let controller = new AbortController(), foreground = true, authorization = 0;
  let downloads: Promise<void> = Promise.resolve();
  const denied = new Set<string>();
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(fn => { try { fn(); } catch {} });
  const current = (g: number) => g === generation && !!scope && foreground && !controller.signal.aborted;
  const enqueue = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = pending.catch(() => {}).then(work);
    pending = next.catch(() => {});
    return next;
  };
  const manifest = () => JSON.stringify({ version: 1, fingerprint, entries });
  const persist = async () => {
    // Leave room for the secure-store manifest and UTF-8 expansion. Long object
    // names cannot exceed the existing encrypted snapshot adapter's 24 KiB cap.
    while (entries.length && encodeURIComponent(manifest()).replace(/%[A-F\d]{2}/gi, '_').length > 22 * 1024) await forget(entries[0]);
    await io.writeManifest(manifest());
  };
  const forget = async (entry: Entry) => {
    entries = entries.filter(item => item.key !== entry.key);
    opened.delete(label(entry.postId, entry.mediaId));
    await io.remove(entry.key);
  };
  const armExpiry = () => {
    if (expiry) clearTimeout(expiry);
    if (!entries.length) return;
    const g = generation, due = Math.min(...entries.map(entry => entry.expiresAt));
    expiry = setTimeout(() => {
      // Drop rendered references synchronously before scheduling file deletion.
      const expired = entries.filter(entry => !validEntry(entry, now()));
      expired.forEach(entry => opened.delete(label(entry.postId, entry.mediaId)));
      emit();
      void enqueue(async () => {
        if (!current(g)) return;
        for (const entry of expired) await forget(entry);
        await persist(); armExpiry(); emit();
      }).catch(() => {});
    }, Math.max(1, due - now()));
  };
  function setScope(next: string | null): Promise<void> {
    if (next === scope) return pending.then(() => {});
    const cold = scope === undefined, g = ++generation;
    scope = next; secret = null; fingerprint = null; entries = []; opened = new Map(); authorization++; denied.clear();
    controller.abort(); controller = new AbortController();
    if (expiry) clearTimeout(expiry);
    emit();
    return enqueue(async () => {
      if (g !== generation) return;
      await io.cleanTemporary();
      if (!next) { await io.reset(); return; }
      const digest = await io.digest(next);
      let manifest: any = null;
      try { const raw = await io.readManifest(); if (raw && raw.length <= 48_000) manifest = JSON.parse(raw); } catch {}
      let key = cold && manifest?.version === 1 && manifest.fingerprint === digest ? await io.readKey() : null;
      if (!key || !/^[A-Za-z0-9+/]{43}=$/.test(key)) {
        await io.reset(); key = await io.createKey(); manifest = null;
      }
      if (g !== generation || !scope) return;
      fingerprint = digest; secret = key;
      const seen = new Set<string>(); let bytes = 0;
      entries = (Array.isArray(manifest?.entries) ? manifest.entries : []).slice(-40).filter((entry: any) => {
        if (!validEntry(entry, now()) || seen.has(label(entry.postId, entry.mediaId)) || bytes + entry.bytes > OFFLINE_MEDIA_BYTES) return false;
        bytes += entry.bytes; seen.add(label(entry.postId, entry.mediaId)); return true;
      }).map((entry: Entry) => ({ postId: entry.postId, mediaId: entry.mediaId, objectKey: entry.objectKey, sourceVersion: entry.sourceVersion,
        kind: entry.kind, key: entry.key, bytes: entry.bytes, savedAt: entry.savedAt, expiresAt: entry.expiresAt, extension: entry.extension }));
      await io.prune(entries.map(entry => entry.key));
      await persist(); armExpiry(); emit();
    });
  }
  function peek(postId: string, mediaId: string): OfflineFile | null {
    const file = opened.get(label(postId, mediaId));
    return scope && foreground && secret && file && !denied.has(postId) && validEntry(file, now()) ? file : null;
  }
  const opening = new Map<string, Promise<OfflineFile | null>>();
  function open(postId: string, mediaId: string): Promise<OfflineFile | null> {
    const id = label(postId, mediaId), g = generation, allowedAt = authorization;
    const cached = peek(postId, mediaId); if (cached) return Promise.resolve(cached);
    const token = `${g}:${id}`, prior = opening.get(token); if (prior) return prior;
    const work = enqueue(async () => {
      if (!current(g) || !secret || denied.has(postId) || allowedAt !== authorization) return null;
      const entry = entries.find(item => item.postId === postId && item.mediaId === mediaId && validEntry(item, now()));
      if (!entry) return null;
      try {
        const uri = await io.open(entry, secret);
        if (!current(g) || allowedAt !== authorization || denied.has(postId) || !validEntry(entry, now())
          || !entries.some(item => item.key === entry.key && item.sourceVersion === entry.sourceVersion)) { await io.removeOpen(entry.key); return null; }
        while (opened.size >= 8 || [...opened.values()].reduce((sum, item) => sum + item.bytes, 0) + entry.bytes > OFFLINE_MEDIA_OPEN_BYTES) {
          const oldest = opened.entries().next().value!;
          opened.delete(oldest[0]); await io.removeOpen(oldest[1].key);
        }
        const value = { ...entry, uri }; opened.set(id, value);
        // Recent reads become the last entries evicted from the encrypted cache.
        entries = entries.filter(item => item.key !== entry.key).concat(entry);
        await persist(); emit(); return value;
      } catch {
        await forget(entry); await persist(); emit(); return null;
      }
    });
    opening.set(token, work);
    void work.finally(() => opening.delete(token)).catch(() => {});
    return work;
  }
  function save(candidates: OfflineCandidate[], isCurrent = () => true): Promise<void> {
    const g = generation, allowedAt = authorization, signal = controller.signal;
    const allowed = () => current(g) && allowedAt === authorization && !signal.aborted && isCurrent();
    // An authoritative replacement invalidates the old file before its network
    // request, including when the replacement download subsequently fails.
    const replaced = entries.filter(entry => candidates.some(candidate => candidate.postId === entry.postId
      && candidate.mediaId === entry.mediaId && (candidate.objectKey !== entry.objectKey || candidate.sourceVersion !== entry.sourceVersion || candidate.kind !== entry.kind)));
    if (allowed() && replaced.length) {
      const keys = new Set(replaced.map(entry => entry.key));
      entries = entries.filter(entry => !keys.has(entry.key));
      replaced.forEach(entry => opened.delete(label(entry.postId, entry.mediaId))); emit();
      void enqueue(async () => { for (const entry of replaced) await io.remove(entry.key); if (current(g)) await persist(); }).catch(() => {});
    }
    // Network transfer has a separate single-slot queue. Disk reads and visibility
    // revocation never wait behind a batch of full-resolution downloads.
    const work = downloads.catch(() => {}).then(async () => {
      await pending;
      if (!allowed() || !secret) return;
      for (const candidate of candidates.slice(0, 20)) {
        if (!allowed() || !secret) break;
        if (!validId(candidate.postId) || !validId(candidate.mediaId) || !validId(candidate.sourceVersion) || !objectKey(candidate.objectKey)
          || !['image', 'video'].includes(candidate.kind) || !candidate.uri.startsWith('https://') || denied.has(candidate.postId)) continue;
        const existing = entries.find(entry => entry.postId === candidate.postId && entry.mediaId === candidate.mediaId);
        if (existing?.objectKey === candidate.objectKey && existing.sourceVersion === candidate.sourceVersion && validEntry(existing, now())) continue;
        const key = await io.digest(`${fingerprint}:${candidate.postId}:${candidate.mediaId}:${candidate.objectKey}:${candidate.sourceVersion}`);
        try {
          const result = await io.put(candidate, key, secret, signal);
          await enqueue(async () => {
            if (!allowed() || denied.has(candidate.postId)) { await io.remove(key); return; }
            const savedAt = now(), entry: Entry = { postId: candidate.postId, mediaId: candidate.mediaId,
              objectKey: candidate.objectKey, sourceVersion: candidate.sourceVersion, kind: candidate.kind, key, ...result, savedAt, expiresAt: savedAt + OFFLINE_MEDIA_TTL };
            if (!validEntry(entry, now())) { await io.remove(key); return; }
            if (existing && existing.key !== key) await forget(existing);
            entries = entries.filter(item => item.key !== key);
            while (entries.length >= 40 || entries.reduce((sum, item) => sum + item.bytes, 0) + entry.bytes > OFFLINE_MEDIA_BYTES) await forget(entries[0]);
            entries.push(entry); await persist(); armExpiry(); emit();
          });
        } catch { await io.remove(key).catch(() => {}); }
      }
    });
    downloads = work.catch(() => {});
    return work;
  }
  function reconcile(checked: string[], eligible: Set<string>): Promise<void> {
    const g = generation, ids = new Set(checked);
    authorization++; controller.abort(); controller = new AbortController();
    checked.forEach(id => { if (eligible.has(id)) denied.delete(id); else denied.add(id); });
    // Never keep a rendered copy once a fresh authorization response removes it.
    opened.forEach((entry, id) => { if (ids.has(entry.postId) && !eligible.has(entry.postId)) opened.delete(id); });
    emit();
    return enqueue(async () => {
      if (!current(g)) return;
      for (const entry of [...entries]) if (ids.has(entry.postId) && !eligible.has(entry.postId)) await forget(entry);
      await persist(); armExpiry(); emit();
    });
  }
  return { setScope, peek, open, save, reconcile,
    version(postId: string, mediaId: string) {
      const entry = entries.find(item => item.postId === postId && item.mediaId === mediaId);
      return scope && foreground && !denied.has(postId) && entry && validEntry(entry, now()) ? `${generation}:${entry.key}:${entry.savedAt}` : null;
    },
    setForeground(active: boolean) {
      if (foreground === active) return;
      foreground = active; authorization++; controller.abort(); controller = new AbortController();
      opened.clear(); emit();
      if (!active) void enqueue(() => io.cleanTemporary()).catch(() => {});
      else void enqueue(async () => {
        for (const entry of [...entries]) if (!validEntry(entry, now())) await forget(entry);
        if (secret) await persist(); armExpiry(); emit();
      }).catch(() => {});
    },
    ready: () => pending.then(() => {}),
    warm: async (rows: { post_id?: string; media?: { id?: string }[] }[]) => {
      await pending;
      await Promise.all(rows.slice(0, 3).flatMap(row => row.media?.slice(0, 1).map(item => row.post_id && item.id ? open(row.post_id, item.id) : null) ?? []));
    },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
