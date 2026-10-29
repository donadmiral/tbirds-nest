import { createMemoryPlaybackClock } from './memoryPlayback';

/** Each app supplies hooks from its own React installation. No React dependency escapes into shared/. */
export type MemoryPlaybackHooks = {
  useRef<T>(initialValue: T): { current: T };
  useState<T>(initialValue: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void];
  useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]): void;
};

export function createMemoryPlaybackHook({ useEffect, useRef, useState }: MemoryPlaybackHooks) {
  return function useMemoryPlayback(pageKey: string, active: boolean, duration: number, onEnd: () => void) {
    const clock = useRef<ReturnType<typeof createMemoryPlaybackClock> | null>(null);
    if (!clock.current) clock.current = createMemoryPlaybackClock();
    const callback = useRef(onEnd); callback.current = onEnd;
    const [state, setState] = useState({ pageKey, progress: 0 });
    useEffect(() => {
      const playbackClock = clock.current!;
      const tick = () => {
        const result = playbackClock.step(pageKey, Date.now(), active, duration);
        setState({ pageKey, progress: result.progress });
        if (result.end) callback.current();
      };
      tick();
      const timer = active ? setInterval(tick, 100) : undefined;
      return () => { clearInterval(timer); playbackClock.pause(); };
    }, [pageKey, active, duration]);
    return state.pageKey === pageKey ? state.progress : 0;
  };
}
