/** A bounded reading window. The durable ledger contains identifiers and
 * geometry only. Content and media grants are always fetched again under the
 * current session before a cold page can re-enter the visible window. */
export type HistoryStorage = {
  read(keys: string[]): Promise<(string | null)[]>;
  write(entries: [string, string][]): Promise<void>;
  clear(prefix: string): Promise<void>;
};
export type HistoryPage<T> = { index: number; first: number; rows: T[]; height: number; reserved?: number };
export type HistorySnapshot<T> = {
  pages: HistoryPage<T>[]; rows: T[]; first: number; count: number;
  before: number; after: number; total: number; restoring: boolean;
  error: string | null; revision: number;
};
type Descriptor = { version: 1; index: number; first: number; ids: string[]; height: number };
type Metric = { first: number; count: number; height: number; measured: boolean };

export const HISTORY_PAGE_ROWS = 5;
export const HISTORY_RESIDENT_ROWS = 120;
export const HISTORY_MAX_PAGES = 2048;
export const HISTORY_MAX_BYTES = 4 * 1024 * 1024;
export const HISTORY_MAX_AGE_MS = 24 * 60 * 60_000;
const unavailable = () => new Error('This reading position could not be saved on your device. Retry, or refresh to start a new reading session.');
const changed = () => Object.assign(new Error('The account or reading session changed.'), { name: 'AbortError' });
const bytes = (value: string) => value.length * 2;

