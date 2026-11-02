import type { createClient } from './supabase/client';
import { createClient as createAuthClient } from '@supabase/supabase-js';
import { businessSessionContract, exchangeLegacyBusinessSession, parseBusinessDevice, parseBusinessSessionResult, type BusinessDevice, type BusinessSessionDestination, type BusinessSessionResult, type LegacyBusinessAuthClient } from '../../shared/businessSession';

export const BUSINESS_DEVICE_STORAGE_KEY = 'pc:business-device:v2';
const messages: Record<string, string> = {
  ACCOUNT_CHANGED: 'Your account changed. Review the current account and try again.',
  ACCOUNT_UNAVAILABLE: 'Your current account could not be confirmed. Check your connection and try again.',
  DEVICE_UNAVAILABLE: 'This browser could not securely save its business registration. Allow site storage or use another browser, then try again.',
  DEVICE_APPROVAL_REQUIRED: 'This browser needs approval. Ask a business owner or administrator to review it in Studio → Team, then try again.',
  DEVICE_BLOCKED: 'This browser is blocked from business access. Ask a business owner to review its registration.',
  ACCESS_REJECTED: 'Business access could not be verified. Check your handle and personal access code, or ask your business owner to review your membership.',
  ACTIVE_OWNER_SESSION_REQUIRED: 'Sign in to the personal account that currently owns this business, then try again.',
  OWNER_BOOTSTRAP_REQUIRED: 'Set up your owner access before opening this business.',
  TRY_LATER: 'There have been too many sign-in attempts. Wait a few minutes before trying again.',
  BUSINESS_SESSION_UNAVAILABLE: 'Business sign-in could not be completed. Check the selected account and try again.',
  SESSION_MISMATCH: 'The returned business session could not be verified. Sign in again before opening Studio.',
  CANCELLED: 'Business sign-in cancelled.',
  TIMED_OUT: 'Business sign-in took too long. Check your connection and try again.',
  LEGACY_OWNER_APPLICATION_REQUIRED: 'Open this business from your approved application, or use your personal team access code.',
};
export class BusinessAccessError extends Error {
  constructor(readonly code: string) { super(Object.hasOwn(messages, code) ? messages[code] : 'Business access could not be confirmed. Please try again.'); }
}

/** A device secret belongs to this browser installation, never to a shared fallback ID. */
export function getBusinessDevice(storage?: Pick<Storage, 'getItem' | 'setItem'>, cryptography?: Pick<Crypto, 'randomUUID' | 'getRandomValues'>): BusinessDevice {
  try {
    const store = storage ?? globalThis.localStorage, random = cryptography ?? globalThis.crypto;
    const saved = store.getItem(BUSINESS_DEVICE_STORAGE_KEY);
    if (saved !== null) {
      const device = parseBusinessDevice(saved);
      if (!device) throw new Error('Invalid stored device registration');
      return device;
    }
    const bytes = random.getRandomValues(new Uint8Array(32));
    const device = parseBusinessDevice({ device_id: random.randomUUID(), device_key: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') });
    if (!device) throw new Error('Device generation failed');
    const encoded = JSON.stringify(device);
    store.setItem(BUSINESS_DEVICE_STORAGE_KEY, encoded);
    if (store.getItem(BUSINESS_DEVICE_STORAGE_KEY) !== encoded) throw new Error('Device storage failed');
    return device;
  } catch { throw new BusinessAccessError('DEVICE_UNAVAILABLE'); }
}

export function getLegacyBusinessDeviceId(storage?: Pick<Storage, 'getItem' | 'setItem'>, cryptography?: Pick<Crypto, 'randomUUID'>): string {
  try {
    const store = storage ?? globalThis.localStorage;
    let id = store.getItem('pc_business_device_id');
    if (id === null) {
      id = (cryptography ?? globalThis.crypto).randomUUID();
      store.setItem('pc_business_device_id', id);
      if (store.getItem('pc_business_device_id') !== id) throw new Error('Device storage failed');
    }
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(id) || id === 'web-unknown-device') throw new Error('Device unavailable');
    return id;
  } catch { throw new BusinessAccessError('DEVICE_UNAVAILABLE'); }
}

export function businessAccessMessage(error: unknown): string {
  return error instanceof BusinessAccessError ? error.message : 'Business access could not be confirmed. Check your connection and try again.';
}

export async function businessAccessStep<T>(work: PromiseLike<T>, signal: AbortSignal, timeout = 15_000): Promise<T> {
  if (signal.aborted) throw new BusinessAccessError('CANCELLED');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (() => void) | undefined;
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new BusinessAccessError('CANCELLED'));
      signal.addEventListener('abort', rejectAbort, { once: true });
      timer = setTimeout(() => reject(new BusinessAccessError('TIMED_OUT')), timeout);
    })]);
  } finally { clearTimeout(timer); if (rejectAbort) signal.removeEventListener('abort', rejectAbort); }
}

