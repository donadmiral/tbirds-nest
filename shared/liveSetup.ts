export type LiveStartMode = 'now' | 'later';
const pad = (value: number) => String(value).padStart(2, '0');

/** Local calendar fields avoid implementation-dependent parsing on Hermes/Safari. */
export function defaultLiveSchedule(now = Date.now()): { date: string; time: string } {
  const value = new Date(Math.ceil((now + 60 * 60 * 1000) / 900000) * 900000);
  return { date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}` };
}

/** Immediate mode deliberately ignores a previously entered schedule. */
export function liveScheduledAt(mode: LiveStartMode, date: string, time: string, now = Date.now()): string | null {
  if (mode === 'now') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error('Choose a date (YYYY-MM-DD) and time (HH:MM) for your live.');
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const value = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (year < 2000 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59
    || value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day
    || value.getHours() !== hour || value.getMinutes() !== minute || !Number.isFinite(value.getTime())) {
    throw new Error('Choose a valid local date and time.');
  }
  if (value.getTime() <= now) throw new Error('Choose a future date and time.');
  if (value.getTime() > now + 366 * 86400000) throw new Error('Schedule your live within the next 366 days.');
  return value.toISOString();
}

export function liveLocalTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your device time'; }
  catch { return 'your device time'; }
}
