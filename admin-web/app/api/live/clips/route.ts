import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { getAdmin } from '@/lib/adminAuth';
import { canAccessOperations } from '@/lib/adminAssurance';
import { canOpen, canPerform } from '@/lib/permissions';
import { liveId, parseLiveCursor, readLiveBody } from '@/lib/liveOperations';
import { clipReviewResponse, parseStaffClipCommand } from '@/lib/liveClipOperations';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff'};
const json=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers});
async function caller(){
  const admin=await getAdmin();if(!admin||!await canAccessOperations(admin)||!canOpen(admin.role,'/live'))return null;
  const token=(await cookies()).get('pc_admin_token')?.value,url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!token||!url||!key)return null;
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`},fetch:(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.timeout(12000)})}});
  return{admin,client};
}
export async function GET(request:Request){
  try{
    const context=await caller();if(!context)return json(401,{error:'Sign in with an authorized staff account.'});
    const params=new URL(request.url).searchParams,clip=params.get('clip'),session=params.get('session'),cursor=parseLiveCursor(params.get('cursor')),state=params.get('state');
    if(clip!==null&&!liveId(clip)||session!==null&&!liveId(session)||cursor===false||state&&!['queued','rendering','processing','review','ready','published','failed','rejected','blocked','deleted'].includes(state))return json(400,{error:'Invalid clip review page.'});
    const format=params.get('format');
    if(format){
      if(!clip||!['vertical','horizontal'].includes(format))return json(400,{error:'Invalid clip preview format.'});
      const result=await context.client.functions.invoke('live-clip-media',{body:{clipId:clip,format}});
      if(result.error)return json(503,{error:'Clip preview is not available.'});
      const url=new URL(String(result.data?.url)),expires=Date.parse(String(result.data?.expires_at));
      if(url.protocol!=='https:'||url.username||url.password||!Number.isFinite(expires)||expires<=Date.now()+1000||expires>Date.now()+15*60*1000)return json(503,{error:'Clip preview access could not be verified.'});
      return json(200,{url:url.href,expires_at:new Date(expires).toISOString()});
    }
    const result=clip?await context.client.rpc('live_admin_clip',{p_clip_id:clip,p_cursor:cursor}):await context.client.rpc('live_admin_clips',{p_session_id:session,p_state:state||null,p_cursor:cursor,p_limit:24});
    if(result.error)return json(503,{error:'Clip review could not load. Retry shortly.'});
    return json(200,clipReviewResponse(result.data));
  }catch{return json(503,{error:'Clip operations are unavailable. Retry shortly.'});}
}
export async function POST(request:Request){
  if(request.headers.get('origin')!==new URL(request.url).origin||!request.headers.get('content-type')?.startsWith('application/json'))return json(403,{error:'Use the operations desk to review clips.'});
  try{
    const context=await caller();if(!context)return json(401,{error:'Sign in with an authorized staff account.'});
    if(!canPerform(context.admin.role,'post_moderate'))return json(403,{error:'Your staff role cannot change live clips.'});
    let body:unknown;try{body=await readLiveBody(request);}catch(error){return json(error instanceof Error&&error.message==='BODY_TOO_LARGE'?413:400,{error:'Invalid or oversized clip command.'});}
    const command=parseStaffClipCommand(body);if(!command)return json(400,{error:'Provide a valid clip action and review reason.'});
    const result=await context.client.rpc('live_clip_command',{p_session_id:command.sessionId,p_clip_id:command.clipId,p_action:command.action,p_payload:command.payload,p_request_id:command.requestId});
    if(result.error||result.data?.ok!==true)return json(409,{error:'The clip action was not confirmed. Refresh and retry the same request.'});
    return json(200,{ok:true,state:result.data.state??null});
  }catch{return json(503,{error:'The clip change was not confirmed. Retry the same request.'});}
}
