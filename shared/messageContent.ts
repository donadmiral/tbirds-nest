export type ForwardableMessage = {
  deleted_at?: string | null;
  payment_id?: string | null;
  is_system_message?: boolean;
  view_limit?: number | null;
  media_type?: string | null;
};

/** Financial/system events and limited-view attachments cannot be replayed as ordinary messages. */
export function canForwardMessage(message: ForwardableMessage): boolean {
  return !message.deleted_at && !message.payment_id && !message.is_system_message && !message.view_limit
    && (!message.media_type || ['image', 'video', 'audio', 'voice', 'gif', 'sticker', 'document'].includes(message.media_type));
}
