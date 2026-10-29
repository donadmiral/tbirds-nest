/** Financial totals stay in integer minor units until chart-only conversion. */
export function decimalMinor(value: string | number): bigint {
  const raw = String(value); const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) throw new Error('Invalid monetary amount');
  const minor = BigInt(match[2]) * BigInt(100) + BigInt((match[3] || '').padEnd(2, '0'));
  return match[1] ? -minor : minor;
}
export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  // Quoting alone does not stop Excel/Sheets from executing a formula.
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}
export function receiptCsv(rows: (string | number | null)[][]): string {
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
