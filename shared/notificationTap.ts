export type NotificationTapData = {
  type: string;
  recipient_id?: string;
  post_id?: string;
  comment_id?: string;
  story_id?: string;
  conversation_id?: string;
  call_id?: string;
};

type ResponseEnvelope = {
  actionIdentifier?: unknown;
  notification?: { request?: { identifier?: unknown; content?: { data?: unknown } } };
};

export type NotificationTapSession = { scope: string; userId: string; accessToken: string };
export type NotificationTapContext = NotificationTapSession & { signal: AbortSignal; current(): boolean };

export function notificationUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function notificationTapData(value: unknown): NotificationTapData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.type !== 'string' || !/^[a-z_]{1,64}$/.test(raw.type)) return null;
  if (raw.recipient_id !== undefined && !notificationUuid(raw.recipient_id)) return null;
  const data: NotificationTapData = { type: raw.type };
  for (const key of ['recipient_id', 'post_id', 'comment_id', 'story_id', 'conversation_id'] as const) {
    if (notificationUuid(raw[key])) data[key] = raw[key];
  }
  const callId = raw.call_id ?? raw.callId;
  if (notificationUuid(callId)) data.call_id = callId;
  return data;
}

/** One bounded, account-bound consumer for the cold response and live listener. */
export function createNotificationTapController(deps: {
  session(): NotificationTapSession | null;
  ready(): boolean;
  subscribeScope(listener: () => void): () => void;
  handle(data: NotificationTapData, action: 'open' | 'decline', context: NotificationTapContext): void | Promise<void>;
  consumed?(identifier: string, actionIdentifier: string): void | Promise<void>;
  deadlineMs?: number;
}) {
  let disposed = false;
  const active = new Map<string, { promise: Promise<void>; check(): void; cancel(): void }>();
  const seen = new Set<string>();
  const deadline = Math.min(30_000, Math.max(1, deps.deadlineMs ?? 15_000));
  const unsubscribe = deps.subscribeScope(() => { for (const job of active.values()) job.check(); });

  function receive(response: ResponseEnvelope): Promise<void> {
    if (disposed) return Promise.resolve();
    const request = response?.notification?.request;
    const identifier = request?.identifier;
    const rawAction = response?.actionIdentifier;
    if (typeof identifier !== 'string' || !identifier || identifier.length > 256 || typeof rawAction !== 'string') return Promise.resolve();
    const action = rawAction === 'decline' ? 'decline'
      : ['answer', 'expo.modules.notifications.actions.DEFAULT'].includes(rawAction) ? 'open' : null;
    const data = notificationTapData(request?.content?.data);
    if (!action || !data || (action === 'decline' && (data.type !== 'incoming_call' || !data.call_id))) return Promise.resolve();
    const key = `${identifier}:${rawAction}`;
    if (seen.has(key)) return Promise.resolve();
    const existing = active.get(key);
    if (existing) return existing.promise;
    // A corrupt notification stream cannot leave an unbounded timer queue.
    if (active.size >= 16) return Promise.resolve();

    const controller = new AbortController();
    let bound = deps.session();
    let started = false, settled = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    const current = () => !disposed && !controller.signal.aborted && !!bound && deps.session()?.scope === bound.scope;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (poll !== undefined) clearTimeout(poll);
      if (expiry !== undefined) clearTimeout(expiry);
      controller.abort(); active.delete(key); resolve();
    };
    const check = () => {
      if (settled) return;
      if (poll !== undefined) { clearTimeout(poll); poll = undefined; }
      const session = deps.session();
      if (disposed || (bound && session?.scope !== bound.scope)) { finish(); return; }
      // Cold-start Auth hydration may finish after the notification arrives.
      // Once an account is known, it can never be replaced for this response.
      bound ??= session;
      if (bound && data.recipient_id && bound.userId !== data.recipient_id) { finish(); return; }
      if (started) return;
      if (!bound || (action === 'open' && !deps.ready())) {
        poll = setTimeout(check, 100); return;
      }
      started = true;
      const context: NotificationTapContext = { ...bound, signal: controller.signal, current };
      void Promise.resolve().then(() => {
        if (current()) return deps.handle(data, action, context);
      }).then(async () => {
        if (!current()) return;
        seen.add(key);
        while (seen.size > 128) seen.delete(seen.values().next().value!);
        await deps.consumed?.(identifier, rawAction);
      }).catch(() => { /* A failed response is not an unhandled rejection. */ }).finally(finish);
    };
    active.set(key, { promise, check, cancel: finish });
    expiry = setTimeout(finish, deadline);
    check();
    return promise;
  }

  return { receive, dispose() {
    if (disposed) return;
    disposed = true; unsubscribe();
    for (const job of active.values()) job.cancel();
    active.clear(); seen.clear();
  } };
}
