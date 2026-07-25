/**
 * paymentsService.ts
 * Client -> crisp-bridge edge function. The bridge holds the Crisp key and
 * derives the sender from the session, so nothing sensitive lives in the app.
 */
let LocalAuthentication: any = null;
try { LocalAuthentication = require('expo-local-authentication'); } catch { LocalAuthentication = null; }
import { supabase } from './supabase';

export type LinkStatus = { linked: boolean; linked_at: string | null };

async function call(path: string, init?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  const base = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace('.supabase.co', '.functions.supabase.co');
  const res = await fetch(base + '/crisp-bridge' + path, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  return res.json();
}

export const paymentsService = {
  async getBalance(currency = 'USD') {
    return call('?action=balance&currency=' + currency);
  },

  async getLinkStatus(): Promise<LinkStatus> {
    const r = await call('?action=status');
    return { linked: !!r?.linked, linked_at: r?.linked_at ?? null };
  },

  async linkWithSignIn(email: string, password: string) {
    return call('?action=link-signin', { method: 'POST', body: JSON.stringify({ email, password }) });
  },

  async sendOtp(email: string) {
    return call('?action=otp-send', { method: 'POST', body: JSON.stringify({ email }) });
  },

  async verifyOtp(email: string, token: string) {
    return call('?action=otp-verify', { method: 'POST', body: JSON.stringify({ email, token }) });
  },

  async linkAccount(code: string) {
    return call('?action=link', { method: 'POST', body: JSON.stringify({ code }) });
  },

  /** Biometric gate, then transfer. Never call the bridge without this. */
  async sendMoney(params: { recipientId: string; amount: number; conversationId: string; currency?: string; note?: string; listingId?: string | null; idempotencyKey: string }) {
    // Native module is absent until the dev client is rebuilt. Allowed in dev only.
    if (!LocalAuthentication?.hasHardwareAsync) {
      if (!__DEV__) {
        return { success: false, error: 'Secure confirmation is unavailable on this build.' };
      }
      console.warn('[payments] Biometrics unavailable - skipping confirmation in dev.');
    } else {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        return { success: false, error: 'Set up Face ID or a passcode on this device to send money.' };
      }
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirm ' + (params.currency || 'USD') + ' ' + params.amount.toFixed(2),
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (!auth.success) return { success: false, error: 'Confirmation cancelled' };
    }

    return call('?action=pay', {
      method: 'POST',
      body: JSON.stringify({
        recipient_id: params.recipientId,
        amount: params.amount,
        currency: params.currency || 'USD',
        conversation_id: params.conversationId,
        note: params.note ?? null,
        listing_id: params.listingId ?? null,
        idempotency_key: params.idempotencyKey,
      }),
    });
  },
};