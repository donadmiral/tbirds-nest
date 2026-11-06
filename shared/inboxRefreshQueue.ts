/** Event-driven inbox reconciliation. A busy thread gets one small ID batch,
 * not a complete inbox read per message. Events during a read retain a trailing
 * batch; continuous traffic cannot keep postponing the first timer. */
export function createInboxRefreshQueue(options: {
  read: (ids: string[] | null, signal: AbortSignal) => Promise<void>;
  active?: boolean; random?: () => number; onError?: (error: unknown) => void;
}) {
  let active = options.active !== false, disposed = false, full = false, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flight: { controller: AbortController; deadline?: ReturnType<typeof setTimeout>; interrupted: boolean; timedOut: boolean } | undefined;
  const ids = new Set<string>();
  const random = options.random ?? Math.random;
  function schedule(delay = 200) {
    if (disposed || !active || flight || timer || (!full && !ids.size)) return;
    timer = setTimeout(() => { timer = undefined; void run(); }, delay);
  }
  async function run() {
    if (disposed || !active || flight || (!full && !ids.size)) return;
    const batch = full ? null : [...ids].slice(0, 50);
    if (full) { full = false; ids.clear(); } else batch?.forEach(id => ids.delete(id));
    const operation = { controller: new AbortController(), deadline: undefined as ReturnType<typeof setTimeout> | undefined,
      interrupted: false, timedOut: false };
    flight = operation;
    const failed = (error: unknown) => {
      failures++;
      if (batch) batch.forEach(id => ids.add(id)); else full = true;
      if (ids.size > 200) { full = true; ids.clear(); }
      options.onError?.(error);
    };
    operation.deadline = setTimeout(() => {
      if (flight !== operation || disposed || !active || operation.interrupted) return;
      operation.timedOut = true; operation.controller.abort();
      failed(new Error('Conversation updates took too long.'));
    }, 12_000);
    try {
      // Keep the transport slot until the SDK actually settles. An Auth phase
      // can ignore abort temporarily; racing a timeout or clearing the slot on
      // background/resume would otherwise start overlapping real requests.
      await Promise.resolve().then(() => {
        if (!operation.controller.signal.aborted) return options.read(batch, operation.controller.signal);
      });
      if (!operation.interrupted && !operation.timedOut) failures = 0;
    } catch (error) {
      if (!disposed && active && !operation.interrupted && !operation.timedOut) failed(error);
    } finally {
      clearTimeout(operation.deadline);
      if (flight === operation) {
        flight = undefined;
        schedule(operation.interrupted ? 200 : Math.min(30_000, (failures ? 1000 * 2 ** Math.min(failures, 5) : 800) * (0.8 + random() * 0.4)));
      }
    }
  }
  return {
    changed(id: string) { if (disposed || !id) return; ids.add(id); if (ids.size > 200) { full = true; ids.clear(); } schedule(); },
    refresh() { if (disposed) return; full = true; ids.clear(); schedule(); },
    refreshNow() {
      if (disposed) return;
      full = true; ids.clear(); clearTimeout(timer); timer = undefined;
      void run();
    },
    setActive(value: boolean) {
      if (disposed || active === value) return;
      active = value;
      if (value) { full = true; schedule(); }
      else {
        clearTimeout(timer); timer = undefined;
        if (flight) { flight.interrupted = true; clearTimeout(flight.deadline); flight.controller.abort(); }
        full = true; ids.clear();
      }
    },
    dispose() { disposed = true; clearTimeout(timer); if (flight) { clearTimeout(flight.deadline); flight.controller.abort(); } ids.clear(); },
  };
}
