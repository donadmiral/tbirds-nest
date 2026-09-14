/** Local recovery references only. This store is never evidence of payment. */
export type PaymentScope = {
  ownerId: string;
  recipientId: string;
  conversationId: string;
};

export type PaymentIntent = PaymentScope & {
  version: 1;
  idempotencyKey: string;
  amount: number;
  currency: string;
  listingId: string | null;
  createdAt: string;
};

export type PaymentOutcome = {
  status: 'pending' | 'completed' | 'failed' | 'not_found' | 'not_submitted';
  pending: boolean;
  success: boolean;
  payment_id?: string;
  tx_id?: string;
  currency?: string;
  error?: string;
};

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

function keyFor(scope: PaymentScope): string {
  if (!scope.ownerId || !scope.recipientId || !scope.conversationId) {
    throw new Error('Sign in and open a conversation before sending money.');
  }
  return 'pc-payment-intent-v1:' + [scope.ownerId, scope.conversationId, scope.recipientId]
    .map(encodeURIComponent).join(':');
}

function decode(raw: string, scope: PaymentScope): PaymentIntent {
  let value: any;
  try { value = JSON.parse(raw); } catch {
    throw new Error('The saved payment needs review. Do not send it again.');
  }
  if (value?.version !== 1 || value.ownerId !== scope.ownerId ||
      value.recipientId !== scope.recipientId || value.conversationId !== scope.conversationId ||
      typeof value.idempotencyKey !== 'string' || value.idempotencyKey.length < 16 ||
      !Number.isFinite(value.amount) || value.amount <= 0 ||
      typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency) ||
      !(value.listingId === null || typeof value.listingId === 'string') ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error('The saved payment needs review. Do not send it again.');
  }
  // Copy only the recovery allowlist, never arbitrary stored credentials or data.
  return {
    version: 1, ownerId: value.ownerId, recipientId: value.recipientId,
    conversationId: value.conversationId, idempotencyKey: value.idempotencyKey,
    amount: value.amount, currency: value.currency, listingId: value.listingId,
    createdAt: value.createdAt,
  };
}

export function createPaymentIntentStore(storage: Storage, makeKey: () => string) {
  const locks = new Map<string, Promise<unknown>>();
  const locked = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const previous = locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    locks.set(key, next);
    try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
  };
  const read = async (scope: PaymentScope) => {
    const raw = await storage.getItem(keyFor(scope));
    return raw === null ? null : decode(raw, scope);
  };
  return {
    load(scope: PaymentScope) { return locked(keyFor(scope), () => read(scope)); },
    prepare(params: PaymentScope & { amount: number; currency?: string; listingId?: string | null }) {
      return locked(keyFor(params), async () => {
        const existing = await read(params);
        if (existing) return existing;
        const intent = decode(JSON.stringify({
          version: 1, ownerId: params.ownerId, recipientId: params.recipientId,
          conversationId: params.conversationId, amount: params.amount,
          currency: params.currency ?? 'USD', listingId: params.listingId ?? null,
          idempotencyKey: makeKey(), createdAt: new Date().toISOString(),
        }), params);
        // Persist BEFORE any payment request. If persistence fails, stop.
        await storage.setItem(keyFor(params), JSON.stringify(intent));
        return intent;
      });
    },
    clear(intent: PaymentIntent) {
      return locked(keyFor(intent), async () => {
        const current = await read(intent);
        if (current?.idempotencyKey === intent.idempotencyKey) {
          await storage.removeItem(keyFor(intent));
        }
      });
    },
  };
}

/** Only explicit terminal evidence can release a recovery identity. */
export function paymentOutcome(body: any): PaymentOutcome {
  const common = {
    payment_id: typeof body?.payment_id === 'string' ? body.payment_id : undefined,
    tx_id: typeof body?.tx_id === 'string' ? body.tx_id : undefined,
    currency: typeof body?.currency === 'string' ? body.currency : undefined,
    error: typeof body?.error === 'string' ? body.error : undefined,
  };
  if (body?.submitted === false) return { ...common, success: false, status: 'not_submitted', pending: false };
  if (body?.status === 'failed' && body?.pending !== true) return { ...common, success: false, status: 'failed', pending: false };
  if (body?.success === true && body?.pending !== true && common.tx_id &&
      (body.status === 'completed' || body.status === undefined)) {
    return { ...common, success: true, status: 'completed', pending: false };
  }
  return { ...common, success: false, status: 'pending', pending: true };
}
