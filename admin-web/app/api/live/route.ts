import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { getAdmin } from '@/lib/adminAuth';
import { canAccessOperations } from '@/lib/adminAssurance';
import { canOpen, canPerform } from '@/lib/permissions';
import { liveId, parseLiveCursor, parseStaffLiveCommand, readLiveBody } from '@/lib/liveOperations';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control':'private, no-store', 'Content-Type':'application/json', 'X-Content-Type-Options':'nosniff' };
const json = (status:number,value:unknown) => new Response(JSON.stringify(value),{status,headers});
async function caller() {
  const admin = await getAdmin();
  if (!admin || !await canAccessOperations(admin) || !canOpen(admin.role,'/live')) return null;
  const token = (await cookies()).get('pc_admin_token')?.value;
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token||!url||!key) return null;
  // Pass the verified staff token. The database independently checks its live
  // Auth session, current staff role and every requested action.
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`},fetch:(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.timeout(12000)})}});
  return {admin,client};
}
export async function GET(request:Request){
  try {
    const context=await caller();if(!context)return json(401,{error:'Sign in with an authorized staff account.'});
    const params=new URL(request.url).searchParams,id=params.get('session'),cursor=parseLiveCursor(params.get('cursor'));
    if(cursor===false||id!==null&&!liveId(id))return json(400,{error:'Invalid stream or page.'});
    if(id){
      const auditCursor=parseLiveCursor(params.get('auditCursor')),reportCursor=parseLiveCursor(params.get('reportCursor'));
      if(auditCursor===false||reportCursor===false)return json(400,{error:'Invalid review page.'});
      const [detail,messages,analytics]=await Promise.all([context.client.rpc('live_admin_session',{p_session_id:id,p_audit_cursor:auditCursor,p_report_cursor:reportCursor}),context.client.rpc('live_messages',{p_session_id:id,p_before:cursor,p_limit:50}),context.client.rpc('live_analytics',{p_session_id:id})]);
      if(detail.error||messages.error||analytics.error)return json(503,{error:'Stream review could not load. Retry shortly.'});
      return json(200,{...detail.data,messages:messages.data,analytics:analytics.data});
    }
    const state=params.get('state');if(state&&!['draft','scheduled','backstage','starting','live','reconnecting','ending','ended','cancelled'].includes(state))return json(400,{error:'Invalid stream state.'});
    const {data,error}=await context.client.rpc('live_admin_directory',{p_state:state||null,p_cursor:cursor,p_limit:24});
    if(error)return json(503,{error:'Live operations are unavailable. Retry shortly.'});
    return json(200,{...data,canModerate:canPerform(context.admin.role,'post_moderate')});
  } catch { return json(503,{error:'Live operations are unavailable. Retry shortly.'}); }
}
export async function POST(request:Request){
  if(request.headers.get('origin')!==new URL(request.url).origin || !request.headers.get('content-type')?.startsWith('application/json'))return json(403,{error:'Use the operations desk to make this change.'});
  try {
    const context=await caller();if(!context)return json(401,{error:'Sign in with an authorized staff account.'});
    if(!canPerform(context.admin.role,'post_moderate'))return json(403,{error:'Your staff role cannot moderate live streams.'});
    let parsed:unknown;try{parsed=await readLiveBody(request);}catch(error){return json(error instanceof Error&&error.message==='BODY_TOO_LARGE'?413:400,{error:'Invalid or oversized command.'});}
    const command=parseStaffLiveCommand(parsed);if(!command)return json(400,{error:'Provide a valid action, stream and reason.'});
    const result=command.action==='stop'
      ?await context.client.functions.invoke('live-control',{body:{sessionId:command.sessionId,action:'stop',requestId:command.requestId,reason:command.payload.reason}})
      :await context.client.rpc('live_command',{p_action:command.action,p_session_id:command.sessionId,p_payload:command.payload,p_request_id:command.requestId});
    if(result.error||result.data?.ok!==true)return json(409,{error:'The action was not confirmed. Refresh, then retry the same request.'});
    return json(200,{ok:true,state:result.data.state??null});
  } catch { return json(503,{error:'The change was not confirmed. Retry the same request.'}); }
}
