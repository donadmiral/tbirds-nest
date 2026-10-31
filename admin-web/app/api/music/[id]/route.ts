import { requirePermission } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { validMediaRange } from '@/lib/moderationMediaResponse';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
 const admin=await requirePermission('post_moderate'),{id}=await params;
 const headers={'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 const unavailable=(status=404)=>new Response('Audio unavailable',{status,headers});
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))return unavailable();
 const range=request.headers.get('Range');
 if(range&&!validMediaRange(range))return new Response(null,{status:416,headers});
 const get=()=>serviceClient().rpc('admin_original_audio_object',{p_actor:admin.id,p_session:admin.sessionId,p_sound_id:id});
 let upstream:Response|undefined;
 try {
 const {data:object,error}=await get();
 if(error||!object||object.bucket!=='music-audio'||!/^[-a-f0-9]{36}\/[a-f0-9-]{36}\.(wav|mp3|m4a)$/.test(object.path)||!['audio/wav','audio/mpeg','audio/mp4'].includes(object.mime))return unavailable();
 const base=process.env.NEXT_PUBLIC_SUPABASE_URL!,key=process.env.SUPABASE_SERVICE_ROLE_KEY!;
 const controller=new AbortController();
 const headerDeadline=setTimeout(()=>controller.abort(),20_000);
 try {
  upstream=await fetch(`${base}/storage/v1/object/authenticated/music-audio/${object.path}`,{cache:'no-store',redirect:'error',signal:AbortSignal.any([request.signal,controller.signal]),headers:{Authorization:`Bearer ${key}`,apikey:key,...(range?{Range:range}:{})}});
 } finally { clearTimeout(headerDeadline); }
 if(![200,206].includes(upstream.status)){
  await upstream.body?.cancel();
  return unavailable(upstream.status===416?416:upstream.status===404?404:503);
 }
 const {data:latest,error:latestError}=await get();
 if(latestError||!latest||latest.version!==object.version){await upstream.body?.cancel();return unavailable();}
 const result=new Headers({...headers,'Content-Type':object.mime,'Accept-Ranges':'bytes','Content-Disposition':'inline'});
 for(const name of ['Content-Length','Content-Range']){const value=upstream.headers.get(name);if(value)result.set(name,value);}
 return new Response(upstream.body,{status:upstream.status,headers:result});
 } catch {
  try { await upstream?.body?.cancel(); } catch { /* An aborted stream may already be closed. */ }
  return unavailable(503);
 }
}
