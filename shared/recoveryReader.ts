/** Reconcile on entry/reconnect, with polling only while realtime or reads fail.
 * Callers must check the supplied signal before publishing a response. */
export function createRecoveryReader(options: {
  read: (signal: AbortSignal) => Promise<void>;
  intervalMs: number;
  maxIntervalMs?: number;
  timeoutMs?: number;
  active?: boolean;
  random?: () => number;
}) {
  let active = options.active !== false, connected = false, disposed = false;
  let failures = 0, revision = 0, again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flight: { controller: AbortController; deadline: ReturnType<typeof setTimeout>; revision: number } | undefined;
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    if (!active || disposed || flight || timer !== undefined || (connected && failures === 0)) return;
    const maximum = options.maxIntervalMs ?? options.intervalMs * 4;
    const base = Math.min(maximum, options.intervalMs * 2 ** Math.min(Math.max(failures - 1, 0), 8));
    const delay = Math.min(maximum, Math.round(base * (0.8 + (options.random ?? Math.random)() * 0.4)));
    timer = setTimeout(() => { timer = undefined; refresh(); }, delay);
  };
  function refresh() {
    if (!active || disposed) return;
    if (flight) { again = true; return; }
    clearTimer();
    const controller = new AbortController(), operation = ++revision;
    let timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new Error('Recovery read timed out.')); }, options.timeoutMs ?? 10000);
    });
    flight = { controller, deadline: timeout!, revision: operation };
    void Promise.race([Promise.resolve().then(() => { if (!controller.signal.aborted) return options.read(controller.signal); }), deadline])
      .then(() => { if (revision === operation) failures = 0; }, () => { if (revision === operation) failures++; })
      .finally(() => {
        clearTimeout(timeout!);
        if (revision !== operation) return;
        flight = undefined;
        if (again) { again = false; refresh(); } else schedule();
      });
  }
  function pause() {
    clearTimer(); again = false; revision++;
    if (flight) { clearTimeout(flight.deadline); flight.controller.abort(); flight = undefined; }
  }
  return {
    refresh,
    setConnected(value: boolean) {
      if (disposed || connected === value) return;
      connected = value;
      if (value) { failures = 0; refresh(); } else schedule();
    },
    setActive(value: boolean) {
      if (disposed || active === value) return;
      active = value;
      if (value) refresh(); else pause();
    },
    dispose() { disposed = true; active = false; pause(); },
  };
}
