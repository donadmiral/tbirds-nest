/**
 * Share and Present - the transfer layer.
 * Anything an admin finds on a desk can leave the dashboard as a file, a
 * briefing or a deck. The tray belongs to the current staff identity and role
 * in this browser tab. It survives navigation, not a shared global cache.
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

const KEY = 'pc-present-tray-v2';
const MAX_ITEMS = 40;
export const TRAY_EVENT = 'pc-tray-changed';

function storageKey(): string | null {
  if (typeof document === 'undefined') return null;
  const staff = document.querySelector('[data-pc-staff]')?.getAttribute('data-pc-staff');
  return staff && /^[a-zA-Z0-9_:-]{1,160}$/.test(staff) ? `${KEY}:${staff}` : null;
}

const text = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length <= max;
const strings = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length <= max && value.every(item => text(item));

function validItem(value: unknown): value is TrayItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<TrayItem>;
  if (!text(item.id, 80) || !text(item.title) || !text(item.page, 200) || !text(item.path, 2000)
    || !item.path.startsWith('/') || item.path.startsWith('//') || !text(item.createdAt, 40)
    || !Number.isFinite(Date.parse(item.createdAt)) || (item.subtitle !== undefined && !text(item.subtitle))) return false;
  if (item.kind === 'note') return !!item.note && text(item.note.text, 10000);
  if (item.kind === 'stat') return !!item.stat && text(item.stat.value)
    && (item.stat.delta === undefined || text(item.stat.delta)) && (item.stat.note === undefined || text(item.stat.note));
  if (item.kind === 'table') {
    const table = item.table;
    return !!table && strings(table.columns, 30) && Array.isArray(table.rows) && table.rows.length <= 60
      && table.rows.every(row => strings(row, 30) && row.length === table.columns.length)
      && Number.isSafeInteger(table.total) && table.total >= table.rows.length && strings(table.filters, 20);
  }
  return false;
}

export function trayRead(): TrayItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const key = storageKey();
    const raw = key ? window.sessionStorage.getItem(key) : null;
    if (!raw || raw.length > 1000000) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(validItem).slice(0, MAX_ITEMS) : [];
  } catch { return []; }
}

export function trayWrite(items: TrayItem[]) {
  const key = storageKey();
  if (!key) throw new Error('Refresh your staff workspace before collecting presentation items.');
  if (items.length > MAX_ITEMS) throw new Error('Your presentation holds 40 items. Remove an item before adding another.');
  if (!items.every(validItem)) throw new Error('This item cannot be added to the presentation. Export the table from its desk instead.');
  const serialized = JSON.stringify(items);
  if (serialized.length > 1000000) throw new Error('This presentation is too large. Remove a table before adding another.');
  try {
    window.sessionStorage.setItem(key, serialized);
    if (window.sessionStorage.getItem(key) !== serialized) throw new Error();
  } catch { throw new Error('Browser storage is unavailable. Allow storage and try again.'); }
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

/** Quote CSV controls and neutralize executable spreadsheet formulas. */
export function csv(columns: string[], rows: string[][]): string {
  const esc = (v: string) => {
    const value = String(v ?? '');
    const s = /^[\s\uFEFF]*[=+\-@]/.test(value) ? "'" + value : value;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
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
