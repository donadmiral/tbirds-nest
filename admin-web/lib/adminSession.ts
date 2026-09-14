import 'server-only';
import { cookies } from 'next/headers';
import type { Session } from '@supabase/supabase-js';
import { anonClient } from './supabaseAdmin';
import { adminFromToken } from './adminAuth';
export async function saveAdminSession(session: Session) {
  const jar = await cookies();
  const options = {httpOnly:true,sameSite:'lax' as const,secure:process.env.NODE_ENV==='production',path:'/'};
  const remaining = Math.floor((session.expires_at || 0) - Date.now()/1000);
  if (remaining <= 0) throw new Error('Your session expired. Sign in again.');
  jar.set('pc_admin_token',session.access_token,{...options,maxAge:remaining});
  jar.set('pc_admin_refresh',session.refresh_token,{...options,maxAge:8*60*60});
}
export async function adminSessionClient() {
  const jar=await cookies();const access_token=jar.get('pc_admin_token')?.value;const refresh_token=jar.get('pc_admin_refresh')?.value;
  if (!access_token || !refresh_token || !await adminFromToken(access_token)) throw new Error('Sign in again to continue.');
  const client=anonClient();const result=await client.auth.setSession({access_token,refresh_token});
  if(result.error || !result.data.session)throw new Error('Sign in again to continue.');
  return client;
}
