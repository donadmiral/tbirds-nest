// Explicit owner-issued operations only. No application JWT, service key, or
// reusable provider/signing secret is accepted as this endpoint's bearer.
export type ProviderCall = (path: string, method: 'GET' | 'POST' | 'DELETE', body?: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
export type OperationReceipt = { code: string; resource_id?: string; mutation_attempted: boolean; configuration_matches?: boolean;
  cleanup_confirmed?: boolean; provider_status?: number; provider_error?: string; provider_reason?: string };
export type OperationOutcome = { receipt: OperationReceipt; metadata: Record<string, unknown> };
const ERROR_CODES = ['PROVIDER_CONFIG_INVALID', 'PROVIDER_RESPONSE_INVALID', 'PROVIDER_REQUEST_FAILED', 'PROVIDER_REQUEST_REJECTED',
  'PROVIDER_TIMEOUT', 'PROVIDER_DOMAIN_MISMATCH', 'PROVIDER_WEBHOOK_CONFLICT', 'PROVIDER_VERIFICATION_FAILED',
  'STORAGE_VERIFICATION_FAILED', 'STORAGE_CLEANUP_UNCONFIRMED', 'INVALID_OPERATION', 'DATABASE_UNAVAILABLE', 'COMPLETION_UNCONFIRMED'] as const;
type ErrorCode = typeof ERROR_CODES[number];
const PROVIDER_ERRORS = ['invalid-request-error', 'authentication-error', 'authorization-error', 'not-found-error', 'rate-limit-error', 'unclassified'];
const PROVIDER_REASONS = ['billing_required', 'role_assumption_denied', 'storage_access_denied', 'configuration_invalid', 'unclassified'];
export class ProviderFailure extends Error {
  receipt?: Partial<OperationReceipt>;
  constructor(readonly code: ErrorCode, readonly providerStatus?: number, readonly providerError?: string, readonly providerReason?: string) { super(code); }
}
export type StorageDependencies = { call: ProviderCall; cleanup(path: string): Promise<unknown>; operationId: string;
  bucket: string; region: string; assumeRoleArn: string; endpointName: string; now?: () => number };
type Dependencies = {
  rpc(name: string, args: Record<string, unknown>, signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
  fetch: typeof fetch; projectOrigin: string; dailyKey: string; domainId: string; webhookSecret: string;
  storage?: { bucket: string; region: string; assumeRoleArn: string; endpointName: string;
    verify(deps: StorageDependencies): Promise<OperationOutcome> };
  now?: () => number;
};
const TOKEN = /^pc_live_config_[a-f0-9]{64}$/;
const ORIGIN = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EVENTS = ['streaming.started', 'streaming.updated', 'streaming.ended', 'streaming.error', 'streaming.warning'];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store' } });

function abortable<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new ProviderFailure('PROVIDER_TIMEOUT'));
    if (signal.aborted) { void Promise.resolve(operation).catch(() => {}); aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
async function boundedJson(response: Response | Request, limit: number, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length') || 0) > limit) throw new ProviderFailure('PROVIDER_RESPONSE_INVALID');
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderFailure('PROVIDER_RESPONSE_INVALID');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal); if (done) break;
      length += value.length;
      if (length > limit) throw new ProviderFailure('PROVIDER_RESPONSE_INVALID');
      chunks.push(value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ProviderFailure('PROVIDER_RESPONSE_INVALID'); }
}
function permitted(path: string, method: string) {
  return path === '/' && method === 'GET'
    || path === '/webhooks' && ['GET', 'POST'].includes(method)
    || /^\/webhooks\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(path) && method === 'GET'
    || path === '/rooms' && method === 'POST'
    || /^\/rooms\/pc-live-verify-[a-f0-9]{32}$/.test(path) && ['GET', 'POST', 'DELETE'].includes(method);
}
function providerReason(data: unknown) {
  if (!record(data)) return 'unclassified';
  // Classify only documented error-detail fields; never return their text.
  // The generic invalid-request-error code alone does not prove a cause.
  const detail = [data.info, data.message].filter((value): value is string => typeof value === 'string')
    .map(value => value.slice(0, 4096)).join(' ').toLowerCase();
  if (/\b(?:billing|payment|paid (?:account|plan)|credit card|subscription)\b/.test(detail)
    && /\b(?:required|requires|enable|upgrade|missing|must|need|add|enter)\b/.test(detail)) return 'billing_required';
  if (/\b(?:assumerole|assume[ _-]role|role assumption|sts:assumerole)\b/.test(detail)
    && /\b(?:denied|forbidden|unauthorized|cannot|unable|failed|failure)\b|not authorized/.test(detail)) return 'role_assumption_denied';
  if (/\b(?:s3|bucket|putobject|storage)\b/.test(detail)
    && /access[ _-]?denied|\b(?:forbidden|unauthorized)\b|not authorized|insufficient permissions/.test(detail)) return 'storage_access_denied';
  if (/missing required (?:field|property|parameter)|unknown (?:field|property|parameter)|invalid (?:field|property|parameter)|unsupported (?:field|property|parameter)/.test(detail)) return 'configuration_invalid';
  return 'unclassified';
}
function providerCall(deps: Dependencies, outerSignal: AbortSignal): ProviderCall {
  return async (path, method, body, timeoutMs = 5000) => {
    if (!permitted(path, method) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) {
      throw new ProviderFailure('INVALID_OPERATION');
    }
    const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(timeoutMs)]);
    if (signal.aborted) throw new ProviderFailure('PROVIDER_TIMEOUT');
    try {
      const response = await abortable(deps.fetch(`https://api.daily.co/v1${path}`, { method, redirect: 'error', signal,
        headers: { Authorization: `Bearer ${deps.dailyKey}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}) }), signal);
      if (response.redirected || response.status >= 300 && response.status < 400) throw new ProviderFailure('PROVIDER_RESPONSE_INVALID');
      // Daily documents an unpaginated bare-array webhook list. A future cursor
      // envelope or continuation header must fail closed before any create.
      if (path === '/webhooks' && method === 'GET' && (/rel\s*=\s*["']?next/i.test(response.headers.get('link') || '')
        || /^(true|1)$/i.test(response.headers.get('x-has-more') || ''))) throw new ProviderFailure('PROVIDER_RESPONSE_INVALID');
      let data: unknown;
      try { data = await boundedJson(response, 65536, signal); }
      catch (error) {
        if (!response.ok) throw new ProviderFailure('PROVIDER_REQUEST_REJECTED', response.status, 'unclassified', 'unclassified');
        throw error;
      }
      if (!response.ok) {
        const code = record(data) && typeof data.error === 'string' && PROVIDER_ERRORS.includes(data.error) ? data.error : 'unclassified';
        throw new ProviderFailure('PROVIDER_REQUEST_REJECTED', response.status, code, providerReason(data));
      }
      return data;
    } catch (error) {
      if (error instanceof ProviderFailure) throw error;
      throw new ProviderFailure(signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_REQUEST_FAILED');
    }
  };
}
function validHmac(value: string) {
  try { return value.length <= 1024 && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && atob(value).length >= 32; }
  catch { return false; }
}
async function sameSecret(left: unknown, right: string) {
  if (typeof left !== 'string' || left.length > 1024) return false;
  const hash = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const a = new Uint8Array(await hash(left)), b = new Uint8Array(await hash(right));
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]; return difference === 0;
}
function listRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 100 || !value.every(row => record(row) && uuid(row.uuid) && typeof row.url === 'string' && row.url.length <= 2048)) {
    throw new ProviderFailure('PROVIDER_RESPONSE_INVALID');
  }
  return value;
}
function matchingEndpoint(rows: Record<string, unknown>[], origin: string) {
  return rows.filter(row => {
    try {
      const url = new URL(row.url as string);
      return url.origin === origin && decodeURIComponent(url.pathname).replace(/\/+$/, '') === '/functions/v1/live-provider-webhook';
    } catch { throw new ProviderFailure('PROVIDER_RESPONSE_INVALID'); }
  });
}
async function verifiedWebhook(row: Record<string, unknown>, deps: Dependencies) {
  return uuid(row.uuid) && row.url === `${deps.projectOrigin}/functions/v1/live-provider-webhook`
    && row.domainId === deps.domainId && row.state === 'ACTIVE' && row.retryType === 'exponential'
    && (row.basicAuth === undefined || row.basicAuth === null || row.basicAuth === '')
    && Array.isArray(row.eventTypes) && row.eventTypes.length === EVENTS.length
    && new Set(row.eventTypes).size === EVENTS.length && EVENTS.every(event => (row.eventTypes as unknown[]).includes(event))
    && await sameSecret(row.hmac, deps.webhookSecret);
}
async function registerWebhook(deps: Dependencies, call: ProviderCall): Promise<OperationOutcome> {
  let mutationAttempted = false, resourceId: string | undefined;
  try {
    if (!validHmac(deps.webhookSecret)) throw new ProviderFailure('PROVIDER_CONFIG_INVALID');
    const existing = matchingEndpoint(listRows(await call('/webhooks', 'GET')), deps.projectOrigin);
    if (existing.length > 1 || existing.length === 1 && !await verifiedWebhook(existing[0], deps)) {
      throw new ProviderFailure('PROVIDER_WEBHOOK_CONFLICT');
    }
    if (existing.length === 1) resourceId = existing[0].uuid as string;
    else {
      mutationAttempted = true;
      const created = await call('/webhooks', 'POST', { url: `${deps.projectOrigin}/functions/v1/live-provider-webhook`,
        eventTypes: EVENTS, retryType: 'exponential', hmac: deps.webhookSecret }, 15000);
      if (!record(created) || !uuid(created.uuid)) throw new ProviderFailure('PROVIDER_RESPONSE_INVALID');
      resourceId = created.uuid;
      if (!await verifiedWebhook(created, deps)) throw new ProviderFailure('PROVIDER_VERIFICATION_FAILED');
    }
    const after = matchingEndpoint(listRows(await call('/webhooks', 'GET')), deps.projectOrigin);
    if (after.length !== 1 || after[0].uuid !== resourceId || !await verifiedWebhook(after[0], deps)) {
      throw new ProviderFailure('PROVIDER_WEBHOOK_CONFLICT');
    }
    const fetched = await call(`/webhooks/${resourceId}`, 'GET');
    // The official GET-one schema shows a singleton array; accept the object
    // shape as well, but never unwrap multiple rows or ignore a different ID.
    const final = Array.isArray(fetched) && fetched.length === 1 ? fetched[0] : fetched;
    if (!record(final) || final.uuid !== resourceId || !await verifiedWebhook(final, deps)) throw new ProviderFailure('PROVIDER_VERIFICATION_FAILED');
    return { receipt: { code: mutationAttempted ? 'WEBHOOK_REGISTERED' : 'WEBHOOK_ALREADY_CONFIGURED', resource_id: resourceId,
      mutation_attempted: mutationAttempted, configuration_matches: true },
    metadata: { webhook_id: resourceId, state: 'ACTIVE', domain_id: deps.domainId, retry_type: 'exponential',
      event_types: EVENTS, target_matches: true, hmac_matches: true } };
  } catch (error) {
    const failure = error instanceof ProviderFailure ? error : new ProviderFailure('PROVIDER_REQUEST_FAILED');
    failure.receipt = { mutation_attempted: mutationAttempted, ...(resourceId ? { resource_id: resourceId } : {}) };
    throw failure;
  }
}
function failureReceipt(error: unknown): OperationReceipt {
  const known = error instanceof ProviderFailure && ERROR_CODES.includes(error.code);
  const extra = known ? error.receipt : undefined;
  return { code: known ? error.code : 'PROVIDER_REQUEST_FAILED', mutation_attempted: extra?.mutation_attempted === true,
    ...(uuid(extra?.resource_id) ? { resource_id: extra.resource_id } : {}),
    ...(typeof extra?.configuration_matches === 'boolean' ? { configuration_matches: extra.configuration_matches } : {}),
    ...(typeof extra?.cleanup_confirmed === 'boolean' ? { cleanup_confirmed: extra.cleanup_confirmed } : {}),
    ...(known && Number.isInteger(error.providerStatus) && error.providerStatus! >= 100 && error.providerStatus! <= 599 ? { provider_status: error.providerStatus } : {}),
    ...(known && typeof error.providerError === 'string' && PROVIDER_ERRORS.includes(error.providerError) ? { provider_error: error.providerError } : {}),
    ...(known && typeof error.providerReason === 'string' && PROVIDER_REASONS.includes(error.providerReason) ? { provider_reason: error.providerReason } : {}) };
}

export function createProviderConfigureHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' });
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!TOKEN.test(token)) return reply(401, { error: 'AUTH_REQUIRED' });
    if (!ORIGIN.test(deps.projectOrigin)) return reply(503, { error: 'PROVIDER_CONFIG_INVALID' });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(35000)]);
    const rpc = async (name: string, args: Record<string, unknown>, deadline = signal) => {
      try {
        const result = await abortable(deps.rpc(name, args, deadline), deadline);
        if (result.error) throw new ProviderFailure('DATABASE_UNAVAILABLE');
        return result.data;
      } catch { throw new ProviderFailure('DATABASE_UNAVAILABLE'); }
    };
    let claimed = false, operationId: string | undefined, action: string | undefined;
    const finish = (succeeded: boolean, receipt: OperationReceipt) => rpc('finish_live_provider_operation_v1',
      { p_token: token, p_succeeded: succeeded, p_result: receipt }, AbortSignal.timeout(4000));
    try {
      const operation = await rpc('claim_live_provider_operation_v1', { p_token: token, p_project_origin: deps.projectOrigin });
      if (operation === null) return reply(401, { error: 'AUTH_REQUIRED' });
      claimed = true;
      const now = deps.now?.() ?? Date.now();
      if (!record(operation) || !uuid(operation.operation_id) || operation.project_origin !== deps.projectOrigin
        || !['register_webhook', 'verify_storage'].includes(String(operation.action)) || typeof operation.expires_at !== 'string'
        || !Number.isFinite(Date.parse(operation.expires_at)) || Date.parse(operation.expires_at) < now + 45000) {
        throw new ProviderFailure('INVALID_OPERATION');
      }
      operationId = operation.operation_id; action = operation.action as string;
      const body = await boundedJson(request, 128, signal);
      if (!record(body) || Object.keys(body).length) throw new ProviderFailure('INVALID_OPERATION');
      if (!deps.dailyKey || !UUID.test(deps.domainId)) throw new ProviderFailure('PROVIDER_CONFIG_INVALID');
      const call = providerCall(deps, signal);
      const domain = await call('/', 'GET');
      if (!record(domain) || domain.domain_id !== deps.domainId || typeof domain.domain_name !== 'string' || !DOMAIN.test(domain.domain_name)) {
        throw new ProviderFailure('PROVIDER_DOMAIN_MISMATCH');
      }
      let outcome: OperationOutcome;
      if (action === 'register_webhook') outcome = await registerWebhook(deps, call);
      else {
        if (!deps.storage) throw new ProviderFailure('PROVIDER_CONFIG_INVALID');
        const cleanup = (path: string) => {
          if (path !== `/rooms/pc-live-verify-${operationId!.replaceAll('-', '')}`) throw new ProviderFailure('INVALID_OPERATION');
          return providerCall(deps, AbortSignal.timeout(5000))(path, 'DELETE');
        };
        outcome = await deps.storage.verify({ call, cleanup, operationId, ...deps.storage, now: deps.now });
      }
      if (await finish(true, outcome.receipt) !== true) throw new ProviderFailure('COMPLETION_UNCONFIRMED');
      return reply(200, { ok: true, operation_id: operationId, action, result: outcome.receipt,
        provider: { domain_id: deps.domainId, domain_name: domain.domain_name, ...outcome.metadata } });
    } catch (error) {
      const receipt = failureReceipt(error);
      if (claimed) {
        try { if (await finish(false, receipt) !== true) return reply(503, { ok: false, error: 'COMPLETION_UNCONFIRMED', operation_id: operationId }); }
        catch { return reply(503, { ok: false, error: 'COMPLETION_UNCONFIRMED', operation_id: operationId }); }
      }
      const conflict = receipt.code === 'PROVIDER_WEBHOOK_CONFLICT' || receipt.code === 'PROVIDER_DOMAIN_MISMATCH';
      return reply(conflict ? 409 : 503, { ok: false, operation_id: operationId, action, result: receipt });
    }
  };
}
