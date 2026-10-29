import { useEffect, useRef, useState } from 'react';
import { createMemoryPlaybackClock } from './memoryPlayback';

export function useMemoryPlayback(pageKey: string, active: boolean, duration: number, onEnd: () => void) {
  const clock = useRef(createMemoryPlaybackClock());
  const callback = useRef(onEnd); callback.current = onEnd;
  const [state, setState] = useState({ pageKey, progress: 0 });
  useEffect(() => {
    const tick = () => {
      const result = clock.current.step(pageKey, Date.now(), active, duration);
      setState({ pageKey, progress: result.progress });
      if (result.end) callback.current();
    };
    tick();
    const timer = active ? setInterval(tick, 100) : undefined;
    return () => { clearInterval(timer); clock.current.pause(); };
  }, [pageKey, active, duration]);
  return state.pageKey === pageKey ? state.progress : 0;
}
