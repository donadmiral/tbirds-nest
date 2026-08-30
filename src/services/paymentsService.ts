/**
 * paymentsService.ts
 * Client -> crisp-bridge edge function. The bridge holds the Crisp key and
 * derives the sender from the session, so nothing sensitive lives in the app.
 */
let LocalAuthentication: any = null;
try { LocalAuthentication = require('expo-local-authentication'); } catch { LocalAuthentication = null; }
import { supabase } from './supabase';

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

  constructor(status: number, message: string, kind: BridgeErrorKind = 'http') {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
    this.kind = kind;

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

async function call(path: string, init: RequestInit = {}) {
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

  const configuredUrl =
    process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '';

  if (!configuredUrl) {
    throw new BridgeError(
      0,
      'IntoBank connection is not configured.',
      'configuration'
    );
  }

  const base = configuredUrl
    .replace(/\/+$/, '')
    .replace('.supabase.co', '.functions.supabase.co');

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
        'http'
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

  async linkWithSignIn(
    email: string,
    password: string
  ) {
    return call('?action=link-signin', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async sendOtp(email: string) {
    return call('?action=otp-send', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async verifyOtp(email: string, token: string) {
    return call('?action=otp-verify', {
      method: 'POST',
      body: JSON.stringify({ email, token }),
    });
  },

  async linkAccount(code: string) {
    return call('?action=link', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },

  /** Biometric gate, then transfer. Never call the bridge without this. */
  async sendMoney(params: {
    recipientId: string;
    amount: number;
    conversationId: string;
    currency?: string;
    note?: string;
    listingId?: string | null;
    idempotencyKey: string;
  }) {
    // Native module is absent until the dev client is rebuilt. Allowed in dev only.
    if (!LocalAuthentication?.hasHardwareAsync) {
      if (!__DEV__) {
        return {
          success: false,
          error: 'Secure confirmation is unavailable on this build.',
        };
      }

      console.warn(
        '[payments] Biometrics unavailable - skipping confirmation in dev.'
      );
    } else {
      const hasHardware =
        await LocalAuthentication.hasHardwareAsync();
      const enrolled =
        await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !enrolled) {
        return {
          success: false,
          error:
            'Set up Face ID or a passcode on this device to send money.',
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
          error: 'Confirmation cancelled',
        };
      }
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