export function createSessionHistory<T>(options: {
  storage: HistoryStorage; namespace: string; id: (row: T) => string;
  fetch: (ids: string[], signal: AbortSignal) => Promise<T[]>;
  current: () => boolean; clock?: () => number; pageRows?: number;
  residentRows?: number; maxPages?: number; maxBytes?: number; maxAgeMs?: number;
}) {
  const clock = options.clock ?? Date.now, born = clock();
  const pageRows = options.pageRows ?? HISTORY_PAGE_ROWS;
  const residentPages = Math.max(2, Math.floor((options.residentRows ?? HISTORY_RESIDENT_ROWS) / pageRows));
  const maxPages = options.maxPages ?? HISTORY_MAX_PAGES, maxBytes = options.maxBytes ?? HISTORY_MAX_BYTES;
  const prefix = `pc-history-v1:${options.namespace}:`, pageKey = (n: number) => `${prefix}page:${n}`;
  const idKey = (id: string) => `${prefix}id:${encodeURIComponent(id)}`;
  let metrics: Metric[] = [], hot = new Map<number, HistoryPage<T>>(), writtenBytes = 0;
  let disposed = false, version = 0, anchor = 0, total = 0, restoring = false, error: string | null = null;
  let mutation: Promise<void> = Promise.resolve(), moving: Promise<void> | null = null, desired: number | null = null;
  const active = new Set<AbortController>(), listeners = new Set<() => void>();
  let state: HistorySnapshot<T> = { pages: [], rows: [], first: 0, count: 0, before: 0, after: 0, total: 0, restoring: false, error: null, revision: 0 };
  const valid = () => !disposed && options.current() && clock() >= born && clock() - born < (options.maxAgeMs ?? HISTORY_MAX_AGE_MS);
  const assertCurrent = () => { if (!valid()) throw changed(); };
  const height = (from: number, to: number) => {
    let value = 0; for (let n = from; n < to; n++) value += metrics[n]?.height ?? 0; return value;
  };
  const publish = () => {
    const pages = [...hot.values()].sort((a, b) => a.index - b.index);
    const firstPage = pages[0]?.index ?? 0, lastPage = pages.at(-1)?.index ?? -1;
    const rows = pages.flatMap(page => page.rows);
    state = { pages, rows, first: pages[0]?.first ?? 0, count: rows.length,
      before: height(0, firstPage), after: height(lastPage + 1, metrics.length), total,
      restoring, error, revision: state.revision + 1 };
    listeners.forEach(fn => fn());
  };
  const exclusive = <R>(work: () => Promise<R>): Promise<R> => {
    const result = mutation.then(work, work);
    mutation = result.then(() => {}, () => {});
    return result;
  };
  async function readPages(indices: number[]): Promise<Descriptor[]> {
    const values = await options.storage.read(indices.map(pageKey)); assertCurrent();
    return values.map((value, n) => {
      if (!value) throw unavailable();
      let page: Descriptor;
      try { page = JSON.parse(value); } catch { throw unavailable(); }
      const metric = metrics[indices[n]];
      if (!page || page.version !== 1 || page.index !== indices[n] || page.first !== metric?.first
        || !Array.isArray(page.ids) || page.ids.length !== metric.count || page.ids.length > pageRows
        || page.ids.some(id => typeof id !== 'string' || !id || id.length > 128)) throw unavailable();
      return page;
    });
  }
  const range = (center: number, length: number) => {
    const first = Math.max(0, Math.min(center - Math.floor(length / 2), metrics.length - length));
    return Array.from({ length: Math.min(length, metrics.length) }, (_, n) => first + n);
  };
  function canEvict(index: number) { return metrics[index]?.measured === true; }
  async function append(incoming: T[]) {
    return exclusive(async () => {
      assertCurrent();
      const token = version;
      const stillCurrent = () => { assertCurrent(); if (token !== version) throw changed(); };
      // Bounded identifier lookups prevent dynamic feed ranks from inserting
      // a previously visited post again after its content left memory.
      const unique = [...new Map(incoming.map(row => [options.id(row), row])).values()];
      if (unique.some(row => !options.id(row) || options.id(row).length > 128)) throw new Error('Invalid history identity.');
      if (unique.length > 100) throw new Error('A history append is limited to 100 rows.');
      const known = await options.storage.read(unique.map(row => idKey(options.id(row)))); stillCurrent();
      // A storage implementation may partially write before reporting quota
      // failure. Only IDs belonging to a committed local page count as seen.
      const added = unique.filter((_row, index) => {
        const saved = known[index] === null ? NaN : Number(known[index]);
        return !Number.isInteger(saved) || saved < 0 || saved >= metrics.length;
      });
      if (!added.length) { update(incoming); return; }
      const count = Math.ceil(added.length / pageRows);
      if (metrics.length + count > maxPages) throw unavailable();
      const next = new Map(hot), nextMetrics = [...metrics], entries: [string, string][] = [];
      let nextTotal = total;
      for (let from = 0; from < added.length; from += pageRows) {
        const rows = added.slice(from, from + pageRows), index = nextMetrics.length;
        const descriptor: Descriptor = { version: 1, index, first: nextTotal, ids: rows.map(options.id), height: 0 };
        next.set(index, { index, first: nextTotal, rows, height: 0 });
        nextMetrics.push({ first: nextTotal, count: rows.length, height: 0, measured: false }); nextTotal += rows.length;
        entries.push([pageKey(index), JSON.stringify(descriptor)], ...descriptor.ids.map(id => [idKey(id), String(index)] as [string, string]));
      }
      // Retain the visible page and its neighbours. Eviction is allowed only
      // after actual layout measured the complete page, never an average or
      // an estimated card height. A fast fling cannot force a guessed spacer.
      while (next.size > residentPages) {
        const indices = [...next.keys()].sort((a, b) => Math.abs(b - anchor) - Math.abs(a - anchor));
        const candidate = indices.find(index => index !== anchor && canEvict(index)
          && (index === Math.min(...next.keys()) || index === Math.max(...next.keys())));
        if (candidate === undefined) throw unavailable();
        next.delete(candidate);
      }
      const cost = entries.reduce((n, [key, value]) => n + bytes(key) + bytes(value), 0);
      if (writtenBytes + cost > maxBytes) throw unavailable();
      // Do not remove any live content until all page IDs were durably saved.
      // Failed/partial writes are harmless: the metadata commit stays local,
      // and retry overwrites the same immutable keys before publishing.
      await options.storage.write(entries); stillCurrent();
      metrics = nextMetrics; hot = next; total = nextTotal; writtenBytes += cost; error = null; publish();
    }).catch(reason => { if (valid()) { error = reason instanceof Error ? reason.message : unavailable().message; publish(); } throw reason; });
  }
  function update(incoming: T[]) {
    assertCurrent(); const rows = new Map(incoming.map(row => [options.id(row), row])); let touched = false;
    for (const [index, page] of hot) {
      const next = page.rows.map(row => rows.get(options.id(row)) ?? row);
      if (next.some((row, n) => row !== page.rows[n])) { hot.set(index, { ...page, rows: next }); touched = true; }
    }
    if (touched) publish();
  }
  async function move(center: number) {
    assertCurrent(); center = Math.max(0, Math.min(metrics.length - 1, center)); anchor = center;
    const wanted = range(center, residentPages), cold = wanted.filter(index => !hot.has(index));
      if (!cold.length) return;
    if ([...hot.keys()].some(index => !wanted.includes(index) && !canEvict(index))) throw unavailable();
    const token = version, request = new AbortController(); active.add(request);
    restoring = true; error = null; publish();
    try {
      const descriptors = await readPages(cold), ids = descriptors.flatMap(page => page.ids);
      const received: T[] = [];
      for (let from = 0; from < ids.length; from += 100) {
        if (token !== version || request.signal.aborted) throw changed();
        received.push(...await options.fetch(ids.slice(from, from + 100), request.signal)); assertCurrent();
      }
      if (token !== version || request.signal.aborted) throw changed();
      const permitted = new Set(ids), byId = new Map(received.map(row => [options.id(row), row]));
      if ([...byId.keys()].some(id => !permitted.has(id))) throw new Error('The history reader returned another page.');
      const next = new Map<number, HistoryPage<T>>();
      for (const index of wanted) if (hot.has(index)) next.set(index, hot.get(index)!);
      for (const page of descriptors) next.set(page.index, { index: page.index, first: page.first,
        rows: page.ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []), height: metrics[page.index].height, reserved: metrics[page.index].height });
      // No cold content is reused, including on back navigation. Omitted IDs
      // remain omitted after the authenticated reader rejects their access.
      hot = next; publish();
    } catch (reason) {
      if (valid() && token === version) { error = reason instanceof Error ? reason.message : 'Earlier content could not be loaded. Retry.'; publish(); }
      throw reason;
    } finally { active.delete(request); if (valid() && token === version) { restoring = false; publish(); } }
  }
  function around(center: number): Promise<void> {
    desired = center;
    if (!moving) {
      moving = exclusive(async () => {
        while (desired !== null && valid()) { const next = desired; desired = null; await move(next); }
      }).finally(() => { moving = null; });
    }
    return moving;
  }
  function measure(index: number, measured: number) {
    if (!valid() || !Number.isFinite(measured) || measured < 0 || measured > 1_000_000 || !metrics[index]) return;
    // Authorization may remove a restored row. Its old slot remains geometric
    // history, without retaining or displaying the revoked content.
    const value = Math.max(hot.get(index)?.reserved ?? 0, measured), previous = metrics[index].height;
    if (metrics[index].measured && Math.abs(value - previous) < 0.5) return;
    metrics[index] = { ...metrics[index], height: value, measured: true };
    const page = hot.get(index); if (page) hot.set(index, { ...page, height: value });
    publish();
  }
  return {
    getSnapshot: () => state,
    available: () => !disposed && clock() >= born && clock() - born < (options.maxAgeMs ?? HISTORY_MAX_AGE_MS),
    inactive: () => !options.current(),
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    append, update, around, measure,
    rebind(next: Pick<typeof options, 'current' | 'fetch'>) {
      version++; active.forEach(request => request.abort()); options.current = next.current; options.fetch = next.fetch;
      restoring = false; desired = null; publish();
    },
    replaceHot(rows: T[]) {
      assertCurrent(); const allowed = new Map(rows.map(row => [options.id(row), row]));
      let touched = false;
      for (const [index, page] of hot) {
        const next = page.rows.flatMap(row => { const value = allowed.get(options.id(row)); return value ? [value] : []; });
        if (next.length !== page.rows.length || next.some((row, n) => row !== page.rows[n])) { hot.set(index, { ...page, rows: next }); touched = true; }
      }
      if (touched) publish();
    },
    remove(ids: Set<string>) {
      if (!valid()) return;
      for (const [index, page] of hot) hot.set(index, { ...page, rows: page.rows.filter(row => !ids.has(options.id(row))) });
      publish();
    },
    setAnchor(id: string) { for (const page of hot.values()) if (page.rows.some(row => options.id(row) === id)) { anchor = page.index; break; } },
    async near(offset: number, viewport: number) {
      if (!metrics.length || !valid()) return;
      let top = 0, target = 0;
      for (let index = 0; index < metrics.length; index++) {
        if (offset < top + metrics[index].height) { target = index; break; }
        top += metrics[index].height; target = index;
      }
      anchor = target;
      const first = state.pages[0]?.index ?? 0, last = state.pages.at(-1)?.index ?? 0;
      if ((state.before > 0 && offset - state.before < viewport * 2)
        || (state.after > 0 && height(0, last + 1) - offset - viewport < viewport * 2)
        || target < first || target > last) await around(target);
    },
    atEnd: () => !metrics.length || hot.has(metrics.length - 1),
    stats: () => ({ residentRows: state.count, residentPages: hot.size, ledgerPages: metrics.length, ledgerBytes: writtenBytes,
      maximumResidentRows: residentPages * pageRows, maximumLedgerPages: maxPages, maximumLedgerBytes: maxBytes }),
    async clear() {
      version++; desired = null; active.forEach(request => request.abort());
      hot.clear(); metrics = []; total = 0; writtenBytes = 0; anchor = 0; error = null; restoring = false; publish();
      await exclusive(() => options.storage.clear(prefix));
    },
    async dispose() { disposed = true; version++; desired = null; active.forEach(request => request.abort());
      hot.clear(); metrics = []; total = 0; listeners.clear(); state = { ...state, pages: [], rows: [], count: 0, total: 0 };
      await exclusive(() => options.storage.clear(prefix)); },
  };
}

export type SessionHistory<T> = ReturnType<typeof createSessionHistory<T>>;
