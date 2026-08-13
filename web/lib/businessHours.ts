// Port of src/utils/businessHours.ts — open/closed is computed on the
// device because the server does not know the shop's timezone.
export type Hours = Record<string, [string, string][]>;

const KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_LABEL: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function hasHours(hours?: Hours | null): boolean {
  return !!hours && Object.values(hours).some((d) => Array.isArray(d) && d.length > 0);
}

export function openNow(hours?: Hours | null, now: Date = new Date()): boolean | null {
  if (!hasHours(hours)) return null;
  const mins = now.getHours() * 60 + now.getMinutes();
  const today = KEYS[now.getDay()];
  const yesterday = KEYS[(now.getDay() + 6) % 7];
  for (const range of hours![today] ?? []) {
    const a = toMinutes(range[0]), b = toMinutes(range[1]);
    if (a == null || b == null) continue;
    if (b > a && mins >= a && mins < b) return true;
    if (b <= a && mins >= a) return true;
  }
  for (const range of hours![yesterday] ?? []) {
    const a = toMinutes(range[0]), b = toMinutes(range[1]);
    if (a == null || b == null) continue;
    if (b <= a && mins < b) return true;
  }
  return false;
}

export function todaySummary(hours?: Hours | null, now: Date = new Date()): string | null {
  if (!hasHours(hours)) return null;
  const today = hours![KEYS[now.getDay()]] ?? [];
  if (today.length === 0) return "Closed today";
  const open = openNow(hours, now);
  if (open) {
    const mins = now.getHours() * 60 + now.getMinutes();
    for (const r of today) {
      const a = toMinutes(r[0]), b = toMinutes(r[1]);
      if (a == null || b == null) continue;
      if ((b > a && mins >= a && mins < b) || (b <= a && mins >= a)) return "Open until " + r[1];
    }
    return "Open now";
  }
  return "Opens " + today[0][0];
}