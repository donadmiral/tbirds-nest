type Entry<T> = {
  key: string;
  scope: string;
  generation: number;
  promise: Promise<T>;
  deadline?: ReturnType<typeof setTimeout>;
  controller?: AbortController;
  resolve(value: T): void;
  reject(error: unknown): void;
};

export class StaleBatchReadError extends Error {
  constructor() { super('The reading session changed.'); this.name = 'StaleBatchReadError'; }
}

/**
 * Combine nearby authorized reads without retaining viewer data after delivery.
 * Each key has one in-flight request. Both queued work and transport concurrency
 * are bounded, and an account change rejects old callers before aborting I/O.
 */
export function createKeyedBatchReader<T>(
  fetchBatch: (keys: string[], signal: AbortSignal) => Promise<Map<string, T>>,
  options: { batchSize?: number; concurrency?: number; maxPending?: number; delayMs?: number; timeoutMs?: number } = {},
) {
  const batchSize = options.batchSize ?? 40;
  const concurrency = options.concurrency ?? 2;
  const maxPending = options.maxPending ?? 512;
  const delayMs = options.delayMs ?? 16;
  const timeoutMs = options.timeoutMs ?? 12_000;
  if (![batchSize, concurrency, maxPending, timeoutMs].every(value => Number.isSafeInteger(value) && value > 0)
    || !Number.isSafeInteger(delayMs) || delayMs < 0 || maxPending < batchSize) throw new Error('Invalid batch read limits.');
  const pending = new Map<string, Entry<T>>();
  const queue: Entry<T>[] = [];
  const running = new Set<AbortController>();
  const batches = new Map<AbortController, Entry<T>[]>();
  let scope = '', generation = 0, timer: ReturnType<typeof setTimeout> | null = null;

  const finish = (entry: Entry<T>, error: unknown, value?: T) => {
    if (pending.get(entry.key) !== entry) return;
    pending.delete(entry.key);
    if (entry.deadline) clearTimeout(entry.deadline);
    const queued = queue.indexOf(entry);
    if (queued >= 0) queue.splice(queued, 1);
    if (error) entry.reject(error); else entry.resolve(value as T);
  };
  const current = (entry: Entry<T>) => entry.generation === generation && entry.scope === scope;
  function schedule() {
    if (!queue.length || timer || running.size >= concurrency) return;
    timer = setTimeout(() => { timer = null; pump(); }, delayMs);
  }
  function pump() {
    while (queue.length && running.size < concurrency) {
      const entries = queue.splice(0, batchSize).filter(entry => current(entry) && pending.get(entry.key) === entry);
      if (!entries.length) continue;
      const controller = new AbortController();
      running.add(controller);
      batches.set(controller, entries);
      entries.forEach(entry => { entry.controller = controller; });
      void (async () => {
        try {
          // Callers have independent deadlines below. Retain this transport
          // slot until the work actually settles: an SDK auth phase may not
          // observe abort immediately, and racing it would exceed concurrency.
          const values = await fetchBatch(entries.map(entry => entry.key), controller.signal);
          for (const entry of entries) {
            if (!current(entry)) finish(entry, new StaleBatchReadError());
            else if (!values.has(entry.key)) finish(entry, new Error('Incomplete metadata response.'));
            else finish(entry, null, values.get(entry.key));
          }
        } catch (error) { entries.forEach(entry => finish(entry, error)); }
        finally {
          running.delete(controller);
          batches.delete(controller);
          schedule();
        }
      })();
    }
  }
  return {
    setScope(next: string) {
      if (next === scope) return;
      scope = next; generation++;
      if (timer) clearTimeout(timer);
      timer = null; queue.length = 0;
      [...pending.values()].forEach(entry => finish(entry, new StaleBatchReadError()));
      running.forEach(controller => controller.abort());
    },
    read(key: string): Promise<T> {
      const existing = pending.get(key);
      if (existing) return existing.promise;
      if (!scope || !key) return Promise.reject(new Error('A reading session and key are required.'));
      if (pending.size >= maxPending) return Promise.reject(new Error('Too many pending metadata requests.'));
      let resolve!: (value: T) => void, reject!: (error: unknown) => void;
      const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
      const entry: Entry<T> = { key, scope, generation, promise, resolve, reject };
      // Include queue time in the caller's budget. Even a noncooperative
      // transport cannot leave a queued caller waiting or retain expired keys.
      entry.deadline = setTimeout(() => {
        finish(entry, new Error('Metadata request timed out.'));
        const controller = entry.controller;
        if (controller && !batches.get(controller)?.some(item => pending.get(item.key) === item)) controller.abort();
      }, timeoutMs);
      pending.set(key, entry); queue.push(entry); schedule();
      return promise;
    },
    get pendingCount() { return pending.size; },
    get activeBatches() { return running.size; },
  };
}
