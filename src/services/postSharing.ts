import { supabase } from './supabase';
import { useNetStore, waitForOutboxHydration } from '../stores/netStore';
import { deliverMessage, makeMessageId, type MessageDelivery } from '../../shared/messageDelivery';

const inFlight = new Map<string, Promise<MessageDelivery>>();
export function sharePostToConversation(actor: string, post: string, conversation: string, receiver: string | null): Promise<MessageDelivery> {
  const key = [actor, post, conversation, receiver].join(':');
  const existing = inFlight.get(key);
  if (existing) return existing;
  const operation = (async () => {
    await waitForOutboxHydration();
    const { data, error } = await supabase.auth.getSession();
    if (error || data.session?.user.id !== actor) throw new Error('Sign in again before sharing.');
    const previous = useNetStore.getState().outbox.find(row => row.owner_auth_id === actor && row.sender_id === actor
      && row.shared_post_id === post && row.conversation_id === conversation && row.receiver_id === receiver);
    const intent = { id: previous?.id ?? makeMessageId(), sender_id: actor, conversation_id: conversation,
      receiver_id: receiver, shared_post_id: post, text: null, media_url: null, media_type: null,
      thumbnail_url: null, reply_to_id: null, view_limit: null };
    if (!previous) await useNetStore.getState().enqueue({ ...intent, owner_auth_id: actor });
    const current = await supabase.auth.getSession();
    if (current.error || current.data.session?.user.id !== actor) return { status: 'pending' } as const;
    const result = await deliverMessage(supabase, intent, true);
    if (result.status === 'confirmed') useNetStore.getState().confirmOutboxMessage(intent.id, result.row);
    else useNetStore.getState().setOutboxFailed(intent.id, result.status !== 'pending');
    return result;
  })().finally(() => { inFlight.delete(key); });
  inFlight.set(key, operation);
  return operation;
}
