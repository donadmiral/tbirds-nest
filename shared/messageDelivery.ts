/** A chosen message ID is reused after an uncertain network response. */
export type MessageIntent = {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string | null;
  text: string | null;
  media_url: string | null;
  media_type: string | null;
  thumbnail_url: string | null;
  reply_to_id: string | null;
  view_limit: number | null;
  shared_post_id?: string | null;
};
type Client = { from(name: string): any };
export type MessageReceipt = MessageIntent & { created_at: string; [key: string]: unknown };
export type MessageDelivery = { status: 'confirmed'; row: MessageReceipt } | { status: 'pending' | 'rejected' | 'conflict' };
const fields = ['id','conversation_id','sender_id','receiver_id','text','media_url','media_type','thumbnail_url','reply_to_id','view_limit','shared_post_id'] as const;

export function makeMessageId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function matches(row: any, intent: MessageIntent): row is MessageReceipt {
  return !!row && typeof row.created_at === 'string' && Number.isFinite(Date.parse(row.created_at)) && fields.every(field => (row[field] ?? null) === (intent[field] ?? null));
}

async function bounded(query: any): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try { return await query.abortSignal(controller.signal); }
  finally { clearTimeout(timer); }
}

export async function deliverMessage(client: Client, intent: MessageIntent, reconcileFirst = false): Promise<MessageDelivery> {
  const reconcile = async (): Promise<MessageDelivery | null> => {
    try {
      const { data, error } = await bounded(client.from('messages').select('*').eq('id', intent.id)
        .eq('sender_id', intent.sender_id).eq('conversation_id', intent.conversation_id).maybeSingle());
      if (error) return { status: 'pending' };
      if (!data) return null;
      return matches(data, intent) ? { status: 'confirmed', row: data } : { status: 'conflict' };
    } catch { return { status: 'pending' }; }
  };
  if (reconcileFirst) {
    const existing = await reconcile();
    if (existing) return existing;
  }
  let code: string | undefined;
  try {
    const { data, error } = await bounded(client.from('messages').insert([intent]).select('*').single());
    if (!error && matches(data, intent)) return { status: 'confirmed', row: data };
    code = error?.code;
  } catch { /* A lost response is not evidence that the insert failed. */ }
  const existing = await reconcile();
  if (existing) return existing;
  // Explicit SQL rejection is safe to report as unsent. Transport and gateway
  // errors stay queued with the original ID, even when an immediate read is empty.
  return { status: code && /^(22|23|42|P0001)/.test(code) ? 'rejected' : 'pending' };
}
