import { mergeMessagePage, type MessageCursor } from './messageHistory';

/** Only identities, ordering and measured geometry survive content eviction.
 * A cold message is read again through the current authenticated conversation.
 * Unlike a feed, a thread grows at both ends while somebody reads its middle. */
export const THREAD_RESIDENT_MESSAGES = 120;
export const THREAD_LEDGER_MESSAGES = 8192;
export type ThreadIdentity = MessageCursor & { sender_id: string | null };
type Descriptor = ThreadIdentity & { height: number; reserved: number; measured: boolean; version: number; denied: boolean };
export type ThreadItem<T> =
  | { type: 'message'; id: string; row: T; index: number; height: number }
  | { type: 'gap'; id: string; first: number; last: number; height: number };
export type ThreadSnapshot<T> = {
  rows: T[]; items: ThreadItem<T>[]; identities: ThreadIdentity[];
  restoring: boolean; error: string | null; total: number; revision: number;
  errorKind: 'replace' | 'restore' | null;
};
const changed = () => Object.assign(new Error('The conversation or account changed.'), { name: 'AbortError' });
const full = () => new Error('This reading session is full. Reopen the conversation to continue. Your messages are saved.');

export function createThreadWindow<T extends ThreadIdentity>(options: {
  ascending?: boolean; resident?: number; maximum?: number;
  current: () => boolean; fetch: (ids: string[], signal: AbortSignal) => Promise<T[]>;
}) {
  const resident = options.resident ?? THREAD_RESIDENT_MESSAGES, maximum = options.maximum ?? THREAD_LEDGER_MESSAGES;
  let ledger: Descriptor[] = [], hot = new Map<string, T>(), anchor: string | null = null;
  let identities: ThreadIdentity[] = [];
  let version = 0, disposed = false, restoring = false, error: string | null = null;
  let errorKind: ThreadSnapshot<T>['errorKind'] = null;
  let moving: Promise<void> | null = null, desired: string | null = null;
  const listeners = new Set<() => void>(), requests = new Set<AbortController>();
  let state: ThreadSnapshot<T> = { rows: [], items: [], identities: [], restoring: false, error: null, errorKind: null, total: 0, revision: 0 };
  const valid = () => !disposed && options.current();
  const assertCurrent = () => { if (!valid()) throw changed(); };
  const identity = (row: T): ThreadIdentity => ({ id: row.id, created_at: row.created_at, sender_id: row.sender_id });
  const latest = (rows = ledger) => rows[options.ascending ? rows.length - 1 : 0];
  function publish() {
    const rows: T[] = [], items: ThreadItem<T>[] = [];
    ledger.forEach((entry, index) => {
      const row = hot.get(entry.id);
      if (row) { rows.push(row); items.push({ type: 'message', id: entry.id, row, index, height: entry.height }); }
      else {
        const previous = items[items.length - 1];
        if (previous?.type === 'gap') { previous.last = index; previous.height += entry.height; }
        else items.push({ type: 'gap', id: `gap:${entry.id}`, first: index, last: index, height: entry.height });
      }
    });
    state = { rows, items, identities,
      restoring, error, errorKind, total: ledger.length, revision: state.revision + 1 };
    listeners.forEach(listener => listener());
  }
  function trim(next: Map<string, T>, descriptors: Descriptor[], target: string | null) {
    const center = Math.max(0, descriptors.findIndex(row => row.id === target));
    const candidates = descriptors.map((row, index) => ({ row, distance: Math.abs(index - center) }))
      .filter(({ row }) => row.measured && next.has(row.id) && row.id !== target)
      .sort((a, b) => b.distance - a.distance);
    for (const { row } of candidates) { if (next.size <= resident) break; row.reserved = row.height; next.delete(row.id); }
    // Never guess the size of an unseen message or discard the visible anchor.
    if (next.size > resident) throw new Error('This message page is still loading. Please try again in a moment.');
  }
  function replace(rows: T[], followLatest = false) {
    assertCurrent();
    try {
      const next = new Map(rows.map(row => [row.id, row]));
      if ([...next.keys()].some(id => !id || id.length > 128)) throw new Error('Invalid message identity.');
      const previous = new Map(ledger.map(row => [row.id, row]));
      const retained = ledger.filter(row => !hot.has(row.id) || next.has(row.id));
      const metadata = new Map(retained.map(row => [row.id, row]));
      for (const row of next.values()) {
        const old = previous.get(row.id);
        metadata.set(row.id, { ...identity(row), height: old?.height ?? 0, reserved: old?.reserved ?? 0, measured: old?.measured ?? false,
          version: (old?.version ?? 0) + (hot.get(row.id) === row ? 0 : 1), denied: false });
      }
      if (metadata.size > maximum) throw full();
      const ordered = mergeMessagePage([], [...metadata.values()], options.ascending);
      const target = followLatest || !anchor ? latest(ordered)?.id ?? null : anchor;
      trim(next, ordered, target);
      ledger = ordered; identities = ledger.map(({ id, created_at, sender_id }) => ({ id, created_at, sender_id }));
      hot = next; anchor = target; error = null; errorKind = null; publish();
      return true;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : 'Messages could not be kept on this device.'; errorKind = 'replace'; publish(); throw reason;
    }
  }
  async function restore(id: string) {
    assertCurrent();
    const center = ledger.findIndex(row => row.id === id); if (center < 0) return;
    anchor = id;
    const start = Math.max(0, Math.min(center - Math.floor(resident / 2), ledger.length - resident));
    const wanted = ledger.slice(start, start + resident), cold = wanted.filter(row => !hot.has(row.id) && !row.denied);
    if (!cold.length) return;
    const expected = new Map(cold.map(row => [row.id, row.version]));
    const token = version, request = new AbortController(); requests.add(request);
    restoring = true; error = null; errorKind = null; publish();
    try {
      const received: T[] = [];
      for (let from = 0; from < cold.length; from += 100) {
        received.push(...await options.fetch(cold.slice(from, from + 100).map(row => row.id), request.signal));
        assertCurrent(); if (version !== token || request.signal.aborted) throw changed();
      }
      const byId = new Map(received.map(row => [row.id, row]));
      if ([...byId.keys()].some(key => !expected.has(key))) throw new Error('The message reader returned a different conversation.');
      const wantedIds = new Set(wanted.map(row => row.id));
      const unmeasured = new Set(ledger.filter(row => !row.measured).map(row => row.id));
      const next = new Map([...hot].filter(([key]) => wantedIds.has(key) || unmeasured.has(key)));
      ledger = ledger.map(entry => {
        if (hot.has(entry.id) && !next.has(entry.id)) entry = { ...entry, reserved: entry.height };
        // A realtime edit/deletion wins over an earlier cold-page request.
        if (expected.get(entry.id) !== entry.version || hot.has(entry.id)) return entry;
        const row = byId.get(entry.id);
        if (row) next.set(entry.id, row);
        return { ...entry, denied: !row };
      });
      trim(next, ledger, anchor); hot = next; publish();
    } catch (reason) {
      if (valid() && token === version) { error = reason instanceof Error ? reason.message : 'Earlier messages could not be loaded. Please retry.'; errorKind = 'restore'; publish(); }
      throw reason;
    } finally {
      requests.delete(request);
      if (valid() && token === version) { restoring = false; publish(); }
    }
  }
  const clear = () => {
    version++; requests.forEach(request => request.abort()); desired = null; moving = null;
    ledger = []; identities = []; hot.clear(); anchor = null; restoring = false; error = null; errorKind = null; publish();
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    replace,
    measure(id: string, height: number) {
      if (!valid() || !Number.isFinite(height) || height <= 0 || height > 1_000_000) return;
      const entry = ledger.find(row => row.id === id); if (!entry || !hot.has(id)) return;
      const value = Math.max(entry.reserved, height);
      if (entry.measured && Math.abs(value - entry.height) < 0.5) return;
      entry.height = value; entry.measured = true; publish();
    },
    near(offset: number, viewport: number) {
      if (!valid() || !ledger.length) return Promise.resolve();
      const position = Math.max(0, offset + viewport / 2);
      let top = 0, target = ledger[ledger.length - 1];
      for (const entry of ledger) { if (position < top + entry.height) { target = entry; break; } top += entry.height; }
      anchor = target.id; desired = target.id;
      if (!moving) {
        const token = version;
        let flight: Promise<void>;
        moving = flight = (async () => {
          while (desired && valid() && version === token) { const next = desired; desired = null; await restore(next); }
        })().finally(() => { if (moving === flight) moving = null; });
      }
      return moving;
    },
    remove(ids: Set<string>) {
      if (!valid()) return;
      const oldAnchor = ledger.findIndex(row => row.id === anchor);
      ledger = ledger.filter(row => !ids.has(row.id)); identities = identities.filter(row => !ids.has(row.id));
      if (anchor && ids.has(anchor)) anchor = ledger[Math.min(oldAnchor, ledger.length - 1)]?.id ?? null;
      ids.forEach(id => hot.delete(id)); publish();
    },
    invalidate(ids: Set<string>) {
      if (!valid()) return;
      ledger.forEach(row => { if (ids.has(row.id)) { row.version++; row.denied = false; } });
    },
    atLatest: () => !ledger.length || hot.has(latest()!.id),
    rebind(next: Pick<typeof options, 'current' | 'fetch'>) {
      version++; requests.forEach(request => request.abort()); desired = null; moving = null;
      options.current = next.current; options.fetch = next.fetch;
      ledger.forEach(row => { row.denied = false; }); restoring = false; error = null; errorKind = null; publish();
    },
    sanitize(mapper: (rows: T[]) => T[]) {
      const rows = mapper([...hot.values()]); hot = new Map(rows.map(row => [row.id, row])); publish();
    },
    detach() { version++; requests.forEach(request => request.abort()); desired = null; restoring = false; options.current = () => false; listeners.clear(); },
    stats: () => ({ residentMessages: hot.size, ledgerMessages: ledger.length, maximumResidentMessages: resident, maximumLedgerMessages: maximum }),
    clear,
    dispose() { clear(); disposed = true; listeners.clear(); },
  };
}
export type ThreadWindow<T extends ThreadIdentity> = ReturnType<typeof createThreadWindow<T>>;
