// Several clips may show independent book pickers after one story publication.
// Refresh their server-backed shelves together without sharing story selection.
const listeners = new Set<(ownerId: string) => void>();

export function onMemoryBookShelfChanged(ownerId: string, refresh: () => void) {
  const listener = (changedOwner: string) => { if (changedOwner === ownerId) refresh(); };
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyMemoryBookShelfChanged(ownerId: string) {
  for (const listener of listeners) listener(ownerId);
}
