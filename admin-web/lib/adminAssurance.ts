import 'server-only';
import type { Admin } from './adminAuth';
import { STAFF_ROLES } from './permissions';

/** Owner-requested temporary policy. adminFromToken still verifies the token,
 * live native session and active staff role before this function is reached.
 * Keep this in server code, never in a browser flag or a request parameter. */
export const STAFF_AUTHENTICATOR_REQUIRED = false;

export async function canAccessOperations(admin: Admin): Promise<boolean> {
  if (!STAFF_ROLES.has(admin.role) || !admin.id || !admin.sessionId) return false;
  return admin.aal === 'aal2' || (!STAFF_AUTHENTICATOR_REQUIRED && admin.aal === 'aal1');
}
