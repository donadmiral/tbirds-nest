// Several clips may show independent book pickers after one story publication.
// Refresh their server-backed shelves together without sharing story selection.
const listeners = new Set<(ownerId: string) => void>();
let revision = 0;
const revisions = new Map<string, number>();
const rememberRevision = (ownerId: string, value: number) => {
  revisions.delete(ownerId); revisions.set(ownerId, value);
  if (revisions.size > 32) revisions.delete(revisions.keys().next().value!);
  return value;
};

/** Also invalidates remembered shelves when a successful edit occurs off-route. */
export const memoryBookShelfRevision = (ownerId: string) => rememberRevision(ownerId, revisions.get(ownerId) ?? revision);

export function onMemoryBookShelfChanged(ownerId: string, refresh: () => void) {
  const listener = (changedOwner: string) => { if (changedOwner === ownerId) refresh(); };
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyMemoryBookShelfChanged(ownerId: string) {
  revision++;
  rememberRevision(ownerId, revision);
  for (const listener of listeners) listener(ownerId);
}
