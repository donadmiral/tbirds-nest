import type { SupabaseClient } from '@supabase/supabase-js';
import type { Conv, Msg } from './messages';
import { canForwardMessage } from '../../shared/messageContent';
export { canForwardMessage } from '../../shared/messageContent';

export async function editMessage(client: SupabaseClient, message: Msg, userId: string, text: string): Promise<Msg> {
  const clean = text.trim();
  if (!clean || message.sender_id !== userId || message.deleted_at || message.media_type || message.shared_post_id || message.payment_id || message.is_system_message) {
    throw new Error('This message cannot be edited.');
  }
  const { data, error } = await client.from('messages')
    .update({ text: clean, edited_at: new Date().toISOString() })
    .eq('id', message.id).eq('conversation_id', message.conversation_id).eq('sender_id', userId).is('deleted_at', null)
    .select('*').single();
  if (error || !data) throw new Error('Your edit could not be saved. Please try again.');
  return data as Msg;
}

export async function reactToMessage(client: SupabaseClient, messageId: string, userId: string, emoji: string): Promise<void> {
  const { data, error } = await client.from('message_reactions').select('id, emoji').eq('message_id', messageId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Reactions could not be loaded. Please try again.');
  const result = data
    ? data.emoji === emoji
      ? await client.from('message_reactions').delete().eq('id', data.id).eq('user_id', userId)
      : await client.from('message_reactions').update({ emoji }).eq('id', data.id).eq('user_id', userId)
    : await client.from('message_reactions').insert({ message_id: messageId, user_id: userId, emoji });
  if (result.error) throw new Error('Your reaction could not be saved. Please try again.');
}

export async function pinMessage(client: SupabaseClient, conversationId: string, messageId: string | null): Promise<void> {
  const { error } = await client.rpc('set_pinned_message', { p_conversation_id: conversationId, p_message_id: messageId });
  if (error) throw new Error('This message could not be pinned. Your conversation role may not allow it.');
}

export async function forwardMessage(client: SupabaseClient, message: Msg, destination: Conv, userId: string): Promise<Msg> {
  // Fetch the stored attachment reference; a rendered signed URL expires and must never be persisted in the forward.
  const { data: source, error: readError } = await client.from('messages').select('*')
    .eq('id', message.id).eq('conversation_id', message.conversation_id).single();
  if (readError || !source || !canForwardMessage(source as Msg)) throw new Error('This message is no longer available to forward.');
  const { data, error } = await client.from('messages').insert({
    conversation_id: destination.id, sender_id: userId, receiver_id: destination.is_group ? null : destination.other_id,
    text: source.text, media_url: source.media_url, media_type: source.media_type, thumbnail_url: source.thumbnail_url ?? null,
    shared_post_id: source.shared_post_id ?? null, reply_to_id: null, forwarded_from_id: source.id,
  }).select('*').single();
  if (error || !data) throw new Error('Your message could not be forwarded. Please try again.');
  return data as Msg;
}
