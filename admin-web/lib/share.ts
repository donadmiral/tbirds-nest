/**
 * Share and Present - the transfer layer.
 * Anything an admin finds on a desk can leave the dashboard as a file, a
 * briefing or a deck. The tray lives in localStorage so items survive
 * navigation between desks; nothing here touches the database.
 */

export type TrayKind = 'stat' | 'table' | 'note';

export type TrayItem = {
  id: string;
  kind: TrayKind;
  title: string;
  subtitle?: string;
  /** desk label, e.g. Payments */
  page: string;
  /** route the item came from, so the deck can cite its source */
  path: string;
  createdAt: string;
  stat?: { value: string; delta?: string; note?: string };
  table?: { columns: string[]; rows: string[][]; total: number; filters: string[] };
  note?: { text: string };
};

const KEY = 'pc-present-tray';
export const TRAY_EVENT = 'pc-tray-changed';

export function trayRead(): TrayItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrayItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function trayWrite(items: TrayItem[]) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, 40))); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(TRAY_EVENT));
}

export function trayAdd(item: Omit<TrayItem, 'id' | 'createdAt'>): number {
  const items = trayRead();
  items.push({ ...item, id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: new Date().toISOString() });
  trayWrite(items);
  return items.length;
}

export function trayRemove(id: string) {
  trayWrite(trayRead().filter(i => i.id !== id));
}

export function trayClear() {
  trayWrite([]);
}

/** RFC-4180 enough for Excel, Numbers and Sheets. */
export function csv(columns: string[], rows: string[][]): string {
  const esc = (v: string) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\r\n');
}

export function downloadText(filename: string, mime: string, text: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

/** 2026-08-29-1042, so files sort by when they were taken. */
export function stamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

export function slug(s: string): string {
  return (s || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
}

export function whenLong(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Columns whose contents identify a person or a rail. External briefings mask
 * them; internal ones keep them. Matching is on the header, so a desk never
 * has to declare anything.
 */
const SENSITIVE = /(e-?mail|phone|msisdn|user ?id|uid|ip\b|wallet|bank|account no|iban|tx|reference|token|address|passport|national id)/i;

export function isSensitiveColumn(header: string): boolean {
  return SENSITIVE.test(header || '');
}

export function maskRow(columns: string[], row: string[]): string[] {
  return row.map((v, i) => (isSensitiveColumn(columns[i] || '') ? '\u2022\u2022\u2022\u2022\u2022\u2022' : v));
}
