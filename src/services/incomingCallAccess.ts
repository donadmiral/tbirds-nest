import { notificationUuid } from '../../shared/notificationTap';
import { supabase } from './supabase';
import { callService, type CallRecord, type CallRequestOptions } from './callService';

export type IncomingCallPayload = {
  callId: string;
  callerName: string;
  callerAvatar?: string | null;
  isVideo?: boolean;
  conversationId?: string | null;
  recipientId?: string;
  expiresAt?: number;
};

export function parseCallPayload(value: unknown): IncomingCallPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.type !== undefined && data.type !== 'incoming_call') return null;
  const id = data.callId ?? data.call_id ?? data.uuid;
  const recipient = data.recipientId ?? data.recipient_id;
  if (!notificationUuid(id) || (recipient !== undefined && !notificationUuid(recipient))) return null;
  const name = data.callerName ?? data.caller_name ?? data.title;
  const conversation = data.conversationId ?? data.conversation_id;
  const video = data.isVideo ?? data.is_video ?? data.hasVideo;
  return {
    callId: id.toLowerCase(),
    callerName: typeof name === 'string' ? name.slice(0, 160) : 'Incoming call',
    // Display metadata is reloaded under the recipient's session before ringing.
    callerAvatar: null,
    isVideo: video === true || video === 'true' || video === '1' || video === 1,
    conversationId: notificationUuid(conversation) ? conversation.toLowerCase() : null,
    ...(recipient ? { recipientId: (recipient as string).toLowerCase() } : {}),
  };
}

export type IncomingCallSession = {
  userId: string;
  request: CallRequestOptions & { accessToken: string; signal: AbortSignal };
  current(): boolean;
  ensure(): void;
};

/** Also works in a headless task before the React Auth store is hydrated. */
export async function withIncomingCallSession<T>(
  payload: Partial<IncomingCallPayload>,
  action: (session: IncomingCallSession) => Promise<T>,
  deadlineMs = 15_000,
  signal?: AbortSignal,
): Promise<T> {
  if ((payload.callId !== undefined && !notificationUuid(payload.callId))
    || (payload.recipientId !== undefined && !notificationUuid(payload.recipientId))) throw new Error('Invalid incoming call.');
  const controller = new AbortController();
  let observed: string | undefined;
  let rejectCancelled!: (reason: Error) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const cancel = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    rejectCancelled(new Error('The incoming call expired or the account changed.'));
  };
  const ensure = () => {
    if (controller.signal.aborted) throw new Error('The incoming call expired or the account changed.');
  };
  const subscription = supabase.auth.onAuthStateChange((event, session) => {
    const next = session ? `${session.user.id}:${session.access_token}` : undefined;
    if (event === 'SIGNED_OUT' || (observed !== undefined && next !== observed)) cancel();
    if (next !== undefined) observed ??= next;
  }).data.subscription;
  const timer = setTimeout(cancel, Math.min(30_000, Math.max(1, deadlineMs)));
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    return await Promise.race([cancelled, (async () => {
      const { data, error } = await supabase.auth.getSession();
      ensure();
      const session = data.session;
      if (error || !session?.access_token || !session.user.id) throw new Error('Sign in to receive this call.');
      const identity = `${session.user.id}:${session.access_token}`;
      if ((observed !== undefined && observed !== identity) || (payload.recipientId && payload.recipientId !== session.user.id)) {
        throw new Error('This call belongs to another account.');
      }
      observed = identity;
      return action({ userId: session.user.id,
        request: { accessToken: session.access_token, signal: controller.signal, throwOnError: true },
        current: () => !controller.signal.aborted, ensure });
    })()]);
  } finally {
    clearTimeout(timer); subscription.unsubscribe(); signal?.removeEventListener('abort', cancel); controller.abort();
  }
}

async function recipientCall(payload: IncomingCallPayload, session: IncomingCallSession) {
  session.ensure();
  if (!notificationUuid(payload.callId)) return null;
  const call = await callService.getCall(payload.callId, session.request);
  session.ensure();
  if (!call || call.caller_id === session.userId) return null;
  if (!call.is_group_call) return call.receiver_id === session.userId ? { call, invitation: null } : null;
  const { data: invitation, error } = await supabase.from('call_participants')
    .select('status, created_at').eq('call_session_id', call.id).eq('user_id', session.userId)
    .setHeader('Authorization', `Bearer ${session.request.accessToken}`).abortSignal(session.request.signal).maybeSingle();
  session.ensure();
  if (error) throw error;
  return invitation ? { call, invitation } : null;
}

export type IncomingCallDetails = { call: CallRecord; payload: IncomingCallPayload };

export async function readIncomingCall(payload: IncomingCallPayload, session: IncomingCallSession): Promise<IncomingCallDetails | null> {
  const result = await recipientCall(payload, session);
  if (!result) return null;
  const { call, invitation } = result;
  if (call.is_group_call ? !['ringing', 'active'].includes(call.status) || invitation?.status !== 'invited' : call.status !== 'ringing') return null;
  const age = Date.now() - Date.parse(invitation?.created_at ?? call.created_at);
  if (!Number.isFinite(age) || age < -5_000 || age > 45_000 || !call.channel_id) return null;
  const table = call.is_group_call ? 'conversations' : 'profiles';
  const id = call.is_group_call ? call.conversation_id : call.caller_id;
  if (!id) return null;
  const { data, error } = await supabase.from(table)
    .select(call.is_group_call ? 'group_name' : 'full_name, avatar_url').eq('id', id)
    .setHeader('Authorization', `Bearer ${session.request.accessToken}`).abortSignal(session.request.signal).maybeSingle();
  session.ensure();
  if (error) throw error;
  // The call may end, or group membership may be revoked, during the profile read.
  const latest = await recipientCall(payload, session);
  if (!latest || (call.is_group_call
    ? !['ringing', 'active'].includes(latest.call.status) || latest.invitation?.status !== 'invited'
    : latest.call.status !== 'ringing')) return null;
  const expiresAt = Date.parse(latest.invitation?.created_at ?? latest.call.created_at) + 45_000;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  const record = data as { full_name?: string; avatar_url?: string; group_name?: string } | null;
  return { call: latest.call, payload: {
    callId: latest.call.id, recipientId: session.userId, expiresAt,
    callerName: (call.is_group_call ? record?.group_name : record?.full_name) || (call.is_group_call ? 'Group call' : 'Call'),
    callerAvatar: call.is_group_call ? null : record?.avatar_url ?? null,
    isVideo: latest.call.is_video, conversationId: latest.call.conversation_id,
  } };
}

/** Only a confirmed decline or an already settled own call consumes the action. */
export async function declineIncomingCall(payload: IncomingCallPayload, signal?: AbortSignal): Promise<boolean> {
  return withIncomingCallSession(payload, async session => {
    const result = await recipientCall(payload, session);
    if (!result) return false;
    const { call, invitation } = result;
    if (call.is_group_call) {
      if (invitation?.status === 'invited' && ['ringing', 'active'].includes(call.status)) {
        await callService.declineGroupCall(call.id, session.userId, session.request);
        session.ensure();
      }
      return true;
    }
    if (call.status !== 'ringing') return true;
    const declined = await callService.declineCall(call.id, session.request);
    session.ensure();
    if (declined) return true;
    const current = await callService.getCall(call.id, session.request);
    session.ensure();
    return !current || current.status !== 'ringing';
  }, 15000, signal);
}
