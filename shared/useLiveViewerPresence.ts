type PresenceResponse = { error?: unknown };
type PresenceRequest = PromiseLike<PresenceResponse> & { abortSignal?(signal: AbortSignal): PresenceRequest };
export type ViewerPresenceClient = {
  rpc(name: string, args: Record<string, unknown>): PresenceRequest;
};
type PresenceOptions = {
  client: ViewerPresenceClient;
  sessionId: string;
  playbackId: string;
  random?: () => number;
};

// Each player owns a lease. Closing one tab cannot retire another tab's lease.
// The server deduplicates their authenticated user when it measures the total.
export function createLiveViewerPresence({ client, sessionId, playbackId, random = Math.random }: PresenceOptions) {
  let active = false, disposed = false, inFlight = false, attemptedActive = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer) clearTimeout(timer); timer = undefined; };
  const send = async () => {
    if (inFlight) return;
    clear();
    const wanted = active && !disposed;
    if (!wanted && !attemptedActive) return;
    inFlight = true;
    if (wanted) attemptedActive = true;
    const abort = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      let request = client.rpc('live_viewer_heartbeat', {
        p_session_id: sessionId, p_playback_id: playbackId, p_active: wanted,
      });
      if (request.abortSignal) request = request.abortSignal(abort.signal);
      await Promise.race([
        Promise.resolve(request),
        new Promise<PresenceResponse>(resolve => {
          timeout = setTimeout(() => { abort.abort(); resolve({ error: 'timeout' }); }, 8000);
        }),
      ]);
      if (!wanted) attemptedActive = false;
    } catch {
      // A missing request cannot keep a viewer present beyond the server TTL.
      if (!wanted) attemptedActive = false;
    } finally {
      if (timeout) clearTimeout(timeout);
      inFlight = false;
      if (wanted !== (active && !disposed)) {
        // Serialize leave after a pending join, including unmount during a request.
        void send();
      } else if (active && !disposed) {
        timer = setTimeout(() => { timer = undefined; void send(); }, 30000 + Math.floor(Math.max(0, Math.min(1, random())) * 15000));
      }
    }
  };
  return {
    setActive(next: boolean) {
      if (disposed || active === next) return;
      active = next;
      clear();
      void send();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      clear();
      void send();
    },
  };
}

type ViewerPresenceInput = {
  client: ViewerPresenceClient;
  sessionId: string | null;
  identityScope: string | null;
  // True only for an actual playing live video while visible or in PiP.
  active: boolean;
  createPlaybackId(): string;
};
type ViewerPresenceHooks = {
  useRef<T>(initialValue: T): { current: T };
  useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]): void;
};

// Each client binds its own React installation. Shared code has no React dependency.
export function createLiveViewerPresenceHook({ useEffect, useRef }: ViewerPresenceHooks) {
  return function useLiveViewerPresence({ client, sessionId, identityScope, active, createPlaybackId }: ViewerPresenceInput) {
    const lease = useRef<ReturnType<typeof createLiveViewerPresence> | null>(null);
    const latest = useRef({ active, createPlaybackId });
    latest.current = { active, createPlaybackId };
    useEffect(() => {
      if (!sessionId || !identityScope) return;
      const playbackId = latest.current.createPlaybackId();
      const current = createLiveViewerPresence({ client, sessionId, playbackId });
      lease.current = current;
      current.setActive(latest.current.active);
      return () => { current.dispose(); if (lease.current === current) lease.current = null; };
    }, [client, sessionId, identityScope]);
    useEffect(() => { lease.current?.setActive(active); }, [active, sessionId, identityScope]);
  };
}
