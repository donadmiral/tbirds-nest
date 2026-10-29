import 'server-only';
import { serviceClient } from './supabaseAdmin';
import type { Admin } from './adminAuth';

/** Database policy can defer setup for one QA owner. A flag in a browser cannot. */
export async function canAccessOperations(admin: Admin): Promise<boolean> {
  if (admin.aal === 'aal2') return true;
  if (admin.aal !== 'aal1' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://uaulhuelcfkjwojtymmw.supabase.co') return false;
  try {
    const { data, error } = await serviceClient().rpc('triniti_admin_single_owner_access', {
      p_actor_id: admin.id, p_session_id: admin.sessionId,
    });
    return !error && data === true;
  } catch { return false; }
}
