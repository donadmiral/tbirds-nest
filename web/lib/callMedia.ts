const owners = new Set<symbol>();
export function acquireCallMedia(): () => void {
  const owner = Symbol('call'); owners.add(owner);
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.dataset.platinumCallActive = 'true';
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('platinum:stop-media'));
  let released = false;
  return () => {
    if (released) return; released = true; owners.delete(owner);
    if (!owners.size && typeof document !== 'undefined' && document.documentElement) delete document.documentElement.dataset.platinumCallActive;
  };
}
export function isCallMediaActive(): boolean {
  return owners.size > 0 || (typeof document !== 'undefined' && document.documentElement?.dataset.platinumCallActive === 'true');
}
