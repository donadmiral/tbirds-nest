import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import { parseErasureReceipt, readAccountErasure, sendAccountErasure, type ErasureReceipt } from '../../shared/accountErasure';
const RECEIPT_KEY = 'pc_account_erasure_receipt_v1';
let requesting = false;
export const loadAccountErasureReceipt = async () => parseErasureReceipt(await SecureStore.getItemAsync(RECEIPT_KEY));
export const checkAccountErasure = (receipt: ErasureReceipt) => readAccountErasure(SUPABASE_URL!, SUPABASE_ANON_KEY!, receipt);
export async function requestAccountErasure(expectedUserId: string) {
  if (requesting) throw new Error('Your deletion request is already being checked.');
  requesting = true;
  let changed = false;
  const subscription = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || session?.user.id !== expectedUserId) changed = true;
  }).data.subscription;
  try {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session || session.user.id !== expectedUserId) throw new Error('Switch to your personal account before requesting deletion.');
    const verified = await supabase.auth.getUser(session.access_token);
    if (verified.error || verified.data.user?.id !== expectedUserId || changed) throw new Error('Your account changed. Sign in again before requesting deletion.');
    let receipt = parseErasureReceipt(await SecureStore.getItemAsync(`${RECEIPT_KEY}_${expectedUserId}`));
    if (!receipt || receipt.userId !== expectedUserId) {
      const bytes = await Crypto.getRandomBytesAsync(32);
      receipt = { requestId: Crypto.randomUUID(), token: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''), userId: expectedUserId, createdAt: new Date().toISOString() };
      // Persist before the first network write, including uncertain timeouts.
      await SecureStore.setItemAsync(`${RECEIPT_KEY}_${expectedUserId}`, JSON.stringify(receipt));
    }
    await SecureStore.setItemAsync(RECEIPT_KEY, JSON.stringify(receipt));
    if (changed) throw new Error('Your account changed. Please reopen account settings.');
    const status = await sendAccountErasure(SUPABASE_URL!, SUPABASE_ANON_KEY!, session.access_token, receipt);
    return { receipt, status, accountChanged: changed };
  } finally { subscription.unsubscribe(); requesting = false; }
}
