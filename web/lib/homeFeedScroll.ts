import type { createHomeFeedController, FeedScrollRestore } from './homeFeedController';

type Controller = Pick<ReturnType<typeof createHomeFeedController>, 'getSnapshot' | 'finishScrollRestore'>;

/** Restore a cached mode or route before paint when its retained layout is ready. */
export function restoreHomeFeedScroll(controller: Controller, element: () => HTMLElement | null, request: FeedScrollRestore) {
  const href = window.location.href;
  const started = performance.now();
  let active = true, readyAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observedTop = window.scrollY;
  const maxTop = () => Math.max(0, Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) - window.innerHeight);
  const finish = () => {
    if (!active) return;
    active = false;
    if (timer !== undefined) clearTimeout(timer);
    intentEvents.forEach(name => window.removeEventListener(name, finish, true));
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('popstate', finish);
    window.removeEventListener('pagehide', finish);
    document.removeEventListener('visibilitychange', onVisibility);
    controller.finishScrollRestore(request.id);
  };
  const onVisibility = () => { if (document.visibilityState !== 'visible') finish(); };
  const onScroll = () => {
    const top = window.scrollY;
    // A shorter destination can cause a browser clamp before its media loads.
    // Other movement (including route scroll restoration) takes precedence.
    const available = maxTop();
    const clamped = observedTop > available && Math.abs(top - available) <= 1;
    if (top !== observedTop && !clamped) finish();
    observedTop = top;
  };
  const intentEvents = ['pointerdown', 'touchstart', 'wheel', 'keydown', 'click'] as const;
  intentEvents.forEach(name => window.addEventListener(name, finish, { capture: true, passive: true }));
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('popstate', finish);
  window.addEventListener('pagehide', finish);
  document.addEventListener('visibilitychange', onVisibility);
  const tick = () => {
    if (!active) return;
    const state = controller.getSnapshot(), root = element(), now = performance.now();
    if (state.scrollRestore?.id !== request.id || state.owner !== request.owner || state.mode !== request.mode ||
      window.location.href !== href || document.visibilityState !== 'visible' || !root?.isConnected || now - started >= 14_000) {
      finish(); return;
    }
    if (!state.loading && root.dataset.feedOwner === request.owner && root.dataset.feedMode === request.mode) {
      readyAt ??= now;
      const available = maxTop();
      if (available >= request.top || now - readyAt >= 2_000) {
        const top = Math.min(request.top, available);
        finish();
        window.scrollTo({ top, left: window.scrollX, behavior: 'instant' });
        return;
      }
    }
    timer = setTimeout(tick, 100);
  };
  // The caller runs in a layout effect. A ready retained view must not paint at
  // the route's default offset first; only incomplete media height needs a retry.
  tick();
  return finish;
}
