import { liveId } from './liveOperations';
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export type StaffClipCommand={action:string;sessionId:string;clipId:string;requestId:string;payload:Record<string,unknown>};
export function parseStaffClipCommand(value:unknown):StaffClipCommand|null {
  if(!object(value)||Object.keys(value).some(key=>!['action','sessionId','clipId','requestId','payload'].includes(key))||!liveId(value.sessionId)||!liveId(value.clipId)||!liveId(value.requestId)||!object(value.payload))return null;
  const action=String(value.action),payload=value.payload,allowed:Record<string,string[]>={admin_review:['reason','decision'],copyright:['reason','status'],retry:['reason'],retry_post:['reason','post_id']};
  if(!allowed[action]||Object.keys(payload).some(key=>!allowed[action].includes(key))||typeof payload.reason!=='string'||!payload.reason.trim()||payload.reason.length>1000)return null;
  if(action==='admin_review'&&!['approved','rejected'].includes(String(payload.decision)))return null;
  if(action==='copyright'&&!['cleared','blocked'].includes(String(payload.status)))return null;
  if(action==='retry_post'&&!liveId(payload.post_id))return null;
  return{action,sessionId:value.sessionId,clipId:value.clipId,requestId:value.requestId,payload:{...payload,reason:payload.reason.trim()}};
}

/** Keep operations responses limited to human review metadata. */
export function clipReviewResponse(value:unknown) {
  if(!object(value))return {};
  const pick=(row:unknown,keys:string[])=>object(row)?Object.fromEntries(keys.filter(key=>row[key]!==undefined).map(key=>[key,row[key]])):{};
  const clipKeys=['id','session_id','creator_id','title','caption','tags','state','start_ms','end_ms','cover_ms','created_at','updated_at','formats','watermark','brand_text','burn_captions','subtitles','moderation_state','copyright_state','view_count','share_count'];
  const page=(v:unknown,keys:string[],limit=25)=>{const data=object(v)?v:{};return{items:Array.isArray(data.items)?data.items.slice(0,limit).map(row=>pick(row,keys)):[],next_cursor:object(data.next_cursor)?data.next_cursor:null};};
  return {
    ...(value.items?{items:Array.isArray(value.items)?value.items.slice(0,24).map(row=>pick(row,clipKeys)):[],next_cursor:object(value.next_cursor)?value.next_cursor:null}:{}),
    ...(value.clip?{clip:pick(value.clip,clipKeys)}:{}),
    permissions:pick(value.permissions,['moderate','configure','retry']),
    ...(value.audit?{audit:page(value.audit,['id','created_at','action','reason','actor_id'])}:{}),
    ...(value.posts?{posts:page(value.posts,['id','created_at','destination','target_id','format','state','scheduled_at','published_at','attempts','next_attempt_at','external_url','error_code'])}:{}),
    ...(value.connections?{connections:page(value.connections,['id','platform','state','display_name','connected_at','expires_at','last_error_code'])}:{}),
    ...(value.analytics?{analytics:pick(value.analytics,['views','shares','clips','ready','processing','failed','published','updated_at'])}:{}),
  };
}
