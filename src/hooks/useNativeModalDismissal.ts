import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { navigationScope } from '../lib/navigationCache';

type Visit = { bookId: string | undefined; session: string | null };
type Dismissal = { visit: Visit; complete: () => void; canComplete: () => boolean };

/** Keep an iOS modal mounted until UIKit acknowledges its dismissal. A late
 * acknowledgement cannot navigate a replacement book or account. */
export function useNativeModalDismissal(bookId: string | undefined) {
  const session = navigationScope();
  const visit = useMemo<Visit>(() => ({ bookId, session }), [bookId, session]);
  const current = useRef(visit);
  // Only a committed replacement invalidates the previous presentation. An
  // abandoned render must not change which book a native callback belongs to.
  useLayoutEffect(() => { current.current = visit; }, [visit]);
  const mounted = useRef(true);
  const pending = useRef<Dismissal | null>(null);
  const closing = useRef(false);
  const [dismissal, setDismissal] = useState<Dismissal | null>(null);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current = null; };
  }, []);

  const finish = useCallback((request: Dismissal) => {
    if (!mounted.current || pending.current !== request) return;
    pending.current = null;
    const sameSession = navigationScope() === request.visit.session;
    if (sameSession && current.current === request.visit && request.canComplete()) {
      request.complete();
    } else if (sameSession && current.current.session === request.visit.session) {
      // A replacement book/source may be shown only after the old native
      // presentation has actually closed. Never replay its pending action.
      closing.current = false;
      setDismissal(null);
    }
  }, []);

  const dismiss = useCallback((complete: () => void, cleanup: () => void, canComplete: () => boolean = () => true) => {
    if (!mounted.current || current.current !== visit || closing.current
      || navigationScope() !== visit.session) return;
    const request = { visit, complete, canComplete };
    closing.current = true;
    pending.current = request;
    setDismissal(request);
    cleanup();
    // Android does not deliver Modal.onDismiss. Its existing immediate parent
    // handoff remains correct; iOS must first complete the native transition.
    if (Platform.OS !== 'ios') finish(request);
  }, [finish, visit]);

  const onDismiss = useCallback(() => { if (dismissal) finish(dismissal); }, [dismissal, finish]);
  const isDismissing = useCallback(() => !mounted.current || closing.current
    || navigationScope() !== current.current.session, []);
  return { visible: dismissal === null, dismiss, onDismiss, isDismissing };
}
