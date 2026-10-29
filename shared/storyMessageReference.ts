import type { MessageIntent } from './messageDelivery';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseStoryMessageReference(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 160) return null;
  try {
    const value = JSON.parse(raw);
    return value?.pcStory === 1 && typeof value.storyId === 'string' && UUID.test(value.storyId) ? value.storyId : null;
  } catch { return null; }
}

/** A story reference carries no private media URL or copied preview. The
 * recipient must open the normal authorized story route, including expiry. */
export async function prepareStoryReply(
  client: { from(name: string): any; rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> },
  options: { senderId: string; storyId: string; text: string; assertCurrent: () => void },
): Promise<Omit<MessageIntent, 'id'>> {
  const { senderId, storyId, assertCurrent } = options;
  const text = options.text.trim();
  if (!UUID.test(storyId) || !text) throw new Error('Write a reply to an available story.');
  assertCurrent();
  const { data: story, error } = await client.from('stories').select('id,user_id,allow_replies,expires_at').eq('id', storyId).maybeSingle();
  assertCurrent();
  if (error || !story || !story.user_id || story.user_id === senderId || story.allow_replies === false
    || (story.expires_at && Date.parse(story.expires_at) <= Date.now())) {
    throw new Error('This story is no longer available for replies.');
  }
  const conversation = await client.rpc('start_dm_ctx', { p_receiver_id: story.user_id, p_context: 'personal', p_ref_id: null });
  assertCurrent();
  if (conversation.error || typeof conversation.data !== 'string' || !UUID.test(conversation.data)) {
    throw new Error('The conversation could not be opened. Please try again.');
  }
  return {
    conversation_id: conversation.data, sender_id: senderId, receiver_id: story.user_id,
    text: `Replied to your story:\n${text}`, media_url: JSON.stringify({ pcStory: 1, storyId }),
    media_type: 'link', thumbnail_url: null, reply_to_id: null, view_limit: null,
  };
}
