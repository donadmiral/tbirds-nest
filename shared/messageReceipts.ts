export type ConversationReadTarget = { conversationId: string; userId: string; isGroup: boolean };

export type GroupReadWatermark = { user_id: string; last_read_at: string | null };

/** The same server watermarks drive bubble status and the latest-message
 * summary. A new message must not inherit an older message's seen count. */
export function groupReadersForMessage(
  rows: GroupReadWatermark[],
  message: { sender_id?: string | null; created_at?: string | null } | undefined,
  viewerId: string | null,
): string[] {
  if (!viewerId || message?.sender_id !== viewerId || !message.created_at) return [];
  const sentAt = Date.parse(message.created_at);
  if (!Number.isFinite(sentAt)) return [];
  return [...new Set(rows.filter(row => row.user_id !== viewerId && row.last_read_at
    && Date.parse(row.last_read_at) > sentAt).map(row => row.user_id))];
}

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
