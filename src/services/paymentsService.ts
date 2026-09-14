/**
 * paymentsService.ts
 * Client -> crisp-bridge edge function. The bridge holds the Crisp key and
 * derives the sender from the session, so nothing sensitive lives in the app.
 */
let LocalAuthentication: any = null;
try { LocalAuthentication = require('expo-local-authentication'); } catch { LocalAuthentication = null; }
import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-get-random-values';
import { createPaymentIntentStore, paymentOutcome } from './paymentIntent';
import type { PaymentIntent, PaymentOutcome, PaymentScope } from './paymentIntent';

const intentStore = createPaymentIntentStore(AsyncStorage, () => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
});

export type LinkStatus = { linked: boolean; linked_at: string | null };

type BridgeErrorKind =
  | 'auth'
  | 'timeout'
  | 'cancelled'
  | 'network'
  | 'http'
  | 'invalid-response'
  | 'configuration';

/** A bridge error that preserves status, category, and a useful message. */
export class BridgeError extends Error {
  status: number;
  kind: BridgeErrorKind;
  code: string | null;

  constructor(status: number, message: string, kind: BridgeErrorKind = 'http', code: string | null = null) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
    this.kind = kind;
    this.code = code;

    // Preserve instanceof BridgeError after transpilation.
    Object.setPrototypeOf(this, BridgeError.prototype);
  }
}

// PHASE1A_TRANSPORT_V3

/**
 * Bounds how long the interface waits for Supabase session retrieval.
 *
 * Supabase getSession() does not accept an AbortSignal, so its internal
 * operation cannot be force-cancelled. This wrapper still guarantees that
 * the payment interface stops waiting after the deadline.
 */
function getSessionWithTimeout(
  timeoutMs: number,
  signal?: AbortSignal
): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      if (signal) {
        try {
          signal.removeEventListener('abort', onAbort);
        } catch {}
      }
    };

    const succeed = (value: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const fail = (error: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = () => {
      fail(new BridgeError(0, 'Request cancelled.', 'cancelled'));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      fail(
        new BridgeError(
          0,
          'Session check timed out. Please try again.',
          'timeout'
        )
      );
    }, timeoutMs);

    supabase.auth.getSession().then(succeed, fail);
  });
}

function getResponseMessage(body: any, fallback: string): string {
  const candidate =
    typeof body?.error === 'string'
      ? body.error
      : typeof body?.error?.message === 'string'
        ? body.error.message
        : typeof body?.message === 'string'
          ? body.message
          : null;

  return candidate?.trim() || fallback;
}

async function call(path: string, init: RequestInit = {}, expectedUserId?: string) {
  const callerSignal = init.signal ?? undefined;

  // Session retrieval has its own short UI deadline.
  const sessionResult = await getSessionWithTimeout(
    8000,
    callerSignal
  );

  if (sessionResult?.error) {
    throw new BridgeError(
      401,
      sessionResult.error.message || 'Could not verify your session.',
      'auth'
    );
  }

  const session = sessionResult?.data?.session;

  if (!session) {
    throw new BridgeError(
      401,
      'Your session has expired. Sign in again.',
      'auth'
    );
  }

  if (expectedUserId && session.user?.id !== expectedUserId) {
    throw new BridgeError(401, 'Your account changed. Reopen this payment from the correct account.', 'auth');
  }

  const configuredUrl =
    process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '';

  if (!configuredUrl) {
    throw new BridgeError(
      0,
      'IntoBank connection is not configured.',
      'configuration'
    );
  }

  // The canonical path works with hosted projects and the local Supabase CLI.
  const base = configuredUrl.replace(/\/+$/, '') + '/functions/v1';

  // Mutations receive more time than status and balance reads.
  // Payment retries remain protected by the existing idempotency key.
  const isMutationOperation =
    /action=(?:link(?:-signin)?|otp-[^&]+|unlink|pay)(?:&|$)/.test(path);

  const timeoutMs = isMutationOperation ? 30000 : 15000;
  const controller = new AbortController();

  let timedOut = false;
  let callerAborted = false;

  const abortFromCaller = () => {
    callerAborted = true;
    controller.abort();
  };

  if (callerSignal?.aborted) {
    throw new BridgeError(0, 'Request cancelled.', 'cancelled');
  }

  if (callerSignal) {
    callerSignal.addEventListener('abort', abortFromCaller, {
      once: true,
    });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(
      base + '/crisp-bridge' + path,
      {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(init.headers || {}),
          ...(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ? { apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY } : {}),
          // The phone cannot override the authenticated session token.
          Authorization: 'Bearer ' + session.access_token,
        },
      }
    );

    // Keep the deadline active until the complete response body is read.
    const rawBody = await response.text();
    let body: any = null;

    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        if (!response.ok) {
          throw new BridgeError(
            response.status,
            'IntoBank returned an unreadable error response.',
            'invalid-response'
          );
        }

        throw new BridgeError(
          response.status,
          'IntoBank returned an invalid response.',
          'invalid-response'
        );
      }
    }

    if (!response.ok) {
      throw new BridgeError(
        response.status,
        getResponseMessage(
          body,
          'IntoBank returned ' + response.status
        ),
        'http',
        typeof body?.code === 'string' ? body.code : null
      );
    }

    return body ?? {};
  } catch (error: any) {
    if (error instanceof BridgeError) {
      throw error;
    }

    if (error?.name === 'AbortError') {
      if (timedOut) {
        throw new BridgeError(
          0,
          'The request timed out. Check your connection and try again.',
          'timeout'
        );
      }

      if (callerAborted) {
        throw new BridgeError(
          0,
          'Request cancelled.',
          'cancelled'
        );
      }

      throw new BridgeError(
        0,
        'The request was interrupted.',
        'cancelled'
      );
    }

    throw new BridgeError(
      0,
      error?.message || 'Network problem reaching IntoBank.',
      'network'
    );
  } finally {
    clearTimeout(timer);

    if (callerSignal) {
      try {
        callerSignal.removeEventListener(
          'abort',
          abortFromCaller
        );
      } catch {}
    }
  }
}

