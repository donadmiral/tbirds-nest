import { requirePermission } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
 const admin=await requirePermission('post_moderate'),{id}=await params;
 const headers={'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 const unavailable=()=>new Response('Audio unavailable',{status:404,headers});
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))return unavailable();
 const get=()=>serviceClient().rpc('admin_original_audio_object',{p_actor:admin.id,p_session:admin.sessionId,p_sound_id:id});
 const {data:object,error}=await get();
 if(error||!object||object.bucket!=='music-audio'||!/^[-a-f0-9]{36}\/[a-f0-9-]{36}\.(wav|mp3|m4a)$/.test(object.path)||!['audio/wav','audio/mpeg','audio/mp4'].includes(object.mime))return unavailable();
 const range=request.headers.get('Range');
 if(range&&!/^bytes=(?:\d{1,10}-\d{0,10}|-\d{1,10})$/.test(range))return new Response(null,{status:416,headers});
 const base=process.env.NEXT_PUBLIC_SUPABASE_URL!,key=process.env.SUPABASE_SERVICE_ROLE_KEY!;
 const response=await fetch(`${base}/storage/v1/object/authenticated/music-audio/${object.path}`,{cache:'no-store',signal:request.signal,headers:{Authorization:`Bearer ${key}`,apikey:key,...(range?{Range:range}:{})}});
 if(![200,206].includes(response.status)){await response.body?.cancel();return unavailable();}
 const {data:latest,error:latestError}=await get();
 if(latestError||!latest||latest.version!==object.version){await response.body?.cancel();return unavailable();}
 const result=new Headers({...headers,'Content-Type':object.mime,'Accept-Ranges':'bytes','Content-Disposition':'inline'});
 for(const name of ['Content-Length','Content-Range']){const value=response.headers.get(name);if(value)result.set(name,value);}
 return new Response(response.body,{status:response.status,headers:result});
}
