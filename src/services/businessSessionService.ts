import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { createClient as createAuthClient } from '@supabase/supabase-js';
import type { supabase } from './supabase';
import { businessSessionContract, exchangeLegacyBusinessSession, parseBusinessDevice, parseBusinessSessionResult, type BusinessDevice, type BusinessSessionDestination, type BusinessSessionResult, type LegacyBusinessAuthClient } from '../../shared/businessSession';

// SecureStore allows letters, numbers, periods, dashes and underscores in keys.
export const BUSINESS_DEVICE_STORAGE_KEY = 'pc.business-device.v2';
const storageOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
let deviceRequest: Promise<BusinessDevice> | null = null;

const messages: Record<string, string> = {
  ACCOUNT_CHANGED: 'Your account changed. Review the selected account and try again.',
  ACCOUNT_UNAVAILABLE: 'Your current account could not be confirmed. Check your connection and try again.',
  DEVICE_UNAVAILABLE: 'This device could not securely save its business registration. Unlock your device and try again.',
  DEVICE_APPROVAL_REQUIRED: 'This device needs approval. Ask a business owner or administrator to review it in Studio → Team, then try again.',
  DEVICE_BLOCKED: 'This device is blocked from business access. Ask a business owner to review its registration.',
  ACCESS_REJECTED: 'Business access could not be verified. Check your handle and personal access code, or ask the owner to review your membership.',
  ACTIVE_OWNER_SESSION_REQUIRED: 'Sign in to the personal account that currently owns this business, then try again.',
  OWNER_BOOTSTRAP_REQUIRED: 'Set up your owner access before opening this business.',
  TRY_LATER: 'There have been too many sign-in attempts. Wait a few minutes before trying again.',
  BUSINESS_SESSION_UNAVAILABLE: 'Business sign-in could not be completed. Check the selected account and try again.',
  SESSION_MISMATCH: 'The returned business session could not be verified. Sign in again before opening Studio.',
  CANCELLED: 'Business sign-in cancelled.',
  TIMED_OUT: 'Business sign-in took too long. Check your connection and try again.',
  LEGACY_OWNER_APPLICATION_REQUIRED: 'Open this business from your approved application, or use your personal team access code.',
};

export class BusinessSessionError extends Error {
  constructor(readonly code: string) {
    super(Object.prototype.hasOwnProperty.call(messages, code) ? messages[code] : 'Business access could not be confirmed. Please try again.');
  }
}

export function businessSessionMessage(error: unknown): string {
  return error instanceof BusinessSessionError ? error.message : 'Business access could not be confirmed. Check your connection and try again.';
}

/** One installation gets one secret; concurrent screens cannot overwrite it. */
export function getBusinessDevice(): Promise<BusinessDevice> {
  if (deviceRequest) return deviceRequest;
  const request = (async () => {
    try {
      const saved = await SecureStore.getItemAsync(BUSINESS_DEVICE_STORAGE_KEY, storageOptions);
      if (saved !== null) {
        const device = parseBusinessDevice(saved);
        if (!device) throw new Error('Invalid stored device registration');
        return device;
      }
      const bytes = await Crypto.getRandomBytesAsync(32);
      if (bytes.length !== 32) throw new Error('Secure device generation failed');
      const device = parseBusinessDevice({ device_id: Crypto.randomUUID(), device_key: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') });
      if (!device) throw new Error('Secure device generation failed');
      const encoded = JSON.stringify(device);
      await SecureStore.setItemAsync(BUSINESS_DEVICE_STORAGE_KEY, encoded, storageOptions);
      if (await SecureStore.getItemAsync(BUSINESS_DEVICE_STORAGE_KEY, storageOptions) !== encoded) throw new Error('Device registration was not saved');
      return device;
    } catch { throw new BusinessSessionError('DEVICE_UNAVAILABLE'); }
  })();
  deviceRequest = request;
  void request.then(() => { if (deviceRequest === request) deviceRequest = null; }, () => { if (deviceRequest === request) deviceRequest = null; });
  return request;
}

/** Keep the registered device identity used by the currently deployed legacy backend. */
export async function getLegacyBusinessDeviceId(): Promise<string> {
  try {
    const id = Platform.OS === 'ios' ? await Application.getIosIdForVendorAsync() : Application.getAndroidId();
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,180}$/.test(id)) throw new Error('Device unavailable');
    return `${Platform.OS === 'ios' ? 'ios' : 'android'}-${id}`;
  } catch { throw new BusinessSessionError('DEVICE_UNAVAILABLE'); }
}

