/** Small launch snapshots, never a source of authorization or credential storage. */
export type SnapshotStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
};
export type SnapshotOptions<T> = {
  version: number; ttlMs: number; maxBytes: number;
  storage: 'secure' | 'public'; sanitize: (value: unknown) => T | null;
  expiresAt?: (value: T) => number;
};
export type StartupSnapshot<T> = {
  peek(owner: string): T | null;
  hydrate(owner: string, signal?: AbortSignal): Promise<T | null>;
  write(owner: string, value: unknown): Promise<void>;
  clear(owner: string): Promise<void>;
  subscribe(listener: () => void): () => void;
};
const OWNER_KEY = 'pc.startup.owner.v1';
const MAX_BYTES = 24 * 1024;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const keyFor = (owner: string, id: string) => `pc.startup.v1.${owner}.${id}`;

export function snapshotBytes(value: string): number {
  let bytes = 0;
  for (const point of value) {
    const code = point.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function abortable<T>(work: Promise<T | null>, signal?: AbortSignal): Promise<T | null> {
  if (!signal) return work;
  if (signal.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    const abort = () => { signal.removeEventListener('abort', abort); resolve(null); };
    signal.addEventListener('abort', abort, { once: true });
    work.then(value => { signal.removeEventListener('abort', abort); resolve(signal.aborted ? null : value); }, abort);
  });
}

export function createStartupSnapshotRegistry(storages: {
  secure: SnapshotStorage; public: SnapshotStorage; metadata: SnapshotStorage;
}, now = Date.now) {
  type Registered = { id: string; storage: 'secure' | 'public'; reset: () => void; hydrate: (owner: string) => Promise<unknown> };
  const stores = new Map<string, Registered>();
  let owner: string | null | undefined, scope: string | null = null, generation = 0;
  let mutations: Promise<unknown> = Promise.resolve();
  const enqueue = (action: () => Promise<unknown>): Promise<void> => {
    mutations = mutations.catch(() => {}).then(action).catch(() => {});
    return mutations.then(() => {});
  };
  const current = (account: string, token: number) => account === owner && token === generation;
  const remove = (account: string, id: string, storage: 'secure' | 'public') => storages[storage].removeItem(keyFor(account, id));

  function setAccount(next: string | null, nextScope: string | null = next): Promise<void> {
    if (next !== null && !validId(next)) return Promise.resolve();
    if (next === owner && nextScope === scope) return mutations.then(() => {});
    const previous = owner;
    owner = next; scope = nextScope; generation++;
    stores.forEach(store => store.reset());
    return enqueue(async () => {
      let saved: { owner?: unknown; stores?: unknown; invalidated?: boolean } | null = null;
      try { saved = JSON.parse(await storages.metadata.getItem(OWNER_KEY) || 'null'); } catch { /* No usable prior manifest. */ }
      const old = validId(saved?.owner) ? saved.owner : previous;
      // On a cold same-account launch retain disk data. On a live session
      // boundary, including A→B→A, purge the previous generation before reads.
      if (old && (old !== next || previous !== undefined || saved?.invalidated === true)) {
        const known = new Map([...stores.values()].map(store => [store.id, store.storage]));
        if (Array.isArray(saved?.stores)) for (const row of saved.stores.slice(0, 16)) {
          if (validId(row?.id) && (row.storage === 'secure' || row.storage === 'public')) known.set(row.id, row.storage);
        }
        // A failed secure delete must not make a later cold launch consider
        // this generation valid again. The next launch retries its purge.
        await storages.metadata.setItem(OWNER_KEY, JSON.stringify({ owner: old, invalidated: true,
          stores: [...known].map(([id, storage]) => ({ id, storage })) }));
        await Promise.all([...known].map(([id, storage]) => remove(old, id, storage)));
      }
      if (next) await storages.metadata.setItem(OWNER_KEY, JSON.stringify({ owner: next,
        stores: [...stores.values()].map(({ id, storage }) => ({ id, storage })) }));
      else await storages.metadata.removeItem(OWNER_KEY);
    });
  }

  function create<T>(id: string, options: SnapshotOptions<T>): StartupSnapshot<T> {
    if (!validId(id) || stores.has(id) || stores.size >= 16 || !Number.isInteger(options.version)
      || options.version < 1 || !Number.isFinite(options.ttlMs) || options.ttlMs < 1 || options.ttlMs > 86400000
      || !Number.isFinite(options.maxBytes) || options.maxBytes < 256 || options.maxBytes > MAX_BYTES) throw new Error('Invalid startup snapshot policy.');
    const storage = storages[options.storage], listeners = new Set<() => void>();
    let value: T | null = null, expiresAt = 0, savedTime = 0, revision = 0, loaded = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let pending: Promise<T | null> | null = null;
    const publish = () => listeners.forEach(listener => { try { listener(); } catch { /* Observers cannot fail cache work. */ } });
    const reset = () => { if (expiry !== undefined) clearTimeout(expiry); revision++; value = null; expiresAt = 0; loaded = false; pending = null; publish(); };
    const peek = (account: string) => account === owner && now() >= savedTime && now() < expiresAt ? value : null;
    const expire = () => {
      if (expiry !== undefined) clearTimeout(expiry);
      expiry = setTimeout(() => { value = null; expiresAt = 0; publish(); }, Math.max(0, expiresAt - now()));
    };
    const sanitize = (input: unknown) => { try { return options.sanitize(input); } catch { return null; } };
    const expiryFor = (savedAt: number, parsed: T) => {
      try {
        const sourceExpiry = options.expiresAt?.(parsed);
        return sourceExpiry === undefined ? savedAt + options.ttlMs
          : Number.isFinite(sourceExpiry) ? Math.min(savedAt + options.ttlMs, sourceExpiry) : 0;
      } catch { return 0; }
    };
    const clear = (account: string) => {
      if (!validId(account)) return Promise.resolve();
      if (owner === account) reset();
      return enqueue(() => remove(account, id, options.storage));
    };
    const hydrate = (account: string, signal?: AbortSignal): Promise<T | null> => {
      if (owner !== account || signal?.aborted) return Promise.resolve(null);
      if (loaded) return Promise.resolve(peek(account));
      if (!pending) {
        const token = generation, version = revision;
        const valid = () => current(account, token) && revision === version;
        const work = (async () => {
          try {
            await mutations;
            if (!valid()) return null;
            const raw = await storage.getItem(keyFor(account, id));
            if (!valid()) return null;
            loaded = true;
            if (!raw || snapshotBytes(raw) > options.maxBytes) return null;
            const saved = JSON.parse(raw);
            if (saved?.schema !== 1 || saved.version !== options.version || saved.owner !== account
              || !Number.isSafeInteger(saved.savedAt) || saved.savedAt > now()
              || now() - saved.savedAt >= options.ttlMs) return null;
            const parsed = sanitize(saved.value);
            if (parsed === null || !valid()) return null;
            const until = expiryFor(saved.savedAt, parsed);
            if (until <= now() || until <= saved.savedAt) return null;
            value = parsed; savedTime = saved.savedAt; expiresAt = until; expire(); publish();
            return value;
          } catch { return null; }
        })();
        pending = work;
        void work.finally(() => { if (pending === work) pending = null; });
      }
      return abortable(pending, signal);
    };
    const write = (account: string, input: unknown): Promise<void> => {
      if (owner !== account) return Promise.resolve();
      const selected = sanitize(input), savedAt = now(), token = generation;
      let raw: string;
      try { raw = JSON.stringify({ schema: 1, version: options.version, owner: account, savedAt, value: selected }); }
      catch { return Promise.resolve(); }
      if (selected === null || snapshotBytes(raw) > options.maxBytes) return clear(account);
      const until = expiryFor(savedAt, selected);
      if (until <= savedAt) return clear(account);
      revision++; value = selected; savedTime = savedAt; expiresAt = until; loaded = true; pending = null; expire(); publish();
      return enqueue(async () => { if (current(account, token)) await storage.setItem(keyFor(account, id), raw); });
    };
    const store = { peek, hydrate, write, clear, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
    stores.set(id, { id, storage: options.storage, reset, hydrate });
    return store;
  }
  return { create, setAccount, revision: () => generation,
    hydrate: (account: string) => Promise.all([...stores.values()].map(store => store.hydrate(account))) };
}

/** Two bounded slots keep a failed or interrupted secure write from publishing
 * partial data. All values sent to SecureStore stay below its 2048-byte limit. */
export function createChunkedSnapshotStorage(storage: SnapshotStorage): SnapshotStorage {
  const chunkBytes = 1800, maxChunks = Math.ceil(MAX_BYTES / chunkBytes);
  type Manifest = { slot: number; count: number };
  const manifest = (raw: string | null): Manifest | null => {
    try { const row = JSON.parse(raw || 'null'); return row?.version === 1 && [0, 1].includes(row.slot)
      && Number.isInteger(row.count) && row.count >= 1 && row.count <= maxChunks ? row : null; } catch { return null; }
  };
  const part = (key: string, slot: number, n: number) => `${key}.${slot}.${n}`;
  const clearSlot = async (key: string, slot: number) => {
    for (let n = 0; n < maxChunks; n += 4) await Promise.all(Array.from({ length: Math.min(4, maxChunks - n) },
      (_, offset) => storage.removeItem(part(key, slot, n + offset))));
  };
  return {
    async getItem(key) {
      const saved = manifest(await storage.getItem(key));
      if (!saved) return null;
      const rows: (string | null)[] = [];
      for (let n = 0; n < saved.count; n += 4) rows.push(...await Promise.all(Array.from({ length: Math.min(4, saved.count - n) },
        (_, offset) => storage.getItem(part(key, saved.slot, n + offset)))));
      if (rows.some(row => row === null || snapshotBytes(row) > chunkBytes)) return null;
      const value = rows.join('');
      return snapshotBytes(value) <= MAX_BYTES ? value : null;
    },
    async setItem(key, value) {
      if (snapshotBytes(value) > MAX_BYTES) throw new Error('Startup snapshot exceeds its budget.');
      const old = manifest(await storage.getItem(key)), slot = old?.slot === 0 ? 1 : 0;
      const chunks: string[] = []; let chunk = '', bytes = 0;
      for (const point of value) { const size = snapshotBytes(point);
        if (bytes + size > chunkBytes) { chunks.push(chunk); chunk = ''; bytes = 0; }
        chunk += point; bytes += size;
      }
      chunks.push(chunk);
      for (let n = 0; n < chunks.length; n += 4) await Promise.all(chunks.slice(n, n + 4).map((row, offset) => storage.setItem(part(key, slot, n + offset), row)));
      await storage.setItem(key, JSON.stringify({ version: 1, slot, count: chunks.length }));
      await clearSlot(key, slot === 0 ? 1 : 0);
    },
    async removeItem(key) { await storage.removeItem(key); await clearSlot(key, 0); await clearSlot(key, 1); },
  };
}
