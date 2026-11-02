import { createRecoveryReader } from './recoveryReader';

export type TypingRow = { conversation_id: string; user_id: string; is_typing: boolean; updated_at: string };
type TypingChange = { eventType?: string; new?: Partial<TypingRow>; old?: Partial<TypingRow> };

/** Authorized realtime rows drive typing immediately; expiry is local, so a
 * missing stop event never leaves an indicator on screen indefinitely. */
export function createTypingActivity(options: {
  read: (signal: AbortSignal) => Promise<TypingRow[]>;
  accept: (row: TypingRow) => boolean;
  onChange: (rows: TypingRow[]) => void;
  active?: boolean;
  intervalMs?: number;
  lifetimeMs?: number;
  random?: () => number;
}) {
  const lifetime = options.lifetimeMs ?? 7000;
  const rows = new Map<string, TypingRow>();
  let active = options.active !== false, disposed = false, revision = 0, signature = '';
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const key = (row: Pick<TypingRow, 'conversation_id' | 'user_id'>) => `${row.conversation_id}:${row.user_id}`;
  const fresh = (row: TypingRow) => {
    const age = Date.now() - Date.parse(row.updated_at);
    return row.is_typing && age >= 0 && age < lifetime && options.accept(row);
  };
  function publish() {
    if (expiry !== undefined) clearTimeout(expiry);
    expiry = undefined;
    for (const [id, row] of rows) if (!fresh(row)) rows.delete(id);
    const next = [...rows.keys()].sort().join('|');
    if (next !== signature) { signature = next; options.onChange([...rows.values()]); }
    if (rows.size && active && !disposed) {
      const due = Math.min(...[...rows.values()].map(row => Date.parse(row.updated_at) + lifetime));
      expiry = setTimeout(publish, Math.max(1, due - Date.now()));
    }
  }
  const recovery = createRecoveryReader({
    active, intervalMs: options.intervalMs ?? 3000, maxIntervalMs: 12000, random: options.random,
    read: async signal => {
      const before = revision;
      const snapshot = await options.read(signal);
      // A slow initial read must not resurrect a stop event received since it
      // began. The next realtime update/recovery supplies any remaining state.
      if (signal.aborted || disposed || !active || revision !== before) return;
      rows.clear();
      for (const row of snapshot) if (fresh(row)) rows.set(key(row), row);
      publish();
    },
  });
  return {
    refresh: recovery.refresh,
    status(status: string) { recovery.setConnected(status === 'SUBSCRIBED'); },
    change(payload: TypingChange) {
      if (!active || disposed) return;
      const value = payload.eventType === 'DELETE' ? payload.old : payload.new;
      if (!value?.conversation_id || !value?.user_id) { recovery.refresh(); return; }
      revision++;
      const row = value as TypingRow;
      if (payload.eventType !== 'DELETE' && fresh(row)) rows.set(key(row), row); else rows.delete(key(row));
      publish();
    },
    setActive(value: boolean) {
      if (disposed || active === value) return;
      active = value; revision++;
      if (!value) { rows.clear(); publish(); }
      recovery.setActive(value);
    },
    dispose() {
      disposed = true; active = false; revision++;
      recovery.dispose(); if (expiry !== undefined) clearTimeout(expiry); rows.clear();
    },
  };
}
