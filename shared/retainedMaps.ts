/** Preserve identity when a bounded reader's enrichment is already in range. */
export function retainRecord<T>(record: Record<string, T>, ids: ReadonlySet<string>): Record<string, T> {
  const keys = Object.keys(record);
  if (keys.every(key => ids.has(key))) return record;
  return Object.fromEntries(keys.filter(key => ids.has(key)).map(key => [key, record[key]]));
}

/** A global watermark fences old responses after their per-ID mutation stamps
 * leave memory. The protected set holds the current rows and open overlays. */
export function retainStamps(record: Record<string, number>, protectedIds: ReadonlySet<string>, maximum = 500) {
  const entries = Object.entries(record);
  if (entries.length <= maximum) return { values: record, floor: -1 };
  const retained = new Set(entries.filter(([id]) => protectedIds.has(id)).map(([id]) => id));
  for (const [id] of [...entries].sort((a, b) => b[1] - a[1])) { if (retained.size >= maximum) break; retained.add(id); }
  let floor = -1;
  for (const [id, at] of entries) if (!retained.has(id)) floor = Math.max(floor, at);
  return { values: retainRecord(record, retained), floor };
}