type Client = ReturnType<typeof createClient>;
export async function confirmBusinessViewer(client: Client, owner: string | null, current: () => boolean, signal: AbortSignal): Promise<void> {
  const { data, error } = await businessAccessStep(client.auth.getUser(), signal);
  if (!current()) throw new BusinessAccessError('ACCOUNT_CHANGED');
  if (error && error.name !== 'AuthSessionMissingError') throw new BusinessAccessError('ACCOUNT_UNAVAILABLE');
  if ((data.user?.id ?? null) !== owner) throw new BusinessAccessError('ACCOUNT_CHANGED');
}

/** Reject unbound/legacy responses and show only recognized, public error codes. */
export async function requireBusinessSession(data: unknown, failure: unknown, signal: AbortSignal): Promise<BusinessSessionResult> {
  if (!failure) {
    const result = parseBusinessSessionResult(data);
    if (result) return result;
  }
  let detail = data;
  const context = failure && typeof failure === 'object' && 'context' in failure ? failure.context : null;
  if (context && typeof context === 'object' && 'json' in context && typeof context.json === 'function') {
    try { detail = await businessAccessStep(context.json(), signal); } catch { /* The response may already be consumed. */ }
  }
  if (signal.aborted) throw new BusinessAccessError('CANCELLED');
  const code = detail && typeof detail === 'object' && 'code' in detail && typeof detail.code === 'string' ? detail.code : 'BUSINESS_SESSION_UNAVAILABLE';
  throw new BusinessAccessError(code);
}

/** Validate the destination with Auth before allowing it to replace the current account. */
export async function confirmBusinessDestination(client: Client, result: BusinessSessionDestination, signal: AbortSignal): Promise<void> {
  const { data, error } = await businessAccessStep(client.auth.getUser(result.session.access_token), signal);
  if (error || data.user?.id !== result.business_id) throw new BusinessAccessError('SESSION_MISMATCH');
}

type BusinessOwnerTarget = { applicationId: string; businessId?: never } | { businessId: string; applicationId?: never };
async function legacyOwnerApplication(client: Client, businessId: string, owner: string, signal: AbortSignal): Promise<string> {
  const owned = await businessAccessStep(client.rpc('get_my_businesses'), signal);
  const business = !owned.error && Array.isArray(owned.data) ? owned.data.find(row => row.business_id === businessId && row.role === 'owner') : null;
  if (!business || typeof business.username !== 'string') throw new BusinessAccessError('ACTIVE_OWNER_SESSION_REQUIRED');
  const applications = await businessAccessStep(client.from('business_applications').select('id').eq('applicant_id', owner)
    .eq('status', 'approved').eq('desired_username', business.username).limit(2), signal);
  if (applications.error || applications.data?.length !== 1 || typeof applications.data[0].id !== 'string') throw new BusinessAccessError('LEGACY_OWNER_APPLICATION_REQUIRED');
  return applications.data[0].id;
}

