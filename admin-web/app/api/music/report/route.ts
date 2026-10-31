import { requirePermission } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { musicReportWindow, musicUsageCsv, type MusicUsageRow } from '@/lib/musicReport';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const admin=await requirePermission('post_moderate');
 const url=new URL(request.url),window=musicReportWindow(url.searchParams.get('start'),url.searchParams.get('end'));
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 if(!window)return Response.json({error:'Choose a UTC date range of 1 to 31 days. The end date is exclusive.'},{status:400,headers});
 const {data,error}=await serviceClient().rpc('admin_music_usage_report',{p_actor:admin.id,p_session:admin.sessionId,p_start:window.start,p_end:window.end});
 if(error||!data||data.metric!=='server_operations_not_plays_or_royalties'||!Array.isArray(data.rows))return Response.json({error:'The audio report is unavailable. Try a shorter date range or retry from Music and audio.'},{status:503,headers});
 return new Response(musicUsageCsv(data.rows as MusicUsageRow[]),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="music-server-operations-${window.start.slice(0,10)}-${window.end.slice(0,10)}.csv"`}});
}
