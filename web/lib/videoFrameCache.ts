/**
 * Frames for videos that have no stored cover.
 *
 * A Discover tile, a search result or any other still that stands for a video has nothing to show when the post was
 * published without a cover: older app builds, imported clips, reshared stories. Rather than a placeholder, the browser
 * decodes one real frame of the video itself, as the phone already does, and keeps it in memory for the visit. Frames
 * are keyed by the media object's stable name, never by a signed URL, so a re-signed capability finds its frame again.
 * At most two videos decode at once, a frame that could not be prepared is not retried for a minute, the store is
 * bounded, and everything is forgotten when the signed-in person changes: a frame of private media never outlives the
 * session that was allowed to see it. Nothing is written to disk. The decoding itself is injected, so this store is
 * plain logic that runs the same in a test as in a browser.
 */
import { contentObject } from '../../shared/contentMedia';
import { mediaDeliveryObject } from '../../shared/mediaDelivery';

export type FrameState = { state: 'idle' | 'loading' | 'ready' | 'failed'; src: string | null };
export type FrameCapture = (url: string, at: number, signal: AbortSignal) => Promise<string>;
export const IDLE: FrameState = { state: 'idle', src: null };
const LOADING: FrameState = { state: 'loading', src: null };
const FAILED: FrameState = { state: 'failed', src: null };

/** Only recognized first-party paths have a known token-independent object identity. */
export function frameKey(url: string, base: string): string {
  const object = base ? contentObject(url, base) ?? mediaDeliveryObject(url, base) : null;
  return object ? object.key : url.split('#')[0];
}

export function createVideoFrameCache(options: { capture: FrameCapture; limit?: number; concurrency?: number; retryAfterMs?: number; now?: () => number }) {
  const limit = options.limit ?? 120, concurrency = options.concurrency ?? 2, retryAfter = options.retryAfterMs ?? 60_000, now = options.now ?? (() => Date.now());
  // insertion order is recency: a frame that just arrived sits last, so the oldest ready frame is evicted first
  const states = new Map<string, FrameState>();
  const failures = new Map<string, number>();
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const listeners = new Map<string, Set<() => void>>();
  const waiting: Array<{ key: string; url: string; at: number }> = [];
  const controllers = new Map<string, AbortController>();
  let active = 0, generation = 0;
  const notify = (key: string) => { listeners.get(key)?.forEach(listener => listener()); };
  const set = (key: string, next: FrameState) => { states.delete(key); states.set(key, next); notify(key); };
  const wanted = (key: string) => (listeners.get(key)?.size ?? 0) > 0;
  function clearRetry(key: string) {
    const timer = retryTimers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    retryTimers.delete(key);
  }
  function watchRetry(key: string) {
    const failedAt = failures.get(key);
    if (failedAt === undefined || !wanted(key) || retryTimers.has(key)) return;
    const timer = setTimeout(() => {
      retryTimers.delete(key);
      if (failures.get(key) !== failedAt) return;
      failures.delete(key); states.delete(key); notify(key);
    }, Math.max(0, failedAt + retryAfter - now()));
    retryTimers.set(key, timer);
  }
  function trim() {
    if (states.size <= limit) return;
    for (const [key, value] of states) { if (states.size <= limit) break; if (value.state !== 'loading' && !wanted(key)) { states.delete(key); failures.delete(key); clearRetry(key); } }
    for (const [key, value] of states) { if (states.size <= limit) break; if (value.state === 'ready') states.delete(key); }
  }
  function start(job: { key: string; url: string; at: number }) {
    const version = generation, controller = new AbortController();
    controllers.set(job.key, controller); active++;
    set(job.key, LOADING);
    options.capture(job.url, job.at, controller.signal).then(src => {
      if (version !== generation) return;
      failures.delete(job.key); set(job.key, { state: 'ready', src }); trim();
    }, () => {
      if (version !== generation) return;
      failures.set(job.key, now()); set(job.key, FAILED); watchRetry(job.key); trim();
    }).finally(() => {
      if (controllers.get(job.key) === controller) controllers.delete(job.key);
      if (version === generation) { active--; next(); }
    });
  }
  // a queued frame nobody is waiting for any more is dropped before it costs a download
  function next() {
    while (active < concurrency && waiting.length) {
      const job = waiting.shift()!;
      if (!wanted(job.key)) { states.delete(job.key); continue; }
      start(job);
    }
  }
  return {
    peek(key: string): FrameState { return states.get(key) ?? IDLE; },
    subscribe(key: string, listener: () => void) {
      let set = listeners.get(key);
      if (!set) listeners.set(key, set = new Set());
      set.add(listener); watchRetry(key);
      return () => { set!.delete(listener); if (!set!.size) { listeners.delete(key); clearRetry(key); trim(); } };
    },
    /** Asks for a frame once: one that is ready, loading, queued or recently failed is left alone. */
    request(key: string, url: string, at: number) {
      const current = states.get(key);
      if (current && current.state !== 'failed') return;
      const failedAt = failures.get(key);
      if (failedAt !== undefined && now() - failedAt < retryAfter) return;
      clearRetry(key); failures.delete(key);
      if (waiting.some(job => job.key === key)) return;
      waiting.push({ key, url, at }); states.set(key, LOADING); notify(key); next();
    },
    /** Forget everything: another person is signed in, or no one is. Decoding under way is abandoned. */
    reset() {
      generation++; active = 0; waiting.length = 0;
      retryTimers.forEach(clearTimeout); retryTimers.clear();
      controllers.forEach(controller => controller.abort()); controllers.clear();
      const keys = [...states.keys()]; states.clear(); failures.clear();
      keys.forEach(notify);
    },
    get size() { return states.size; },
  };
}
