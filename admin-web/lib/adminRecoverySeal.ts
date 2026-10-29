import { createHmac, timingSafeEqual } from 'node:crypto';

export type RecoveryGrant = { accessToken: string; refreshToken: string; userId: string; sessionId: string; expiresAt: number };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const valid = (value: RecoveryGrant) => value && typeof value.accessToken === 'string' && value.accessToken.length > 0
  && typeof value.refreshToken === 'string' && value.refreshToken.length > 0
  && typeof value.userId === 'string' && uuid.test(value.userId)
  && typeof value.sessionId === 'string' && uuid.test(value.sessionId) && Number.isSafeInteger(value.expiresAt);
const signature = (payload: string, secret: string) => createHmac('sha256', secret).update('platinum-admin-recovery-v1\0' + payload).digest();

export function sealRecovery(grant: RecoveryGrant, secret: string): string {
  if (secret.length < 32 || !valid(grant)) throw new Error('Invalid recovery state');
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
  const encoded = payload + '.' + signature(payload, secret).toString('base64url');
  if (encoded.length > 3840) throw new Error('Recovery state is too large');
  return encoded;
}

export function openRecovery(encoded: string | undefined | null, secret: string, nowSeconds: number): RecoveryGrant | null {
  try {
    if (!encoded || encoded.length > 3840 || secret.length < 32) return null;
    const [payload, supplied, extra] = encoded.split('.');
    if (!payload || !supplied || extra !== undefined || !/^[\w-]+$/.test(payload) || !/^[\w-]+$/.test(supplied)) return null;
    const actual = Buffer.from(supplied, 'base64url');
    const expected = signature(payload, secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as RecoveryGrant;
    if (!valid(grant) || grant.expiresAt <= nowSeconds || grant.expiresAt > nowSeconds + 600) return null;
    return grant;
  } catch { return null; }
}

/** A browser replay cannot extend the lifetime of an emailed PKCE challenge. */
export function sealRecoveryVerifier(value: string, secret: string, expiresAt: number): string {
  if (secret.length < 32 || !Number.isSafeInteger(expiresAt) || value.length > 2048) throw new Error('Invalid recovery verifier');
  const payload = Buffer.from(JSON.stringify({ value, expiresAt })).toString('base64url');
  const mac = createHmac('sha256', secret).update('platinum-admin-pkce-v1\0' + payload).digest('base64url');
  return payload + '.' + mac;
}
export function openRecoveryVerifier(encoded: string | undefined, secret: string, nowSeconds: number): string | null {
  try {
    if (!encoded || encoded.length > 3072 || secret.length < 32) return null;
    const [payload, mac, extra] = encoded.split('.');
    if (!payload || !mac || extra !== undefined) return null;
    const actual = Buffer.from(mac, 'base64url');
    const expected = createHmac('sha256', secret).update('platinum-admin-pkce-v1\0' + payload).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.value === 'string' && data.value.length <= 2048 && Number.isSafeInteger(data.expiresAt)
      && data.expiresAt > nowSeconds && data.expiresAt <= nowSeconds + 600 ? data.value : null;
  } catch { return null; }
}
