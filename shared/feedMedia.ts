/** Reuse still-valid in-memory capabilities when paging. Never persist this metadata. */
export async function renewFeedMedia<T extends object>(rows: T[], hydrate: (rows: T[]) => Promise<T[]>, now = Date.now()): Promise<T[]> {
  const needsRefresh = (row: T) => {
    const expiry = (row as { _mediaExpiresAt?: unknown })._mediaExpiresAt;
    return typeof expiry !== 'number' || !Number.isFinite(expiry) || expiry <= now + 60_000 || expiry > now + 300_000;
  };
  const stale = rows.filter(needsRefresh);
  if (!stale.length) return rows;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Bound the complete batch, not only each individual signer request.
    const refreshed = await Promise.race([hydrate(stale), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Media could not be refreshed. Please try again.')), 12_000);
    })]);
    if (refreshed.length !== stale.length) throw new Error('Media could not be refreshed. Please try again.');
    let index = 0;
    return rows.map(row => needsRefresh(row) ? refreshed[index++] : row);
  } finally { if (timer) clearTimeout(timer); }
}
