type Result<T> = { data: T; error?: unknown };
type User = { id: string; email?: string };
type Session = { access_token: string; refresh_token: string; user: User };
export type BusinessSessionDependencies = {
  rpc(name: string, args: Record<string, unknown>): Promise<Result<unknown>>;
  getUser(token: string): Promise<Result<{ user: User | null }>>;
  getClaims(token: string): Promise<Result<{ claims?: Record<string, unknown> } | null>>;
  getUserById(id: string): Promise<Result<{ user: User | null }>>;
  generateLink(email: string): Promise<Result<{ properties?: { hashed_token?: string } | null }>>;
  exchange(tokenHash: string): Promise<Result<{ session: Session | null }>>;
  revoke(accessToken: string): Promise<unknown>;
  hash(value: string): Promise<string>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const headers = {
  'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store', 'Surrogate-Control': 'no-store', 'Pragma': 'no-cache',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type,apikey,x-client-info',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
const errors: Record<string, [number, string]> = {
  ACCESS_REJECTED: [401, 'Business access was not accepted. Check the handle and your active access code.'],
  ACTIVE_OWNER_SESSION_REQUIRED: [401, 'Sign in to the personal account that currently owns this business.'],
  BUSINESS_ACCOUNT_UNAVAILABLE: [403, 'This business account is unavailable. Contact support for a review.'],
  DEVICE_APPROVAL_REQUIRED: [403, 'This device needs approval from a business owner or administrator.'],
  DEVICE_BLOCKED: [403, 'This device was removed. A business owner or administrator must approve it again.'],
  DEVICE_LIMIT: [403, 'The business device limit has been reached. Ask an administrator to review devices.'],
  MEMBER_LIMIT: [403, 'The business member limit has been reached. Ask an owner to review the team.'],
  OWNER_SIGNIN_REQUIRED: [403, 'Open this owner seat from your personal account and your businesses.'],
  OWNER_BOOTSTRAP_REQUIRED: [409, 'Confirm creation of your owner seat and registration of the first owner device.'],
  TRY_LATER: [429, 'Too many business sign-in attempts. Try again in ten minutes.'],
};

export function createBusinessSessionHandler(mode: 'code' | 'owner', deps: BusinessSessionDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers });
    if (request.method !== 'POST') return reply(405, { code: 'METHOD_NOT_ALLOWED', error: 'POST required.' });
    let grantId: string | null = null, businessId: string | null = null, sessionId: string | null = null, issued: Session | null = null;
    let committed = false;
    try {
      const text = await request.text();
      if (text.length > 6000) return reply(400, { code: 'INVALID_REQUEST', error: 'Sign-in details are too large.' });
      let body: unknown;
      try { body = JSON.parse(text); } catch { return reply(400, { code: 'INVALID_REQUEST', error: 'Invalid sign-in details.' }); }
      if (!object(body) || typeof body.device_id !== 'string' || !uuid.test(body.device_id)
        || typeof body.device_key !== 'string' || !/^[0-9a-f]{64}$/.test(body.device_key)
        || typeof body.device_label !== 'string' || body.device_label.length > 100) {
        return reply(400, { code: 'DEVICE_REQUIRED', error: 'A secure device registration is required. Enable local device storage and try again.' });
      }
      const proof = await deps.hash(body.device_key);
      let prepared: Result<unknown>;
      if (mode === 'code') {
        if (typeof body.handle !== 'string' || !/^[a-z0-9_]{3,32}$/i.test(body.handle.trim().replace(/^@/, ''))
          || typeof body.code !== 'string' || body.code.trim().length < 4 || body.code.length > 200) {
          return reply(400, { code: 'INVALID_REQUEST', error: 'A business handle and your access code are required.' });
        }
        prepared = await deps.rpc('triniti_business_signin_check', {
          p_handle: body.handle.trim().toLowerCase().replace(/^@/, ''),
          p_code_hash: await deps.hash(body.code.trim().toUpperCase()),
          p_device: body.device_id.toLowerCase(), p_proof_hash: proof, p_label: body.device_label,
        });
      } else {
        const application = typeof body.application_id === 'string' && uuid.test(body.application_id) ? body.application_id : null;
        const business = typeof body.business_id === 'string' && uuid.test(body.business_id) ? body.business_id : null;
        if ((!application) === (!business) || (body.bootstrap_owner !== undefined && typeof body.bootstrap_owner !== 'boolean')) {
          return reply(400, { code: 'INVALID_REQUEST', error: 'Choose one business or approved application.' });
        }
        const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '')?.[1];
        if (!token || token.length > 16384) return reply(401, { code: 'ACTIVE_OWNER_SESSION_REQUIRED', error: errors.ACTIVE_OWNER_SESSION_REQUIRED[1] });
        const verifiedUser = await deps.getUser(token), verifiedClaims = await deps.getClaims(token);
        const user = verifiedUser.data?.user, claims = verifiedClaims.data?.claims;
        if (verifiedUser.error || verifiedClaims.error || !user || claims?.sub !== user.id
          || typeof claims.session_id !== 'string' || !uuid.test(claims.session_id)) {
          return reply(401, { code: 'ACTIVE_OWNER_SESSION_REQUIRED', error: errors.ACTIVE_OWNER_SESSION_REQUIRED[1] });
        }
        prepared = await deps.rpc('triniti_business_owner_access', {
          p_user_id: user.id, p_session_id: claims.session_id, p_application_id: application, p_business_id: business,
          p_device: body.device_id.toLowerCase(), p_proof_hash: proof, p_label: body.device_label,
          p_bootstrap_owner: body.bootstrap_owner === true,
        });
      }
      if (prepared.error || !object(prepared.data)) throw new Error('Preparation failed');
      const grant = prepared.data;
      if (grant.allowed !== true) {
        const code = typeof grant.error === 'string' && errors[grant.error] ? grant.error : 'ACCESS_REJECTED';
        return reply(errors[code][0], { code, error: errors[code][1], ...(code === 'OWNER_BOOTSTRAP_REQUIRED' ? { requires_owner_bootstrap: true } : {}) });
      }
      if (typeof grant.grant_id !== 'string' || !uuid.test(grant.grant_id)
        || typeof grant.business_id !== 'string' || !uuid.test(grant.business_id)
        || typeof grant.member_id !== 'string' || !uuid.test(grant.member_id)) throw new Error('Invalid grant');
      grantId = grant.grant_id; businessId = grant.business_id;
      if (request.signal.aborted) throw new Error('Cancelled');
      const identity = await deps.getUserById(businessId);
      if (identity.error || identity.data.user?.id !== businessId || !identity.data.user.email) throw new Error('Identity unavailable');
      const link = await deps.generateLink(identity.data.user.email);
      if (link.error || !link.data.properties?.hashed_token) throw new Error('Link unavailable');
      // Exchange on the server with a separate Auth client. Never send an
      // unbound magic-link capability or a service credential to a client.
      const exchange = await deps.exchange(link.data.properties.hashed_token);
      if (exchange.error || !exchange.data.session || exchange.data.session.user.id !== businessId) throw new Error('Exchange rejected');
      issued = exchange.data.session;
      if (typeof issued.access_token !== 'string' || typeof issued.refresh_token !== 'string' || !issued.refresh_token) throw new Error('Session unavailable');
      const claimsResult = await deps.getClaims(issued.access_token), claims = claimsResult.data?.claims;
      if (claimsResult.error || claims?.sub !== businessId || typeof claims.session_id !== 'string' || !uuid.test(claims.session_id)) throw new Error('Session proof rejected');
      sessionId = claims.session_id;
      if (request.signal.aborted) throw new Error('Cancelled');
      const bound = await deps.rpc('triniti_business_finish_signin', {
        p_grant_id: grantId, p_business_id: businessId, p_session_id: sessionId, p_proof_hash: proof,
      });
      if (bound.error || !object(bound.data) || bound.data.success !== true || bound.data.business_id !== businessId
        || bound.data.member_id !== grant.member_id || bound.data.session_id !== sessionId
        || !['owner', 'admin', 'editor', 'recruiter', 'support'].includes(String(bound.data.role))) throw new Error('Binding rejected');
      if (request.signal.aborted) throw new Error('Cancelled');
      committed = true;
      return reply(200, {
        business_id: businessId, member_id: bound.data.member_id, role: bound.data.role,
        session: { access_token: issued.access_token, refresh_token: issued.refresh_token },
      });
    } catch {
      return reply(503, { code: 'BUSINESS_SESSION_UNAVAILABLE', error: 'Business sign-in could not be completed. No new session was installed. Try again.' });
    } finally {
      if (!committed && issued) {
        // A failed or cancelled exchange must not leave a usable shared
        // business session. Neither cleanup path logs or returns its tokens.
        if (grantId && businessId && sessionId) {
          try { await deps.rpc('triniti_business_cancel_signin', { p_grant_id: grantId, p_business_id: businessId, p_session_id: sessionId }); } catch { /* Auth revocation below is an independent fallback. */ }
        }
        try { await deps.revoke(issued.access_token); } catch { /* Unbound sessions also fail the database/Storage guard. */ }
      }
    }
  };
}
