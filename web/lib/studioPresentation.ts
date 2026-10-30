/** Presentation helpers shared by the Studio table and its download action. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function studioCsv(headers: string[], rows: unknown[][]): string {
  return "\ufeff" + [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
export function downloadStudioCsv(name: string, headers: string[], rows: unknown[][]): void {
  const url = URL.createObjectURL(new Blob([studioCsv(headers, rows)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function campaignMatches(campaign: {name: string;status: string;objective: string}, query: string, status: string, objective: string): boolean {
  return (!query.trim() || campaign.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && (status === "all" || campaign.status === status) && (objective === "all" || campaign.objective === objective);
}
export function safePublicWebsite(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
