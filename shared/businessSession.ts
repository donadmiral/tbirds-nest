export type BusinessDevice = { device_id: string; device_key: string };
export type BusinessSessionResult = {
  business_id: string;
  member_id: string;
  role: 'owner' | 'admin' | 'editor' | 'recruiter' | 'support';
  session: { access_token: string; refresh_token: string };
};
// A legacy Auth exchange has no member binding. Do not manufacture a role or
// member ID to make it look like the newer, bound response contract.
export type BusinessSessionDestination = Pick<BusinessSessionResult, 'business_id' | 'session'>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseBusinessDevice(value: unknown): BusinessDevice | null {
  let parsed = value;
  if (typeof value === 'string') { try { parsed = JSON.parse(value); } catch { return null; } }
  if (!record(parsed) || typeof parsed.device_id !== 'string' || !uuid.test(parsed.device_id)
    || typeof parsed.device_key !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.device_key)) return null;
  return { device_id: parsed.device_id.toLowerCase(), device_key: parsed.device_key };
}

// This validates the response shape, not the authenticity of a JWT. Auth
// validates the tokens when setSession installs the already-bound session.
export function parseBusinessSessionResult(value: unknown): BusinessSessionResult | null {
  if (!record(value) || typeof value.business_id !== 'string' || !uuid.test(value.business_id)
    || typeof value.member_id !== 'string' || !uuid.test(value.member_id)
    || !['owner', 'admin', 'editor', 'recruiter', 'support'].includes(String(value.role))
    || !record(value.session)) return null;
  const { access_token, refresh_token } = value.session;
  if (typeof access_token !== 'string' || access_token.length < 20 || access_token.length > 16384
    || typeof refresh_token !== 'string' || refresh_token.length < 10 || refresh_token.length > 16384) return null;
  return {
    business_id: value.business_id.toLowerCase(), member_id: value.member_id.toLowerCase(),
    role: value.role as BusinessSessionResult['role'], session: { access_token, refresh_token },
  };
}

/** Select the old protocol only when PostgREST explicitly says its guard is absent. */
export async function businessSessionContract(client: { rpc(name: string, args: Record<string, never>): PromiseLike<{ data: unknown; error: unknown }> }): Promise<'bound' | 'legacy'> {
  const { data, error } = await client.rpc('business_session_allowed', {});
  if (error) {
    if (record(error) && error.code === 'PGRST202' && typeof error.message === 'string'
      && /\b(?:public\.)?business_session_allowed\b/.test(error.message)
      && /could not find.*function|does not exist/i.test(error.message)) return 'legacy';
    throw new Error('BUSINESS_SESSION_UNAVAILABLE');
  }
  if (typeof data !== 'boolean') throw new Error('BUSINESS_SESSION_UNAVAILABLE');
  return 'bound';
}

export function parseLegacyBusinessToken(value: unknown): string | null {
  if (!record(value) || ['session', 'business_id', 'member_id', 'role', 'error', 'code'].some(key => key in value)
    || typeof value.token_hash !== 'string' || !/^[A-Za-z0-9_-]{20,512}$/.test(value.token_hash)) return null;
  return value.token_hash;
}

export type LegacyBusinessAuthClient = {
  auth: {
    verifyOtp(input: { type: 'magiclink'; token_hash: string }): PromiseLike<{ data: unknown; error: unknown }>;
    getUser(token: string): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }>;
    signOut(input: { scope: 'local' }): PromiseLike<unknown>;
  };
  from(table: 'profiles'): { select(columns: string): { eq(column: string, value: string): { single(): PromiseLike<{ data: unknown; error: unknown }> } } };
};

/** Exchange in a separate, non-persistent Auth client; the selected account stays intact. */
export async function exchangeLegacyBusinessSession(isolated: LegacyBusinessAuthClient, response: { data: unknown; error: unknown }, options: {
  current: () => boolean; verifyCurrent: () => Promise<void>; businessId?: string; handle?: string;
}): Promise<BusinessSessionDestination> {
  const token = !response.error && parseLegacyBusinessToken(response.data);
  if (!token) throw new Error('BUSINESS_SESSION_UNAVAILABLE');
  let issued = false, accepted = false;
  try {
    await options.verifyCurrent();
    if (!options.current()) throw new Error('ACCOUNT_CHANGED');
    const result = await isolated.auth.verifyOtp({ type: 'magiclink', token_hash: token });
    const value = result.data;
    issued = record(value) && record(value.session);
    if (result.error || !record(value) || !record(value.user) || !record(value.session)
      || !record(value.session.user) || typeof value.user.id !== 'string' || !uuid.test(value.user.id)
      || value.session.user.id !== value.user.id
      || typeof value.session.access_token !== 'string' || value.session.access_token.length < 20 || value.session.access_token.length > 16384
      || typeof value.session.refresh_token !== 'string' || value.session.refresh_token.length < 10 || value.session.refresh_token.length > 16384
      || (options.businessId && value.user.id !== options.businessId) || !options.current()) throw new Error('SESSION_MISMATCH');
    const verified = await isolated.auth.getUser(value.session.access_token);
    if (verified.error || verified.data.user?.id !== value.user.id || !options.current()) throw new Error('SESSION_MISMATCH');
    const profile = await isolated.from('profiles').select('id,account_type,username,deactivated_at').eq('id', value.user.id).single();
    if (profile.error || !record(profile.data) || profile.data.id !== value.user.id || profile.data.account_type !== 'business'
      || profile.data.deactivated_at !== null || (options.handle && profile.data.username !== options.handle) || !options.current()) throw new Error('SESSION_MISMATCH');
    await options.verifyCurrent();
    if (!options.current()) throw new Error('ACCOUNT_CHANGED');
    accepted = true;
    return { business_id: value.user.id, session: { access_token: value.session.access_token, refresh_token: value.session.refresh_token } };
  } finally {
    if (issued && !accepted) { try { await isolated.auth.signOut({ scope: 'local' }); } catch { /* Only the isolated attempted session is revoked. */ } }
  }
}
