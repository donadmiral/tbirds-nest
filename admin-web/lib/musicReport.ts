export type MusicUsageRow = {
  day: string; event_type: string; provider_id: string; provider_track_id: string | null;
  title: string; use_kind: string; territory: string; operations: string;
};
export function musicReportWindow(start: string | null, end: string | null): { start: string; end: string } | null {
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const first = new Date(`${start}T00:00:00.000Z`), last = new Date(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime())
    || first.toISOString().slice(0, 10) !== start || last.toISOString().slice(0, 10) !== end
    || last.getTime() <= first.getTime() || last.getTime() - first.getTime() > 31 * 86400000) return null;
  return { start: first.toISOString(), end: last.toISOString() };
}
function cell(value: string | null): string {
  const text = value ?? '';
  // Treat external titles/identifiers as text in spreadsheet applications.
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function musicUsageCsv(rows: MusicUsageRow[]): string {
  const header = ['UTC day', 'Server operation', 'Provider', 'Provider track', 'Title', 'Use', 'Verified territory', 'Operation count'];
  return '\uFEFF' + [header, ...rows.map(row => [row.day, row.event_type, row.provider_id, row.provider_track_id, row.title, row.use_kind, row.territory, row.operations])]
    .map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
