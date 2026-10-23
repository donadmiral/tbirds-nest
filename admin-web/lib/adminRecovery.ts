import 'server-only';
import { cookies } from 'next/headers';
import { createClient, type Session } from '@supabase/supabase-js';
import { adminFromToken } from './adminAuth';
import { anonClient, serviceClient } from './supabaseAdmin';
import { openRecovery, sealRecovery, openRecoveryVerifier, sealRecoveryVerifier, type RecoveryGrant } from './adminRecoverySeal';

const recoveryCookie = 'pc_admin_recovery';
const storageKey = 'pc-admin-recovery';
const now = () => Math.floor(Date.now() / 1000);
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/reset-password' });
function secret() {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value || value.length < 32) throw new Error('Recovery is unavailable');
  return value;
}

/** PKCE verifier cookies only; SDK sessions stay in this request's memory. */
export async function recoveryPkceClient() {
  const jar = await cookies();
  const memory = new Map<string, string>();
  const verifier = (key: string) => key.startsWith(storageKey + '-') && key.endsWith('-code-verifier') && /^[a-zA-Z0-9_-]+$/.test(key);
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: {
      storageKey, flowType: 'pkce', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      storage: {
        getItem(key) { return verifier(key) ? openRecoveryVerifier(jar.get(key)?.value, secret(), now()) : memory.get(key) || null; },
        setItem(key, value) {
          if (verifier(key)) jar.set(key, sealRecoveryVerifier(value, secret(), now() + 600), { ...cookieOptions(), maxAge: 600 });
          else memory.set(key, value);
        },
        removeItem(key) {
          if (verifier(key)) jar.set(key, '', { ...cookieOptions(), maxAge: 0 });
          else memory.delete(key);
        },
      },
    },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
}

async function storeGrant(grant: RecoveryGrant) {
  (await cookies()).set(recoveryCookie, sealRecovery(grant, secret()), { ...cookieOptions(), maxAge: Math.max(0, grant.expiresAt - now()) });
}
export async function clearRecovery() {
  (await cookies()).set(recoveryCookie, '', { ...cookieOptions(), maxAge: 0 });
}

export async function beginRecovery(session: Session) {
  const admin = await adminFromToken(session.access_token);
  if (!admin) return false;
  // Claims are inspected only after the exact token and native session were verified.
  const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString('utf8'));
  const recovered = Array.isArray(claims.amr) && claims.amr.some((entry: { method?: string; timestamp?: number }) =>
    entry.method === 'recovery' && typeof entry.timestamp === 'number' && entry.timestamp <= now() + 60 && entry.timestamp >= now() - 600);
  if (!recovered) return false;
  await storeGrant({ accessToken: session.access_token, refreshToken: session.refresh_token,
    userId: admin.id, sessionId: admin.sessionId, expiresAt: Math.min(now() + 600, claims.exp) });
  return true;
}

async function checkedGrant() {
  const grant = openRecovery((await cookies()).get(recoveryCookie)?.value, secret(), now());
  if (!grant) return null;
  const admin = await adminFromToken(grant.accessToken);
  if (!admin || admin.id !== grant.userId || admin.sessionId !== grant.sessionId) return null;
  return { grant, admin };
}

export async function recoveryView() {
  try {
    const context = await checkedGrant();
    if (!context) return null;
    const { data, error } = await serviceClient().auth.getUser(context.grant.accessToken);
    if (error || data.user?.id !== context.grant.userId) return null;
    const factors = (data.user.factors || []).filter(f => f.status === 'verified' && f.factor_type === 'totp')
      .map(f => ({ id: f.id, name: f.friendly_name || 'Authenticator' }));
    const needsMfa = context.admin.aal !== 'aal2' && (data.user.factors || []).some(f => f.status === 'verified');
    return { needsMfa, unsupportedMfa: needsMfa && factors.length === 0, factors };
  } catch { return null; }
}

/** The token pair is signed together by this server after a provider PKCE exchange. */
export async function recoverySessionClient() {
  const context = await checkedGrant();
  if (!context) throw new Error('RECOVERY_EXPIRED');
  const client = anonClient();
  const { data, error } = await client.auth.setSession({ access_token: context.grant.accessToken, refresh_token: context.grant.refreshToken });
  if (error || !data.session) throw new Error('RECOVERY_EXPIRED');
  const admin = await adminFromToken(data.session.access_token);
  if (!admin || admin.id !== context.grant.userId || admin.sessionId !== context.grant.sessionId) throw new Error('RECOVERY_EXPIRED');
  return { client, admin, grant: context.grant };
}

export async function saveElevatedRecovery(session: Session, previous: RecoveryGrant) {
  const admin = await adminFromToken(session.access_token);
  if (!admin || admin.aal !== 'aal2' || admin.id !== previous.userId || admin.sessionId !== previous.sessionId) throw new Error('RECOVERY_EXPIRED');
  await storeGrant({ ...previous, accessToken: session.access_token, refreshToken: session.refresh_token });
}
