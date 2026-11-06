'use client';

import { createClient } from './supabase/client';
import { navigationSessionIdentity } from '../../shared/navigationCache';
import { dataSaverEnabled } from './mediaPrefs';
import { createOfflineMediaCache, OFFLINE_MEDIA_ITEM_LIMIT, type OfflineMediaIndex, type OfflineMediaRecord, type OfflineMediaSession, type OfflineMediaStorage } from './offlineMediaCache';

const DATABASE = 'pc-public-originals-v1';
function transaction<T>(names: string[], mode: IDBTransactionMode, operation: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return new Promise((resolve, reject) => {
    let database: IDBDatabase | undefined, tx: IDBTransaction | undefined, settled = false;
    const finish = (error?: unknown, value?: T) => { if (settled) return; settled = true; clearTimeout(timer); database?.close(); if (error) reject(error); else resolve(value as T); };
    const timer = setTimeout(() => { tx?.abort(); finish(Error('Offline media storage timed out')); }, 5000);
    const open = indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => { for (const name of ['session', 'index', 'media']) open.result.createObjectStore(name); };
    open.onerror = () => finish(open.error); open.onblocked = () => finish(Error('Offline media storage unavailable'));
    open.onsuccess = () => {
      database = open.result; if (settled) { database.close(); return; }
      try {
        tx = database.transaction(names, mode); const request = operation(tx);
        tx.oncomplete = () => finish(undefined, request?.result);
        tx.onerror = () => finish(tx?.error ?? Error('Offline media storage failed'));
        tx.onabort = () => finish(tx?.error ?? Error('Offline media storage aborted'));
      } catch (cause) { finish(cause); }
    };
  });
}
const storage: OfflineMediaStorage = {
  session: async () => (await transaction<OfflineMediaSession | undefined>(['session'], 'readonly', tx => tx.objectStore('session').get('current'))) ?? null,
  indexes: () => transaction<OfflineMediaIndex[]>(['index'], 'readonly', tx => tx.objectStore('index').getAll()),
  start: value => transaction(['session', 'index', 'media'], 'readwrite', tx => { for (const name of ['session', 'index', 'media']) tx.objectStore(name).clear(); tx.objectStore('session').put(value, 'current'); }),
  read: async id => (await transaction<OfflineMediaRecord | undefined>(['media'], 'readonly', tx => tx.objectStore('media').get(id))) ?? null,
  write: value => transaction(['index', 'media'], 'readwrite', tx => { const { encrypted: _encrypted, iv: _iv, ...index } = value; tx.objectStore('index').put(index, value.id); tx.objectStore('media').put(value, value.id); }),
  remove: ids => transaction(['index', 'media'], 'readwrite', tx => { for (const id of ids) { tx.objectStore('index').delete(id); tx.objectStore('media').delete(id); } }),
  clear: () => transaction(['session', 'index', 'media'], 'readwrite', tx => { for (const name of ['session', 'index', 'media']) tx.objectStore(name).clear(); }),
};

export async function downloadOfflineOriginal(source: string, kind: 'image' | 'video', parent: AbortSignal): Promise<Blob | null> {
  if (dataSaverEnabled() || parent.aborted || (typeof navigator !== 'undefined' && !navigator.onLine)) return null;
  const controller = new AbortController(), abort = () => controller.abort();
  parent.addEventListener('abort', abort, { once: true }); const timer = setTimeout(abort, 15_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(source, { signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (!response.ok || !mime.startsWith(`${kind}/`) || Number(response.headers.get('content-length')) > OFFLINE_MEDIA_ITEM_LIMIT) { await response.body?.cancel(); return null; }
    if (!response.body) return null;
    reader = response.body.getReader(); const chunks: ArrayBuffer[] = []; let size = 0;
    while (!controller.signal.aborted) {
      const { done, value } = await reader.read(); if (done) return size ? new Blob(chunks, { type: mime }) : null;
      size += value.byteLength;
      if (size > OFFLINE_MEDIA_ITEM_LIMIT) { await reader.cancel(); return null; }
      // Copy the exact view so pooled/offset buffers never add unrelated bytes.
      chunks.push(new Uint8Array(value).buffer);
    }
    return null;
  } catch { return null; }
  finally { if (controller.signal.aborted) void reader?.cancel().catch(() => {}); clearTimeout(timer); parent.removeEventListener('abort', abort); }
}

let store: ReturnType<typeof createOfflineMediaCache> | null = null;
export function getOfflineMediaStore() {
  if (typeof window === 'undefined' || !window.crypto?.subtle || typeof indexedDB === 'undefined') return null;
  if (store) return store;
  store = createOfflineMediaCache({ storage, crypto: window.crypto, base: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', download: downloadOfflineOriginal });
  const result = store, client = createClient(); let observed = 0;
  let finish!: () => void;
  const initialized = new Promise<void>(resolve => { finish = resolve; });
  const write = result.write;
  result.write = async (...args) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([initialized, new Promise<void>(resolve => { timer = setTimeout(resolve, 2500); })]);
    if (timer) clearTimeout(timer);
    return write(...args);
  };
  const apply = (session: Parameters<typeof navigationSessionIdentity>[0]) => { observed++; void result.setSession(session?.user.id ?? null, navigationSessionIdentity(session)).finally(finish); };
  client.auth.onAuthStateChange((_event, session) => apply(session)); const initial = observed;
  void client.auth.getSession().then(({ data, error }) => { if (!error && observed === initial) apply(data.session); else if (error) finish(); }).catch(finish);
  return result;
}
