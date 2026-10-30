import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverMessage, makeMessageId, type MessageIntent, type MessageDelivery } from '../../shared/messageDelivery';

export type OutboxMessage = MessageIntent & { created_at: string; _delivery: 'pending' | 'rejected' | 'conflict' };
const PREFIX = 'pc:message-outbox:v1:';
const inFlight = new Map<string, Promise<MessageDelivery>>();

// One key per message avoids two tabs overwriting one another's queue. The
// stable primary key is also the server-side idempotency key after a lost POST.
function key(account: string, id: string) { return `${PREFIX}${account}:${id}`; }
function storage() { return window.localStorage; }

export function readOutbox(account: string, conversation?: string): OutboxMessage[] {
  const rows: OutboxMessage[] = [];
  try {
    const store = storage();
    for (let i = 0; i < store.length; i++) {
      const name = store.key(i);
      if (!name?.startsWith(`${PREFIX}${account}:`)) continue;
      try {
        const row = JSON.parse(store.getItem(name) || 'null') as OutboxMessage;
        if (row?.sender_id !== account || name !== key(account, row.id) || !row.conversation_id || !Number.isFinite(Date.parse(row.created_at))) continue;
        if (!['pending', 'rejected', 'conflict'].includes(row._delivery)) continue;
        if (!conversation || row.conversation_id === conversation) rows.push(row);
      } catch { /* A corrupt entry must not prevent other messages recovering. */ }
    }
  } catch { /* Unavailable storage is handled before accepting a new message. */ }
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function enqueueMessage(intent: Omit<MessageIntent, 'id'>): OutboxMessage {
  if (readOutbox(intent.sender_id).length >= 200) throw new Error('Your outbox is full. Retry your pending messages before sending more.');
  const row: OutboxMessage = { ...intent, id: makeMessageId(), created_at: new Date().toISOString(), _delivery: 'pending' };
  try { storage().setItem(key(row.sender_id, row.id), JSON.stringify(row)); }
  catch { throw new Error('This browser cannot save your message for delivery. Allow site storage and try again.'); }
  return row;
}

export function forgetOutboxMessage(account: string, id: string) {
  try { storage().removeItem(key(account, id)); } catch { /* A later reconciliation remains idempotent. */ }
}

export function clearOutbox(account: string) {
  for (const row of readOutbox(account)) forgetOutboxMessage(account, row.id);
}

export function sendOutboxMessage(client: Parameters<typeof deliverMessage>[0] & Pick<SupabaseClient, "auth">, row: OutboxMessage): Promise<MessageDelivery> {
  const name = key(row.sender_id, row.id);
  const existing = inFlight.get(name);
  if (existing) return existing;
  const attempt = (async (): Promise<MessageDelivery> => {
    const { data, error } = await client.auth.getSession();
    if (error || data?.session?.user?.id !== row.sender_id) return { status: 'pending' };
    const intent: MessageIntent = { id:row.id,conversation_id:row.conversation_id,sender_id:row.sender_id,receiver_id:row.receiver_id,text:row.text,media_url:row.media_url,media_type:row.media_type,thumbnail_url:row.thumbnail_url,reply_to_id:row.reply_to_id,view_limit:row.view_limit,...(row.shared_post_id!==undefined?{shared_post_id:row.shared_post_id}:{}) };
    // Reconcile even the first attempt: another tab may already have sent it.
    const result = await deliverMessage(client, intent, true);
    if (result.status === 'confirmed') forgetOutboxMessage(row.sender_id, row.id);
    else {
      try {
        // Do not resurrect a queue entry cleared on sign-out or in another tab.
        if (storage().getItem(name)) storage().setItem(name, JSON.stringify({ ...row, _delivery: result.status }));
      } catch { /* The original durable intent remains safe to retry. */ }
    }
    return result;
  })().catch((): MessageDelivery => ({ status: 'pending' })).finally(() => { inFlight.delete(name); });
  inFlight.set(name, attempt);
  return attempt;
}