export const paymentsService = {
  async getBalance(currency = 'USD') {
    return call('?action=balance&currency=' + currency);
  },

  async getLinkStatus(): Promise<LinkStatus> {
    const r = await call('?action=status');
    return {
      linked: !!r?.linked,
      linked_at: r?.linked_at ?? null,
    };
  },

  async peerLinked(userId: string): Promise<boolean> {
    try {
      const r = await call(
        '?action=peer-status&user=' + userId
      );
      return !!r?.linked;
    } catch {
      return false;
    }
  },

  async unlink() {
    return call('?action=unlink', {
      method: 'POST',
    });
  },

  async linkAccount(code: string, ownerId: string) {
    const connectionCode = code.trim().toUpperCase();
    if (!ownerId) throw new BridgeError(401, 'Sign in before linking IntoBank.', 'auth');
    if (!/^[A-F0-9]{8}$/.test(connectionCode)) throw new BridgeError(400, 'Enter the 8-character connection code from IntoBank.', 'configuration');
    const r = await call('?action=link', {
      method: 'POST',
      body: JSON.stringify({ code: connectionCode }),
    }, ownerId);
    if (r?.success !== true) throw new BridgeError(200, getResponseMessage(r, 'IntoBank did not confirm the connection.'), 'invalid-response');
    return r;
  },

  getPendingIntent(scope: PaymentScope) { return intentStore.load(scope); },
  prepareIntent(params: PaymentScope & { amount: number; currency?: string; listingId?: string | null }) {
    return intentStore.prepare(params);
  },
  clearIntent(intent: PaymentIntent) { return intentStore.clear(intent); },

  async getPaymentStatus(intent: PaymentIntent): Promise<PaymentOutcome> {
    try {
      const r = await call('?action=payment-status&idempotency_key=' + encodeURIComponent(intent.idempotencyKey), {}, intent.ownerId);
      return paymentOutcome(r);
    } catch (e) {
      if (e instanceof BridgeError && e.status === 404 && e.code === 'PAYMENT_NOT_FOUND') {
        return { success: false, status: 'not_found', pending: false };
      }
      throw e;
    }
  },

  /** Biometric gate, then transfer. Never call the bridge without this. */
  async sendMoney(params: {
    ownerId: string;
    recipientId: string;
    amount: number;
    conversationId: string;
    currency?: string;
    note?: string;
    listingId?: string | null;
    idempotencyKey: string;
  }): Promise<PaymentOutcome> {
    if (!LocalAuthentication?.hasHardwareAsync) {
      return {
        success: false,
        status: 'not_submitted' as const,
        pending: false,
        error: 'Secure confirmation is unavailable on this build.',
      };
    } else {
      const hasHardware =
        await LocalAuthentication.hasHardwareAsync();
      const enrolled =
        await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !enrolled) {
        return {
          success: false,
          status: 'not_submitted',
          pending: false,
          error:
            'Set up device biometrics to send money.',
        };
      }

      const auth =
        await LocalAuthentication.authenticateAsync({
          promptMessage:
            'Confirm ' +
            (params.currency || 'USD') +
            ' ' +
            params.amount.toFixed(2),
          cancelLabel: 'Cancel',
          disableDeviceFallback: false,
        });

      if (!auth.success) {
        return {
          success: false,
          status: 'not_submitted',
          pending: false,
          error: 'Confirmation cancelled',
        };
      }
    }

    const result = await call('?action=pay', {
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
    }, params.ownerId);
    return paymentOutcome(result);
  },
};