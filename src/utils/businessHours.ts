/**
 * Opening hours.
 *
 * Stored as {"mon":[["08:00","17:00"]]}, an empty array meaning closed.
 *
 * Open-or-closed is computed on the device rather than the server, because the
 * server does not know the business's timezone and a local shop's hours are read
 * by people standing near it. This is what Google does.
 *
 * Ranges that end before they start are treated as running past midnight, so a
 * bar open 18:00 to 02:00 reads correctly.
 */
export type Hours = Record<string, string[][]>;

const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

function toMinutes(t?: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? '');
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function hasHours(hours?: Hours | null): boolean {
  if (!hours) return false;
  return KEYS.some(k => (hours[k]?.length ?? 0) > 0);
}

/** Null when there are no usable hours at all, so the UI can say nothing. */
export function openNow(hours?: Hours | null, now: Date = new Date()): boolean | null {
  if (!hasHours(hours)) return null;
  const mins = now.getHours() * 60 + now.getMinutes();
  const today = KEYS[now.getDay()];
  const yesterday = KEYS[(now.getDay() + 6) % 7];

  for (const range of hours![today] ?? []) {
    const a = toMinutes(range[0]), b = toMinutes(range[1]);
    if (a == null || b == null) continue;
    if (b > a && mins >= a && mins < b) return true;
    if (b <= a && mins >= a) return true; // runs past midnight
  }
  // A range that started yesterday and has not closed yet.
  for (const range of hours![yesterday] ?? []) {
    const a = toMinutes(range[0]), b = toMinutes(range[1]);
    if (a == null || b == null) continue;
    if (b <= a && mins < b) return true;
  }
  return false;
}

/** "Open until 17:00", "Closed, opens 08:00", or "Closed today". */
export function hoursSummary(hours?: Hours | null, now: Date = new Date()): string | null {
  if (!hasHours(hours)) return null;
  const today = KEYS[now.getDay()];
  const ranges = hours![today] ?? [];
  const open = openNow(hours, now);

  if (open) {
    const mins = now.getHours() * 60 + now.getMinutes();
    for (const r of ranges) {
      const a = toMinutes(r[0]), b = toMinutes(r[1]);
      if (a == null || b == null) continue;
      if ((b > a && mins >= a && mins < b) || (b <= a && mins >= a)) return `Open until ${r[1]}`;
    }
    return 'Open now';
  }
  if (ranges.length === 0) return 'Closed today';
  const next = ranges.find(r => (toMinutes(r[0]) ?? 0) > now.getHours() * 60 + now.getMinutes());
  return next ? `Closed, opens ${next[0]}` : 'Closed';
}

export function dayLabel(key: string): string {
  return LABELS[key] ?? key;
}

export const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];