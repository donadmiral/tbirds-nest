import { ProviderFailure } from './handler.ts';
import type { OperationOutcome, OperationReceipt, ProviderCall } from './handler.ts';

export type StorageVerificationDependencies = {
  call: ProviderCall;
  cleanup: (path: string) => Promise<unknown>;
  operationId: string;
  bucket: string;
  region: string;
  assumeRoleArn: string;
  endpointName: string;
  now?: () => number;
};

const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> | null => value !== null
  && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const providerStatus = (error: unknown): number | undefined => error instanceof ProviderFailure
  && Number.isInteger(error.providerStatus) && error.providerStatus! >= 100 && error.providerStatus! <= 599
  ? error.providerStatus : undefined;
const providerErrors = ['invalid-request-error', 'authentication-error', 'authorization-error', 'not-found-error', 'rate-limit-error', 'unclassified'];
const providerReasons = ['billing_required', 'role_assumption_denied', 'storage_access_denied', 'configuration_invalid', 'unclassified'];

// Do not forward provider response messages, arbitrary error codes, URLs, or
// credentials. Preserve only the handler's finite error and reason vocabulary.
function failure(error: unknown, code: 'STORAGE_VERIFICATION_FAILED' | 'STORAGE_CLEANUP_UNCONFIRMED') {
  const known = error instanceof ProviderFailure;
  const kind = known && error.providerError ? providerErrors.includes(error.providerError) ? error.providerError : 'unclassified' : undefined;
  const reason = known && error.providerReason ? providerReasons.includes(error.providerReason) ? error.providerReason : 'unclassified' : undefined;
  return new ProviderFailure(code, providerStatus(error), kind, reason);
}

function sameFields(actual: unknown, expected: Record<string, unknown>): boolean {
  const value = object(actual);
  return value !== null && Object.entries(expected).every(([key, entry]) => value[key] === entry);
}

/**
 * Call only after a claimed, purpose-specific operator capability and a verified
 * Daily domain. No room joins, tokens, recording starts, or broadcast starts.
 * Daily's documented recordings_bucket update uploads daily-co-test-upload.txt;
 * HLS settings acceptance is a separate check, not proof of playable HLS.
 * https://docs.daily.co/docs/guides/features/recording/custom-s3-storage
 */
