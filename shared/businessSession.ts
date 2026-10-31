export type BusinessDevice = { device_id: string; device_key: string };
export type BusinessSessionResult = {
  business_id: string;
  member_id: string;
  role: 'owner' | 'admin' | 'editor' | 'recruiter' | 'support';
  session: { access_token: string; refresh_token: string };
};

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
