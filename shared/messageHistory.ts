/** Stable message history ordering shared by phone and web. */
export type MessageCursor = { id: string; created_at: string | null };
export const MESSAGE_PAGE_SIZE = 50;

export function olderMessageFilter(cursor: MessageCursor): string {
  // Both values originate in persisted rows. Reject malformed values instead of
  // interpolating them into PostgREST's filter grammar.
  if (!cursor.created_at || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id) || !/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(cursor.created_at)) {
    throw new Error('Unable to load older messages. Reopen the conversation and try again.');
  }
  return `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`;
}

export function mergeMessagePage<T extends MessageCursor>(current: T[], incoming: T[], ascending = false): T[] {
  const byId = new Map(current.map(row => [row.id, row]));
  for (const row of incoming) byId.set(row.id, { ...byId.get(row.id), ...row });
  return [...byId.values()].sort((a, b) => {
    const time = (Date.parse(a.created_at || '') || 0) - (Date.parse(b.created_at || '') || 0);
    const fraction = (value: string | null) => ((value || '').match(/\.(\d+)/)?.[1] || '').padEnd(9, '0');
    const precision = fraction(a.created_at) < fraction(b.created_at) ? -1 : fraction(a.created_at) > fraction(b.created_at) ? 1 : 0;
    const order = time || precision || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return ascending ? order : -order;
  });
}
