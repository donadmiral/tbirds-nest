import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { createSupportRequest, sendSupportReply, withSupportWriteSession } from '../../shared/memberSupport';
import { navigationScope, subscribeNavigationScope } from '../lib/navigationCache';
import { useAuthStore } from '../stores/authStore';
import { supabase } from './supabase';

const cryptography = {
  id: () => Crypto.randomUUID(),
  digest: (value: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
};

const scopeStore = {
  getSnapshot: () => ({ owner: useAuthStore.getState().session?.user.id ?? null, scope: navigationScope(), initialized: true }),
  subscribe: subscribeNavigationScope,
};

export function createMemberSupportRequest(owner: string, input: { kind: 'support' | 'appeal'; subject: string; body: string }, canDispatch: () => boolean) {
  return withSupportWriteSession(supabase, scopeStore, owner, canDispatch,
    context => createSupportRequest(supabase, AsyncStorage, cryptography, owner, input, context));
}

export function replyToMemberSupport(owner: string, ticketId: string, body: string, canDispatch: () => boolean) {
  return withSupportWriteSession(supabase, scopeStore, owner, canDispatch,
    context => sendSupportReply(supabase, AsyncStorage, cryptography, owner, ticketId, body, context));
}