export async function verifyStorage(deps: StorageVerificationDependencies): Promise<OperationOutcome> {
  const now = deps.now?.() ?? Date.now();
  if (!uuid(deps.operationId) || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(deps.bucket)
    || deps.bucket.includes('..') || /^\d+\.\d+\.\d+\.\d+$/.test(deps.bucket)
    || !/^[a-z]{2}-[a-z]+-[1-9]\d?$/.test(deps.region)
    || !/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/.test(deps.assumeRoleArn)
    || !/^[A-Za-z0-9_-]{1,64}$/.test(deps.endpointName)
    || !Number.isSafeInteger(now) || now < 0 || Math.floor(now / 1000) + 300 > 2147483647) {
    throw new ProviderFailure('PROVIDER_CONFIG_INVALID');
  }
  const operationId = deps.operationId.toLowerCase();
  const roomName = `pc-live-verify-${operationId.replaceAll('-', '')}`;
  const path = `/rooms/${roomName}`;
  const expires = Math.floor(now / 1000) + 300;
  const bucket = { bucket_name: deps.bucket, bucket_region: deps.region, assume_role_arn: deps.assumeRoleArn, allow_api_access: false };
  const storage = { bucket_name: deps.bucket, bucket_region: deps.region, assume_role_arn: deps.assumeRoleArn,
    path_template: `live/${operationId}/{instance_id}` };
  const variants = [
    { width: 1920, height: 1080, fps: 30, bitrate: 2500, iframe_only: false },
    { width: 1280, height: 720, fps: 30, bitrate: 1500, iframe_only: false },
    { width: 640, height: 360, fps: 24, bitrate: 700, iframe_only: false },
    { width: 320, height: 180, fps: 24, bitrate: 200, iframe_only: false },
  ];
  const endpoint = { name: deps.endpointName, type: 'hls', hls_config: { save_hls_recording: true, variants, storage } };
  const identity = (value: unknown): boolean => {
    const room = object(value);
    return room?.name === roomName && uuid(room.id);
  };
  const isolated = (value: unknown): boolean => {
    const room = object(value), config = object(room?.config);
    return identity(room) && room?.privacy === 'private' && config?.exp === expires
      && config.eject_at_room_exp === true && config.enable_knocking === false;
  };
  const matches = (value: unknown): boolean => {
    const room = object(value), config = object(room?.config);
    const endpoints = config?.streaming_endpoints;
    if (!isolated(room) || !sameFields(config?.recordings_bucket, bucket) || !Array.isArray(endpoints) || endpoints.length !== 1) return false;
    const target = object(endpoints[0]), hls = object(target?.hls_config), actualVariants = hls?.variants;
    return target?.name === endpoint.name && target.type === 'hls' && hls?.save_hls_recording === true
      && sameFields(hls.storage, storage) && Array.isArray(actualVariants) && actualVariants.length === variants.length
      && variants.every((variant, index) => sameFields(actualVariants[index], variant));
  };
  let attempted = false, owned = false, rejected = false, configurationMatches = false;
  let cleanupConfirmed: boolean | undefined;
  let operationError: ProviderFailure | undefined;
  try {
    // A collision is never permission to update or delete someone else's room.
    try {
      await deps.call(path, 'GET', undefined, 5000);
      throw new ProviderFailure('STORAGE_VERIFICATION_FAILED');
    } catch (error) {
      if (providerStatus(error) !== 404) throw error;
    }
    attempted = true;
    let created: unknown;
    try {
      created = await deps.call('/rooms', 'POST', { name: roomName, privacy: 'private', properties: {
        exp: expires, eject_at_room_exp: true, max_participants: 1, enable_knocking: false,
        start_audio_off: true, start_video_off: true, enable_screenshare: false,
      } }, 5000);
    } catch (error) {
      const status = providerStatus(error);
      rejected = status !== undefined && status >= 400 && status < 500;
      throw error;
    }
    owned = identity(created);
    if (!isolated(created)) throw new ProviderFailure('PROVIDER_RESPONSE_INVALID');
    await deps.call(path, 'POST', { properties: { recordings_bucket: bucket } }, 15000);
    await deps.call(path, 'POST', { properties: { streaming_endpoints: [endpoint] } }, 5000);
    const stored = await deps.call(path, 'GET', undefined, 5000);
    if (!matches(stored)) throw new ProviderFailure('PROVIDER_RESPONSE_INVALID');
    configurationMatches = true;
  } catch (error) {
    operationError = failure(error, 'STORAGE_VERIFICATION_FAILED');
  } finally {
    if (attempted && !owned && !rejected) {
      // A timeout may occur after create reached Daily. Reconcile only the exact
      // generated name and our expiry. Unknown ownership is never deleted.
      try {
        const candidate = await deps.call(path, 'GET', undefined, 5000);
        owned = identity(candidate) && object(object(candidate)?.config)?.exp === expires;
      } catch { /* Keep ambiguity explicit; expiry blocks joining but is not deletion. */ }
    }
    if (owned) {
      try {
        // cleanup has its own 5-second budget, independent of the main deadline.
        const result = object(await deps.cleanup(path));
        cleanupConfirmed = result?.deleted === true && result.name === roomName;
        if (!cleanupConfirmed) operationError = new ProviderFailure('STORAGE_CLEANUP_UNCONFIRMED');
      } catch (error) {
        cleanupConfirmed = false;
        operationError = failure(error, 'STORAGE_CLEANUP_UNCONFIRMED');
      }
    } else if (attempted && !rejected) {
      cleanupConfirmed = false;
      operationError = new ProviderFailure('STORAGE_CLEANUP_UNCONFIRMED');
    }
  }
  const receipt: OperationReceipt = { code: operationError ? operationError.message : 'STORAGE_VERIFIED',
    resource_id: operationId, mutation_attempted: attempted, configuration_matches: configurationMatches,
    ...(cleanupConfirmed === undefined ? {} : { cleanup_confirmed: cleanupConfirmed }) };
  if (operationError) {
    operationError.receipt = receipt;
    throw operationError;
  }
  return { receipt, metadata: { room_name: roomName, recordings_bucket_verified: true,
    hls_configuration_verified: true, broadcast_started: false, cleanup_confirmed: true } };
}
