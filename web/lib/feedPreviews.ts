'use client';

import { createFeedPreviewCache, type PreviewEnvelope, type PreviewStorage } from './feedPreviewCache';
import { createClient } from './supabase/client';
import { navigationSessionIdentity } from '../../shared/navigationCache';
import { dataSaverEnabled } from './mediaPrefs';

const DATABASE = 'pc-public-previews-v1';
function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let database: IDBDatabase | undefined, settled = false;
    const finish = (error?: unknown, value?: T) => { if (settled) return; settled = true; clearTimeout(timer); database?.close(); if (error) reject(error); else resolve(value as T); };
    const timer = setTimeout(() => finish(Error('Preview storage timed out')), 2000);
    const open = indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('preview'); };
    open.onerror = () => finish(open.error);
    open.onblocked = () => finish(Error('Preview storage unavailable'));
    open.onsuccess = () => {
      database = open.result;
      if (settled) { database.close(); return; }
      try {
        const tx = database.transaction('preview', mode), request = operation(tx.objectStore('preview'));
        tx.oncomplete = () => finish(undefined, request.result);
        tx.onerror = () => finish(tx.error ?? Error('Preview storage failed'));
        tx.onabort = () => finish(tx.error ?? Error('Preview storage aborted'));
      } catch (cause) { finish(cause); }
    };
  });
}
const storage: PreviewStorage = {
  read: async () => (await transaction<PreviewEnvelope | undefined>('readonly', store => store.get('recent'))) ?? null,
  write: async value => { await transaction('readwrite', store => store.put(value, 'recent')); },
  clear: async () => { await transaction('readwrite', store => store.clear()); },
};

async function raster(source: string, parent: AbortSignal) {
  if (dataSaverEnabled() || parent.aborted) return null;
  const controller = new AbortController(), abort = () => controller.abort();
  parent.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 2000);
  let bitmap: ImageBitmap | null = null;
  try {
    const response = await fetch(source, { signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
    if (!response.ok || Number(response.headers.get('content-length')) > 3_000_000) return null;
    const blob = await response.blob(); if (blob.size > 3_000_000 || !blob.type.startsWith('image/')) return null;
    bitmap = await createImageBitmap(blob);
    if (controller.signal.aborted || !bitmap.width || !bitmap.height) return null;
    const canvas = document.createElement('canvas'), scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d'); if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { uri: canvas.toDataURL('image/jpeg', 0.45), width: bitmap.width, height: bitmap.height };
  } catch { return null; }
  finally { clearTimeout(timer); parent.removeEventListener('abort', abort); bitmap?.close(); }
}

let store: ReturnType<typeof createFeedPreviewCache> | null = null;
let initialized: Promise<void> = Promise.resolve();
export function getFeedPreviewStore() {
  if (typeof window === 'undefined' || !window.crypto?.subtle || typeof indexedDB === 'undefined') return null;
  if (store) return store;
  store = createFeedPreviewCache({ storage, crypto: window.crypto, base: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', raster });
  const result = store, client = createClient(); let observed = 0;
  let finish!: () => void;
  initialized = new Promise(resolve => { finish = resolve; });
  const apply = (session: Parameters<typeof navigationSessionIdentity>[0]) => { observed++; void result.setSession(session?.user.id ?? null, navigationSessionIdentity(session)).finally(finish); };
  client.auth.onAuthStateChange((_event, session) => apply(session));
  const initial = observed;
  void client.auth.getSession().then(({ data, error }) => { if (!error && observed === initial) apply(data.session); else if (error) finish(); }).catch(finish);
  return result;
}

export async function loadFeedPreviews(owner: string) {
  const current = getFeedPreviewStore(); if (!current) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = await Promise.race([initialized.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 2500); })]);
  if (timer) clearTimeout(timer);
  if (!ready) return [];
  await current.ready();
  const snapshot = current.getSnapshot();
  return snapshot.owner === owner ? snapshot.previews : [];
}
