import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createNativeSessionHistory } from './sessionHistory';
import type { HistorySnapshot, SessionHistory } from '../../shared/sessionHistory';

/** Scope-local UI wiring; explicit full exports/search results use their own
 * readers and never depend on the number of currently resident list rows. */
export function useReadingWindow<T>(options: { identity: string; id: (row: T) => string;
  fetch: (ids: string[], signal: AbortSignal) => Promise<T[]>; current: () => boolean;
  rows: (rows: T[]) => void; error: (message: string) => void }) {
  const latest = useRef(options); latest.current = options;
  const history = useRef<SessionHistory<T> | null>(null), alive = useRef(true), stop = useRef<(() => void) | null>(null);
  const memories = useRef(new Map<string, { history: SessionHistory<T>; top: number }>()), identity = useRef(options.identity);
  const [snapshot, setSnapshot] = useState<HistorySnapshot<T> | null>(null);
  const top = useRef(0);
  const reset = useCallback(() => {
    stop.current?.(); stop.current = null; const previous = history.current; history.current = null; setSnapshot(null); top.current = 0;
    void previous?.dispose().catch(() => {});
  }, []);
  const bind = useCallback((value: SessionHistory<T>, key: string) => {
    const valid = () => alive.current && latest.current.identity === key && latest.current.current();
    value.rebind({ current: valid, fetch: (ids, signal) => latest.current.fetch(ids, signal) });
    const sync = () => { if (!valid()) return; const next = value.getSnapshot(); setSnapshot(next); latest.current.rows(next.rows); if (next.error) latest.current.error(next.error); };
    stop.current?.(); history.current = value; stop.current = value.subscribe(sync); sync();
  }, []);
  useLayoutEffect(() => {
    if (identity.current === options.identity) return;
    if (history.current) memories.current.set(identity.current, { history: history.current, top: top.current });
    stop.current?.(); stop.current = null; identity.current = options.identity;
    const saved = memories.current.get(options.identity);
    history.current = null; setSnapshot(null); top.current = saved?.top ?? 0;
    if (saved?.history.available()) bind(saved.history, options.identity);
    while (memories.current.size > 4) { const key = memories.current.keys().next().value!; const value = memories.current.get(key); memories.current.delete(key); void value?.history.dispose().catch(() => {}); }
  }, [options.identity, bind]);
  useEffect(() => { alive.current = true; return () => {
    alive.current = false; stop.current?.();
    new Set([history.current, ...[...memories.current.values()].map(value => value.history)]).forEach(value => { void value?.dispose().catch(() => {}); });
    memories.current.clear();
  }; }, []);
  const commit = useCallback(async (rows: T[], mode: 'reset' | 'append' | 'refresh', current: () => boolean) => {
    let value = history.current;
    if (!value?.available() || mode === 'reset') {
      const key = latest.current.identity, previous = value;
      const valid = () => alive.current && latest.current.identity === key && latest.current.current();
      const replacement = createNativeSessionHistory<T>({ id: latest.current.id, current: valid,
        fetch: (ids, signal) => latest.current.fetch(ids, signal) });
      try { for (let from = 0; from < rows.length; from += 100) await replacement.append(rows.slice(from, from + 100));
        if (!current() || !valid()) { await replacement.dispose(); return null; } }
      catch (error) { await replacement.dispose(); throw error; }
      value = replacement; bind(replacement, key); void previous?.dispose().catch(() => {});
    } else if (mode === 'append') {
      value.update(rows); const known = new Set(value.getSnapshot().rows.map(latest.current.id));
      await value.append(rows.filter(row => !known.has(latest.current.id(row))));
    } else value.replaceHot(rows);
    return value.getSnapshot().rows;
  }, [bind]);
  const restoreMore = useCallback(async () => {
    const value = history.current; if (!value || value.atEnd()) return false;
    await value.around((value.getSnapshot().pages.at(-1)?.index ?? 0) + 1); return true;
  }, []);
  return { history, snapshot, top, commit, reset, restoreMore };
}
