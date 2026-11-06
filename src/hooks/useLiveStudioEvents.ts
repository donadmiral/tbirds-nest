import { useEffect, useRef } from 'react';
import { subscribeLiveControl } from '../services/liveControlEvents';

/** The host must receive provider-confirmed state even when Chat is not open. */
export function useLiveStudioEvents(sessionId: string, owner: string | null, onChanged: () => void) {
  const latest = useRef(onChanged);
  latest.current = onChanged;
  useEffect(() => {
    if (!owner) return;
    let active = true;
    const unsubscribe = subscribeLiveControl(sessionId, owner, event => {
      if (active && (event === 'session' || event === 'access_changed')) latest.current();
    });
    return () => { active = false; unsubscribe(); };
  }, [sessionId, owner]);
}
