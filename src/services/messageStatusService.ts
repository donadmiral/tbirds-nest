import { supabase } from './supabase';

/**
 * Read-receipt and read-tracking service.
 *
 * Two concerns:
 *  1. messages.delivered_at / viewed_at. DM-only receipt columns. Drive the
 *     "Delivered" / "Read HH:MM" status line under outgoing DM bubbles.
 *  2. message_reads. Per-user row (message_id, user_id, read_at). The source
 *     of truth for unread counts in ConversationsScreen. Works for both DMs
 *     and groups. Populated exclusively via the mark_conversation_read RPC.
 */
export const messageStatusService = {
  /**
   * Flip delivered_at on every incoming message in a conversation.
   * DM-shaped update. No-op for group messages (receiver_id is null, but we
   * do not filter by receiver_id here so this still serves to mark a DM
   * recipient's messages as delivered when ChatScreen first mounts).
   */
  async markConversationDelivered(conversationId: string, currentUserId: string) {
    const { error } = await supabase
      .from('messages')
      .update({ delivered_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .neq('sender_id', currentUserId)
      .is('delivered_at', null);

    if (error) throw error;
  },

  /**
   * Mark the entire conversation read for the current user.
   * Writes message_reads rows (drives group + DM unread badges) AND keeps
   * messages.viewed_at / delivered_at populated for DM receipts, in a single
   * atomic server-side call.
   *
   * Call this from ChatScreen when the chat becomes visible.
   */
  async markConversationViewed(conversationId: string, currentUserId: string) {
    const { error } = await supabase.rpc('mark_conversation_read', {
      p_conversation_id: conversationId,
      p_user_id: currentUserId,
    });
    if (error) throw error;
  },

  /**
   * Last outgoing message status for the "Delivered" / "Read" line in
   * ChatScreen. Unchanged.
   */
  async getLastOutgoingMessageStatus(conversationId: string, currentUserId: string) {
    const { data, error } = await supabase
      .from('messages')
      .select('id, delivered_at, viewed_at, created_at')
      .eq('conversation_id', conversationId)
      .eq('sender_id', currentUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  },
};