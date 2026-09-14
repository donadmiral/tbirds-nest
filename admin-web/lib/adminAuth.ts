import 'server-only';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { serviceClient } from './supabaseAdmin';
import { STAFF_ROLES, canOpen, canPerform, type Permission } from './permissions';
export { allowedDesks, VERIFICATION_ROLES, ADS_ROLES } from './permissions';
export type Admin = { id: string; email: string; role: string; aal: string; sessionId: string };

/** Resolve both the verified token and its still-active native Auth session. */
export async function adminFromToken(token: string): Promise<Admin | null> {
  const svc = serviceClient();
  const { data: userData, error } = await svc.auth.getUser(token);
  if (error || !userData.user) return null;
  let sessionId: string;
  let aal: string;
  try {
    // The payload is used only after Auth has verified this exact token.
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (claims.sub !== userData.user.id || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) return null;
    sessionId = claims.session_id;
    aal = claims.aal;
    if (typeof sessionId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)) return null;
  } catch { return null; }
  const { data: active, error: sessionError } = await svc.rpc('triniti_admin_session_check', {
    p_user_id: userData.user.id, p_session_id: sessionId,
  });
  if (sessionError || active !== true) return null;
  const { data: row, error: roleError } = await svc.from('admin_users')
    .select('role, active').eq('user_id', userData.user.id).maybeSingle();
  if (roleError || row?.active !== true || !STAFF_ROLES.has(row.role)) return null;
  return { id: userData.user.id, email: userData.user.email || '', role: row.role, aal, sessionId };
}
export async function getAdmin(): Promise<Admin | null> {
  const token = (await cookies()).get('pc_admin_token')?.value;
  return token ? adminFromToken(token) : null;
}
export async function requireDesk(desk: string): Promise<Admin> {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  if (admin.aal !== 'aal2') redirect('/security');
  if (!canOpen(admin.role, desk)) notFound();
  return admin;
}
export async function requirePermission(permission: Permission): Promise<Admin> {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  if (admin.aal !== 'aal2') redirect('/security');
  if (!canPerform(admin.role, permission)) throw new Error('This action is not available for your staff role.');
  return admin;
}
