export type ConversationReadTarget = { conversationId: string; userId: string; isGroup: boolean };

export function canMarkConversationRead(state: {
  foreground: boolean;
  focused: boolean;
  atLatest: boolean;
  loaded: boolean;
}): boolean {
  return state.foreground && state.focused && state.atLatest && state.loaded;
}

/** Keep the DM receipt and group watermark contracts separate. Calling v2
 * before the DM RPC sets read_at first and prevents delivered_at/viewed_at
 * from being populated by the DM RPC's unread-row predicate. */
export async function acknowledgeConversationRead(
  client: { rpc(name: string, args: Record<string, string>): PromiseLike<{ error: unknown }> },
  target: ConversationReadTarget,
): Promise<void> {
  const { error } = target.isGroup
    ? await client.rpc('mark_conversation_read_v2', { p_conversation_id: target.conversationId })
    : await client.rpc('mark_conversation_read', { p_conv_id: target.conversationId, p_user_id: target.userId });
  if (error) throw new Error('Read status could not be saved.');
}

/** The server returns `unread`. Older deployments used `unread_count`.
 * Multiple rows can describe the same conversation, so preserve their sum. */
export function conversationUnreadCounts(rows: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!Array.isArray(rows)) return counts;
  for (const row of rows) {
    if (!row || typeof row.conversation_id !== 'string') continue;
    const count = Number(row.unread ?? row.unread_count);
    if (!Number.isFinite(count) || count < 0) continue;
    counts[row.conversation_id] = (counts[row.conversation_id] || 0) + Math.floor(count);
  }
  return counts;
}
