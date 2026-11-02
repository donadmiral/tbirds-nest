import { waitForPush } from './pushDelivery.ts';

// Decoding is only an inexpensive rejection filter. The Data API verifies the
// signature and database role; decoded claims never authorize a request here.
function claimedRole(value: string): unknown {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) || value.length > 4096) return null;
  try {
    const encoded = value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))).role;
  } catch { return null; }
}

export function createLegacyServiceAuthorizer(options: { base: string; publicKey: string; fetch: typeof fetch }) {
  return async (request: Request, signal: AbortSignal): Promise<boolean> => {
    const supplied = /^Bearer ([^\s]+)$/i.exec(request.headers.get('Authorization') || '')?.[1];
    if (!supplied || claimedRole(supplied) !== 'service_role') return false;
    // A privileged apikey could change gateway role precedence. Never use one
    // to establish the privileges of a different incoming bearer credential.
    const unprivileged = /^sb_publishable_[A-Za-z0-9_-]{1,200}$/.test(options.publicKey)
      || claimedRole(options.publicKey) === 'anon';
    if (!unprivileged) throw new Error('PUBLIC_AUTH_KEY_UNAVAILABLE');
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    const response = await waitForPush(options.fetch(options.base.replace(/\/$/, '') + '/rest/v1/rpc/authorize_legacy_push_service', {
      method: 'POST', headers: { apikey: options.publicKey, Authorization: 'Bearer ' + supplied, 'Content-Type': 'application/json' },
      body: '{}', redirect: 'error', signal: deadline,
    }), deadline);
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) return false;
      throw new Error('SERVICE_AUTH_UNAVAILABLE');
    }
    return await waitForPush(response.json(), deadline) === true;
  };
}
