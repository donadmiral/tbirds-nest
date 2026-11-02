/** No idle heartbeat: actual HTTP outcomes and foreground entry establish
 * reachability. Only an outage or durable pending work needs a retry timer. */
export function createNetworkRecovery(options: {
  probe: (signal: AbortSignal) => Promise<void>;
  flush: () => Promise<boolean>;
  hasWork: () => boolean;
  setOnline: (online: boolean) => void;
  active?: boolean;
  random?: () => number;
}) {
  let active = options.active !== false, disposed = false, online = true;
  let misses = 0, workAttempts = 0, working = false, revision = 0;
  let retry: ReturnType<typeof setTimeout> | undefined, work: ReturnType<typeof setTimeout> | undefined;
  let probe: { controller: AbortController; deadline: ReturnType<typeof setTimeout> } | undefined;
  const jitter = (attempt: number) => Math.min(30000, Math.round(Math.min(30000, 5000 * 2 ** Math.min(Math.max(attempt - 1, 0), 3)) * (0.8 + (options.random ?? Math.random)() * 0.4)));
  const clearRetry = () => { if (retry !== undefined) clearTimeout(retry); retry = undefined; };
  const clearWork = () => { if (work !== undefined) clearTimeout(work); work = undefined; };
  const markOnline = (value: boolean) => {
    if (online !== value) { online = value; options.setOnline(value); }
  };
  function workQueued() {
    if (!active || disposed || !online || working || work !== undefined || !options.hasWork()) return;
    // Give the immediate sender time to finish; its stable message ID is also
    // used by reconciliation if the response was lost.
    work = setTimeout(() => { work = undefined; void flush(); }, jitter(workAttempts));
  }
  async function flush() {
    if (!active || disposed || !online || working || !options.hasWork()) return;
    working = true;
    let pending = false;
    try { pending = await options.flush(); } catch { pending = true; }
    finally {
      working = false;
      workAttempts = pending ? workAttempts + 1 : 0;
      if (pending) workQueued();
    }
  }
  function reachable(recovered = false) {
    if (!active || disposed) return;
    const wasOffline = !online;
    misses = 0; clearRetry(); markOnline(true);
    if (recovered || wasOffline) { clearWork(); void flush(); } else workQueued();
  }
  function check() {
    if (!active || disposed || probe) return;
    clearRetry();
    const operation = ++revision, controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => { controller.abort(); reject(new Error('Reachability check timed out.')); }, 6000);
    });
    probe = { controller, deadline: deadline! };
    void Promise.race([Promise.resolve().then(() => { if (!controller.signal.aborted) return options.probe(controller.signal); }), timeout]).then(() => {
      if (revision === operation) reachable(true);
    }, () => {
      if (revision !== operation || !active || disposed) return;
      misses++;
      // Preserve the two-miss verdict so one slow packet cannot mark offline.
      if (misses >= 2) markOnline(false);
      retry = setTimeout(() => { retry = undefined; check(); }, jitter(misses));
    }).finally(() => {
      clearTimeout(deadline!);
      if (revision === operation) probe = undefined;
    });
  }
  function pause() {
    revision++; clearRetry(); clearWork();
    if (probe) { probe.controller.abort(); clearTimeout(probe.deadline); probe = undefined; }
  }
  return {
    start: check,
    workQueued,
    outcome(success: boolean) {
      if (!active || disposed) return;
      if (success) {
        // A newer real response wins over an older stalled health probe.
        if (probe) { revision++; probe.controller.abort(); clearTimeout(probe.deadline); probe = undefined; }
        reachable();
      } else if (retry === undefined) check();
    },
    setActive(value: boolean) {
      if (active === value || disposed) return;
      active = value;
      if (value) check(); else pause();
    },
    dispose() { disposed = true; active = false; pause(); },
  };
}