export async function businessSessionStep<T>(work: PromiseLike<T>, signal: AbortSignal, timeout = 15_000): Promise<T> {
  if (signal.aborted) throw new BusinessSessionError('CANCELLED');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
      onAbort = () => reject(new BusinessSessionError('CANCELLED'));
      signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => reject(new BusinessSessionError('TIMED_OUT')), timeout);
    })]);
  } finally { clearTimeout(timer); if (onAbort) signal.removeEventListener('abort', onAbort); }
}

type Client = typeof supabase;
function confirmCurrent(current: () => boolean, signal: AbortSignal): void {
  if (signal.aborted) throw new BusinessSessionError('CANCELLED');
  if (!current()) throw new BusinessSessionError('ACCOUNT_CHANGED');
}

export async function confirmBusinessViewer(client: Client, owner: string | null, current: () => boolean, signal: AbortSignal): Promise<void> {
  confirmCurrent(current, signal);
  const { data, error } = await businessSessionStep(client.auth.getUser(), signal);
  confirmCurrent(current, signal);
  if (error && error.name !== 'AuthSessionMissingError') throw new BusinessSessionError('ACCOUNT_UNAVAILABLE');
  if ((data.user?.id ?? null) !== owner) throw new BusinessSessionError('ACCOUNT_CHANGED');
}

async function requireBusinessSession(data: unknown, failure: unknown, signal: AbortSignal): Promise<BusinessSessionResult> {
  if (!failure) {
    const result = parseBusinessSessionResult(data);
    if (result) return result;
  }
  let detail = data;
  const context = failure && typeof failure === 'object' && 'context' in failure ? failure.context : null;
  if (context && typeof context === 'object' && 'json' in context && typeof context.json === 'function') {
    try { detail = await businessSessionStep(context.json(), signal); } catch { /* A failed or consumed response never grants access. */ }
  }
  if (signal.aborted) throw new BusinessSessionError('CANCELLED');
  const code = detail && typeof detail === 'object' && 'code' in detail && typeof detail.code === 'string' ? detail.code : 'BUSINESS_SESSION_UNAVAILABLE';
  throw new BusinessSessionError(code);
}

type BusinessRequest = { kind: 'team'; handle: string; code: string }
  | ({ kind: 'owner'; bootstrapOwner?: boolean } & ({ applicationId: string; businessId?: never } | { businessId: string; applicationId?: never }));
async function legacyOwnerApplication(client: Client, businessId: string, owner: string, signal: AbortSignal): Promise<string> {
  const owned = await businessSessionStep(client.rpc('get_my_businesses'), signal);
  const business = !owned.error && Array.isArray(owned.data) ? owned.data.find(row => row.business_id === businessId && row.role === 'owner') : null;
  if (!business || typeof business.username !== 'string') throw new BusinessSessionError('ACTIVE_OWNER_SESSION_REQUIRED');
  const applications = await businessSessionStep(client.from('business_applications').select('id').eq('applicant_id', owner)
    .eq('status', 'approved').eq('desired_username', business.username).limit(2), signal);
  if (applications.error || applications.data?.length !== 1 || typeof applications.data[0].id !== 'string') throw new BusinessSessionError('LEGACY_OWNER_APPLICATION_REQUIRED');
  return applications.data[0].id;
}

