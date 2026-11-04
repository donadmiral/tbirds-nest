import { parseLiveDirectory, type LiveSession } from './liveDirectory';

export const LIVE_STORY_PRESENCE_TTL = 30_000;
export type LiveStoryPresence = { scope: string | null; sessions: LiveSession[]; checkedAt: number };
export const EMPTY_LIVE_STORY_PRESENCE: LiveStoryPresence = { scope: null, sessions: [], checkedAt: 0 };

/** One bounded, authenticated directory snapshot shared by all story surfaces. */
export function createLiveStoryPresence(read: (filter: 'following' | 'mine', signal: AbortSignal) => Promise<unknown>, clock = Date.now) {
  let state = EMPTY_LIVE_STORY_PRESENCE, generation = 0;
  let pending: { scope: string; promise: Promise<LiveStoryPresence>; controller: AbortController } | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: LiveStoryPresence) => { state = next; listeners.forEach(listener => listener()); };
  const reset = (scope: string | null) => {
    generation++; pending?.controller.abort(); pending = null;
    publish({ scope, sessions: [], checkedAt: 0 });
  };
  return {
    getSnapshot: () => state,
    getServerSnapshot: () => EMPTY_LIVE_STORY_PRESENCE,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reset,
    async refresh(scope: string | null, force = false): Promise<LiveStoryPresence> {
      if (state.scope !== scope) reset(scope);
      if (!scope) return state;
      if (pending?.scope === scope) return pending.promise;
      const age = clock() - state.checkedAt;
      if (!force && state.checkedAt > 0 && age >= 0 && age < LIVE_STORY_PRESENCE_TTL) return state;
      const version = generation, controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Live presence timed out')); }, 8000); });
      const reads = Promise.all(['following', 'mine'].map(filter => Promise.resolve().then(() => read(filter as 'following' | 'mine', controller.signal))));
      const promise = Promise.race([reads, deadline]).then(values => {
        if (version !== generation || state.scope !== scope || controller.signal.aborted) return state;
        const sessions = new Map<string, LiveSession>();
        for (const value of values) {
          const page = parseLiveDirectory(value);
          if (!page.capabilities.view) continue;
          for (const session of page.items) {
            // Reconnecting, starting and scheduled broadcasts never acquire a LIVE badge.
            if (session.state !== 'live' || session.ended_at) continue;
            if (!sessions.has(session.host.id)) sessions.set(session.host.id, session);
          }
        }
        publish({ scope, sessions: [...sessions.values()].slice(0, 48), checkedAt: clock() });
        return state;
      }).catch(() => {
        if (version === generation && state.scope === scope) publish({ scope, sessions: [], checkedAt: clock() });
        return state;
      }).finally(() => { clearTimeout(timer); controller.abort(); if (pending?.controller === controller) pending = null; });
      pending = { scope, promise, controller };
      return promise;
    },
  };
}

export function liveStorySessions(snapshot: LiveStoryPresence, scope: string | null, now = Date.now()): LiveSession[] {
  const age = now - snapshot.checkedAt;
  return scope && snapshot.scope === scope && snapshot.checkedAt > 0 && age >= 0 && age < LIVE_STORY_PRESENCE_TTL ? snapshot.sessions : [];
}
