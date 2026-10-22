export type SupportSearch = { page?: string | string[]; q?: string | string[]; status?: string | string[] };

export const SUPPORT_PAGE_SIZE = 25;
export const SUPPORT_MESSAGE_PAGE_SIZE = 100;
export const SUPPORT_STATUSES = ['all', 'open', 'pending', 'solved', 'appeal'] as const;

export function supportPage(value: string | string[] | undefined): number {
  return typeof value === 'string' && /^\d{1,6}$/.test(value) ? Math.max(1, Number(value)) : 1;
}

export function supportSearch(input: SupportSearch) {
  return {
    page: supportPage(input.page),
    q: typeof input.q === 'string' ? input.q.trim().slice(0, 120) : '',
    status: typeof input.status === 'string' && SUPPORT_STATUSES.includes(input.status as typeof SUPPORT_STATUSES[number]) ? input.status : 'open',
  };
}

/** Treat search as literal text, not a PostgreSQL LIKE wildcard expression. */
export function supportSubjectPattern(query: string) {
  return '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
}

export function supportHref(page: number, q: string, status: string) {
  const params = new URLSearchParams({ status });
  if (page > 1) params.set('page', String(page));
  if (q) params.set('q', q);
  return '/support?' + params.toString();
}

/** Keep per-ticket reads bounded while obtaining a true latest message and count. */
export async function supportMap<T, R>(values: T[], read: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(5, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await read(values[index]);
    }
  }));
  return results;
}