async function legacyDestination(client: Client, response: { data: unknown; error: unknown }, owner: string | null, current: () => boolean, signal: AbortSignal, expected: { businessId?: string; handle?: string }): Promise<BusinessSessionDestination> {
  const isolated = createAuthClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'pc-business-legacy-exchange' },
  });
  try {
    return await businessAccessStep(exchangeLegacyBusinessSession(isolated as unknown as LegacyBusinessAuthClient, response, {
      ...expected, current: () => current() && !signal.aborted,
      verifyCurrent: async () => {
        await confirmBusinessViewer(client, owner, current, signal);
        if (await businessAccessStep(businessSessionContract(client), signal) !== 'legacy') throw new BusinessAccessError('BUSINESS_SESSION_UNAVAILABLE');
        if (!current() || signal.aborted) throw new BusinessAccessError('CANCELLED');
      },
    }), signal);
  } catch (error) {
    if (error instanceof BusinessAccessError) throw error;
    throw new BusinessAccessError(error instanceof Error && error.message === 'SESSION_MISMATCH' ? 'SESSION_MISMATCH' : 'BUSINESS_SESSION_UNAVAILABLE');
  }
}

export async function prepareBusinessTeamSession(client: Client, handle: string, code: string, owner: string | null, current: () => boolean, signal: AbortSignal): Promise<BusinessSessionDestination> {
  await confirmBusinessViewer(client, owner, current, signal);
  const contract = await businessAccessStep(businessSessionContract(client), signal);
  if (!current() || signal.aborted) throw new BusinessAccessError('CANCELLED');
  const device = contract === 'legacy' ? { device_id: getLegacyBusinessDeviceId() } : getBusinessDevice();
  const response = await businessAccessStep(client.functions.invoke('business-signin', {
    body: { handle, code, ...device, device_label: 'Web browser' }, signal, timeout: 15_000,
  }), signal);
  if (!current() || signal.aborted) throw new BusinessAccessError('CANCELLED');
  if (contract === 'legacy') return legacyDestination(client, response, owner, current, signal, { handle });
  const destination = await requireBusinessSession(response.data, response.error, signal);
  await confirmBusinessDestination(client, destination, signal);
  await confirmBusinessViewer(client, owner, current, signal);
  return destination;
}

/** Both application owners and current transferred owners use the same bound handoff. */
export async function prepareBusinessOwnerSession(client: Client, target: BusinessOwnerTarget, owner: string, current: () => boolean, signal: AbortSignal, bootstrapOwner = false): Promise<BusinessSessionDestination> {
  await confirmBusinessViewer(client, owner, current, signal);
  const contract = await businessAccessStep(businessSessionContract(client), signal);
  if (!current() || signal.aborted) throw new BusinessAccessError('CANCELLED');
  if (contract === 'legacy') {
    if (bootstrapOwner) throw new BusinessAccessError('BUSINESS_SESSION_UNAVAILABLE');
    const applicationId = target.applicationId ?? await legacyOwnerApplication(client, target.businessId, owner, signal);
    await confirmBusinessViewer(client, owner, current, signal);
    const response = await businessAccessStep(client.functions.invoke('business-owner-access', { body: { application_id: applicationId }, signal, timeout: 15_000 }), signal);
    if (!current() || signal.aborted) throw new BusinessAccessError('CANCELLED');
    return legacyDestination(client, response, owner, current, signal, { businessId: target.businessId });
  }
  const device = getBusinessDevice();
  const response = await businessAccessStep(client.functions.invoke('business-owner-access', {
    body: { ...(target.businessId ? { business_id: target.businessId } : { application_id: target.applicationId }), ...device, device_label: 'Web browser', ...(bootstrapOwner ? { bootstrap_owner: true } : {}) },
    signal, timeout: 15_000,
  }), signal);
  if (!current() || signal.aborted) throw new BusinessAccessError('CANCELLED');
  const destination = await requireBusinessSession(response.data, response.error, signal);
  if (!current() || signal.aborted) throw new BusinessAccessError('CANCELLED');
  if (target.businessId && destination.business_id !== target.businessId) throw new BusinessAccessError('SESSION_MISMATCH');
  await confirmBusinessDestination(client, destination, signal);
  await confirmBusinessViewer(client, owner, current, signal);
  return destination;
}

export type BusinessSessionHandoff = { businessId: string; accessToken: string };
export function isBusinessSessionHandoff(expected: BusinessSessionHandoff | null, session: { user: { id: string }; access_token: string } | null): boolean {
  return !!expected && session?.user.id === expected.businessId && session.access_token === expected.accessToken;
}
