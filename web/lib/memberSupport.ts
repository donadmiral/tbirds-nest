import { createSupportRequest, sendSupportReply, withSupportWriteSession, type SupportClient } from '../../shared/memberSupport';
import { getNavigationStore } from './navigationCache';

const cryptography = {
  id: () => crypto.randomUUID(),
  async digest(value: string) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  },
};

export function createMemberSupportRequest(client: SupportClient, owner: string, input: { kind: 'support' | 'appeal'; subject: string; body: string }, canDispatch: () => boolean) {
  return withSupportWriteSession(client, getNavigationStore(), owner, canDispatch,
    context => createSupportRequest(client, window.sessionStorage, cryptography, owner, input, context));
}

export function replyToMemberSupport(client: SupportClient, owner: string, ticketId: string, body: string, canDispatch: () => boolean) {
  return withSupportWriteSession(client, getNavigationStore(), owner, canDispatch,
    context => sendSupportReply(client, window.sessionStorage, cryptography, owner, ticketId, body, context));
}
