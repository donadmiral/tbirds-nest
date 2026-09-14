import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function proxy(request: NextRequest) {
  const refresh=request.cookies.get('pc_admin_refresh')?.value;
  const token=request.cookies.get('pc_admin_token')?.value;
  if(!refresh)return NextResponse.next();
  let exp=0;
  try {exp=JSON.parse(Buffer.from((token||'').split('.')[1]||'','base64url').toString('utf8')).exp || 0;} catch {}
  // This unverified expiry only decides when to refresh. adminAuth verifies access on every request.
  if(exp*1000>Date.now()+60000)return NextResponse.next();
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key)return NextResponse.next();
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const {data,error}=await client.auth.refreshSession({refresh_token:refresh});
  if(error||!data.session){
    // A transient refresh failure must not erase a still-valid session or a newer parallel response.
    return NextResponse.next();
  }
  request.cookies.set('pc_admin_token',data.session.access_token);
  request.cookies.set('pc_admin_refresh',data.session.refresh_token);
  const headers=new Headers(request.headers);headers.set('cookie',request.cookies.toString());
  const response=NextResponse.next({request:{headers}});
  const options={httpOnly:true,sameSite:'lax' as const,secure:process.env.NODE_ENV==='production',path:'/'};
  response.cookies.set('pc_admin_token',data.session.access_token,{...options,maxAge:Math.max(1,Math.floor((data.session.expires_at||0)-Date.now()/1000))});
  response.cookies.set('pc_admin_refresh',data.session.refresh_token,{...options,maxAge:8*60*60});
  response.headers.set('Cache-Control','private, no-store');
  return response;
}
export const config={matcher:['/((?!_next/static|_next/image|brand/|favicon.ico|p/).*)']};