async function prepareLegacyBusinessSession(client: Client, request: BusinessRequest, owner: string | null, current: () => boolean, signal: AbortSignal, deviceLabel: string): Promise<BusinessSessionDestination> {
  if (request.kind === 'owner' && (!owner || request.bootstrapOwner)) throw new BusinessSessionError('ACTIVE_OWNER_SESSION_REQUIRED');
  const body = request.kind === 'team'
    ? { handle: request.handle, code: request.code, device_id: await businessSessionStep(getLegacyBusinessDeviceId(), signal), device_label: deviceLabel }
    : { application_id: request.applicationId ?? await legacyOwnerApplication(client, request.businessId, owner!, signal) };
  await confirmBusinessViewer(client, owner, current, signal);
  const response = await businessSessionStep(client.functions.invoke(request.kind === 'team' ? 'business-signin' : 'business-owner-access', { body, signal, timeout: 15_000 }), signal);
  confirmCurrent(current, signal);
  const isolated = createAuthClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'pc-business-legacy-exchange' },
  });
  try {
    // The adapter narrows the SDK's recursive query generics; every returned
    // session and profile field is validated as unknown by the shared helper.
    return await businessSessionStep(exchangeLegacyBusinessSession(isolated as unknown as LegacyBusinessAuthClient, response, {
      current: () => current() && !signal.aborted,
      businessId: request.kind === 'owner' ? request.businessId : undefined,
      handle: request.kind === 'team' ? request.handle : undefined,
      verifyCurrent: async () => {
        await confirmBusinessViewer(client, owner, current, signal);
        if (await businessSessionStep(businessSessionContract(client), signal) !== 'legacy') throw new BusinessSessionError('BUSINESS_SESSION_UNAVAILABLE');
        confirmCurrent(current, signal);
      },
    }), signal);
  } catch (error) {
    if (error instanceof BusinessSessionError) throw error;
    throw new BusinessSessionError(error instanceof Error && error.message === 'SESSION_MISMATCH' ? 'SESSION_MISMATCH' : 'BUSINESS_SESSION_UNAVAILABLE');
  }
}

export async function prepareBusinessSession(client: Client, request: BusinessRequest, owner: string | null, current: () => boolean, signal: AbortSignal, deviceLabel: string): Promise<BusinessSessionDestination> {
  await confirmBusinessViewer(client, owner, current, signal);
  const contract = await businessSessionStep(businessSessionContract(client), signal);
  confirmCurrent(current, signal);
  if (contract === 'legacy') return prepareLegacyBusinessSession(client, request, owner, current, signal, deviceLabel);
  const device = await businessSessionStep(getBusinessDevice(), signal);
  confirmCurrent(current, signal);
  const endpoint = request.kind === 'team' ? 'business-signin' : 'business-owner-access';
  const body = request.kind === 'team'
    ? { handle: request.handle, code: request.code, ...device, device_label: deviceLabel }
    : { ...(request.businessId ? { business_id: request.businessId } : { application_id: request.applicationId }), ...device, device_label: deviceLabel, ...(request.bootstrapOwner ? { bootstrap_owner: true } : {}) };
  const response = await businessSessionStep(client.functions.invoke(endpoint, { body, signal, timeout: 15_000 }), signal);
  confirmCurrent(current, signal);
  const destination = await requireBusinessSession(response.data, response.error, signal);
  confirmCurrent(current, signal);
  if (request.kind === 'owner' && request.businessId && destination.business_id !== request.businessId) throw new BusinessSessionError('SESSION_MISMATCH');
  // Validate the destination without replacing the current account.
  const verified = await businessSessionStep(client.auth.getUser(destination.session.access_token), signal);
  confirmCurrent(current, signal);
  if (verified.error || verified.data.user?.id !== destination.business_id) throw new BusinessSessionError('SESSION_MISMATCH');
  await confirmBusinessViewer(client, owner, current, signal);
  return destination;
}

export type BusinessSessionHandoff = { businessId: string; accessToken: string };
export function isBusinessSessionHandoff(expected: BusinessSessionHandoff | null, session: { user: { id: string }; access_token: string } | null): boolean {
  return !!expected && session?.user.id === expected.businessId && session.access_token === expected.accessToken;
}

/** Final installation cannot be cancelled; callers disable Cancel before entry. */
export async function installBusinessSession(client: Client, destination: BusinessSessionDestination, current: () => boolean, signal: AbortSignal): Promise<void> {
  confirmCurrent(current, signal);
  const installed = await client.auth.setSession(destination.session);
  confirmCurrent(current, signal);
  if (installed.error || installed.data.session?.user.id !== destination.business_id || installed.data.user?.id !== destination.business_id) throw new BusinessSessionError('SESSION_MISMATCH');
  const selected = await businessSessionStep(client.auth.getSession(), signal);
  confirmCurrent(current, signal);
  if (selected.error || selected.data.session?.user.id !== destination.business_id) throw new BusinessSessionError('SESSION_MISMATCH');
}
