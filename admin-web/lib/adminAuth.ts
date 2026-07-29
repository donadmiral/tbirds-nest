/**
 * Who is at the desk. The httpOnly cookie holds a Supabase access token;
 * every request resolves it to a user, then to an admin_users row. No row,
 * no desk.
 */
import { cookies } from 'next/headers';
import { serviceClient } from './supabaseAdmin';

export type Admin = { id: string; email: string; role: string };

export async function getAdmin(): Promise<Admin | null> {
  const token = (await cookies()).get('pc_admin_token')?.value;
  if (!token) return null;
  const svc = serviceClient();
  const { data: userData, error } = await svc.auth.getUser(token);
  if (error || !userData?.user) return null;
  const { data: row } = await svc.from('admin_users')
    .select('role, active').eq('user_id', userData.user.id).maybeSingle();
  if (!row || !row.active) return null;
  return { id: userData.user.id, email: userData.user.email || '', role: row.role };
}

export const VERIFICATION_ROLES = new Set(['super_admin', 'platform_admin', 'verification_reviewer']);