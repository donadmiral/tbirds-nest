import { enqueueMessage, readOutbox, sendOutboxMessage } from './messageOutbox';
const inFlight = new Map<string, ReturnType<typeof sendOutboxMessage>>();

/** Retry a saved share instead of creating a second message after a lost response. */
export function sharePostToConversation(
  client: Parameters<typeof sendOutboxMessage>[0],
  actor: string, post: string, conversation: string, receiver: string | null,
) {
  const key = [actor, post, conversation, receiver].join(':');
  const running = inFlight.get(key);
  if (running) return running;
  const operation = (async () => {
  const { data, error } = await client.auth.getSession();
  if (error || data?.session?.user?.id !== actor) throw new Error('Sign in again before sharing.');
  const existing = readOutbox(actor, conversation).find(row => row.shared_post_id === post && row.receiver_id === receiver);
  const message = existing ?? enqueueMessage({
    sender_id: actor, conversation_id: conversation, receiver_id: receiver, shared_post_id: post,
    text: null, media_url: null, media_type: null, thumbnail_url: null, reply_to_id: null, view_limit: null,
  });
  return sendOutboxMessage(client, message);
  })().finally(() => { inFlight.delete(key); });
  inFlight.set(key, operation);
  return operation;
}
