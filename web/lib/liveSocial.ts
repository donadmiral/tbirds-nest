import {liveInvoke,liveRpc,record,type LiveClient} from './liveApi';
import {socialPlatform,type SocialPlatform} from './liveConnections';
import {isLiveUuid} from '../../shared/liveDirectory';
export type SocialJob={id:string;clip_id:string;platform:SocialPlatform;state:string;phase:string;error:string|null;external_url:string|null;created_at:string;revoked_after_dispatch:boolean};
export type PublishingOptions={platform:SocialPlatform;account_name:string;can_publish:boolean;privacy_options:string[];max_duration_seconds:number;comment_disabled:boolean;duet_disabled:boolean;stitch_disabled:boolean};
export function publicSocialUrl(value:unknown,platform:SocialPlatform):string|null{
 if(typeof value!=='string')return null;try{const url=new URL(value);if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash)return null;
 const hosts:Record<SocialPlatform,string[]>={x:['x.com'],facebook:['www.facebook.com'],instagram:['www.instagram.com'],youtube:['www.youtube.com'],tiktok:['www.tiktok.com']};return hosts[platform].includes(url.hostname)?url.href:null;}catch{return null;}
}
export function parseSocialJobs(value:unknown):SocialJob[]{return(Array.isArray(value)?value.slice(0,30):[]).flatMap(row=>record(row)&&isLiveUuid(row.id)&&isLiveUuid(row.clip_id)&&socialPlatform(row.platform)?[{id:row.id,clip_id:row.clip_id,platform:row.platform,state:String(row.state||'unknown').slice(0,40),phase:String(row.phase||'').slice(0,40),error:typeof row.error_code==='string'?row.error_code.slice(0,80):null,external_url:publicSocialUrl(row.external_url,row.platform),created_at:String(row.created_at||''),revoked_after_dispatch:row.revoked_after_dispatch===true}]:[]);}
export async function publishingOptions(client:LiveClient,platform:SocialPlatform):Promise<PublishingOptions>{
 const data=await liveInvoke(client,'live-social',{action:'options',platform});if(data.platform!==platform||data.can_publish!==true||typeof data.account_name!=='string')throw Error('INTEGRATION_DISABLED');
 return{platform,account_name:data.account_name.slice(0,160),can_publish:true,privacy_options:Array.isArray(data.privacy_options)?data.privacy_options.filter((v):v is string=>typeof v==='string'&&['PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','SELF_ONLY'].includes(v)):[],max_duration_seconds:typeof data.max_duration_seconds==='number'?Math.min(600,data.max_duration_seconds):600,comment_disabled:data.comment_disabled===true,duet_disabled:data.duet_disabled===true,stitch_disabled:data.stitch_disabled===true};
}
export const socialCommand=(client:LiveClient,clipId:string|null,action:string,payload:Record<string,unknown>={},requestId:string|null=null)=>liveRpc(client,'live_social_command',{p_clip_id:clipId,p_action:action,p_payload:payload,p_request_id:requestId});
export async function socialHistory(client:LiveClient,clipId:string|null){return parseSocialJobs((await socialCommand(client,clipId,'history')).items);}
export function socialError(error:unknown){const code=error instanceof Error?error.message:record(error)?String(error.message||''):'';
 if(/TIKTOK_CLEAN_EXPORT_REQUIRED/.test(code))return 'TikTok requires a clean video export. Ask the creator to allow an export without a watermark, then create that version.';
 if(/INTEGRATION_DISABLED|INTEGRATION_NOT_CONFIGURED/.test(code))return 'Direct publishing is not active for this platform. You can still export the video from your clip library.';
 if(/RECONNECT_REQUIRED/.test(code))return 'Reconnect this platform account before publishing.';
 if(/PUBLICATION_CONFIRMATION_REQUIRED/.test(code))return 'A previous request may have reached the platform. Check its status before sending another post.';
 if(/PRIVATE_STREAM_EXPORT_RESTRICTED/.test(code))return 'This stream is private. Direct platform posting is restricted.';
 if(/UNSUPPORTED_FORMAT/.test(code))return 'Choose a supported clip format and duration for this platform.';
 if(/MEDIA_TOO_LARGE/.test(code))return 'This video exceeds the direct publishing size limit. Make a shorter clip or download it to post from your device.';
 if(/AUTH_REQUIRED|ACCESS_DENIED|CLIP_CHANGED/.test(code))return 'Your session or access to this clip has changed. Sign in or refresh the clip.';
 if(/ACCOUNT_LIMIT|RATE_LIMIT/.test(code))return 'Your publishing queue is at its limit. Wait for current requests to complete.';
 return 'This request could not complete. Refresh its status before trying again.';
}
