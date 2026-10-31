export type DeskSearch = { page?: string | string[]; q?: string | string[] };

export const DESK_PAGE_SIZE = 25;
const READ_CONCURRENCY = 4;

/** Counts stay exact in the interface, including totals above compact-format thresholds. */
export function formatCount(value: number) { return value.toLocaleString('en-US'); }

/** A missing count is an unavailable report, never a zero or the fetched page size. */
export function exactCount(result: { count: number | null; error: unknown }, message: string): number {
  if (result.error || !Number.isSafeInteger(result.count) || result.count === null || result.count < 0) {
    throw new Error(message);
  }
  return result.count;
}

export function recordPage(value: DeskSearch['page'], total: number) {
  const requested = typeof value === 'string' && /^\d{1,6}$/.test(value) ? Math.max(1, Number(value)) : 1;
  const pages = Math.max(1, Math.ceil(total / DESK_PAGE_SIZE));
  const page = Math.min(requested, pages);
  const from = (page - 1) * DESK_PAGE_SIZE;
  return { page, pages, from, to: from + DESK_PAGE_SIZE - 1, total };
}

export function recordPageHref(path: string, page: number, query = '') {
  const search = new URLSearchParams();
  if (page > 1) search.set('page', String(page));
  if (query) search.set('q', query);
  return path + (search.size ? '?' + search.toString() : '');
}

export function jobTitleQuery(value: DeskSearch['q']): string {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

/** Escape PostgreSQL regex syntax for literal, case-insensitive substring search.
 * imatch avoids PostgREST's LIKE asterisk-to-percent wildcard substitution. */
export function jobTitlePattern(query: string) {
  return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Page before related reads; stop scheduling new work if one required read fails. */
export async function mapReportReads<T, R>(values: T[], read: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0, failed = false;
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, values.length) }, async () => {
    while (!failed && cursor < values.length) {
      const index = cursor++;
      try { results[index] = await read(values[index]); }
      catch (error) { failed = true; throw error; }
    }
  }));
  return results;
}
