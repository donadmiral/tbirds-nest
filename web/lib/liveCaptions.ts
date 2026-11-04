import {liveRpc,record,type LiveClient} from './liveApi';
import {isLiveUuid} from '../../shared/liveDirectory';
import type {ClipSubtitle} from '../../shared/liveClips';

export const captionLanguages=[['en-US','English (US)'],['en-GB','English (UK)'],['es-US','Spanish'],['fr-FR','French'],['de-DE','German'],['pt-BR','Portuguese (Brazil)'],['it-IT','Italian'],['hi-IN','Hindi'],['ja-JP','Japanese'],['ko-KR','Korean'],['zh-CN','Chinese (Mandarin)'],['ar-SA','Arabic']] as const;
export type CaptionDraft={id:string;state:string;language:string;created_at:string;revision:number;cues:ClipSubtitle[];error:string|null};
export function captionValidation(cues:ClipSubtitle[],duration:number):string|null{
 if(!cues.length||cues.length>500)return 'Use between 1 and 500 captions.';
 let end=0;
 for(const cue of cues){if(!Number.isSafeInteger(cue.start_ms)||!Number.isSafeInteger(cue.end_ms)||cue.start_ms<end||cue.end_ms<=cue.start_ms||cue.end_ms>duration||!cue.text.trim()||cue.text.length>500||/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(cue.text))return 'Check caption text and times. Captions must stay within the clip and must not overlap.';end=cue.end_ms;}
 return null;
}
export function parseCaptionJobs(input:unknown,duration:number):CaptionDraft[]{
 return (Array.isArray(input)?input.slice(0,10):[]).flatMap(row=>{
  if(!record(row)||!isLiveUuid(row.id)||typeof row.state!=='string')return [];
  const draft=record(row.draft)?row.draft:{},raw=Array.isArray(draft.cues)?draft.cues:[];
  const cues=raw.length<=500?raw.flatMap(cue=>record(cue)&&typeof cue.text==='string'&&typeof cue.start_ms==='number'&&typeof cue.end_ms==='number'?[{start_ms:cue.start_ms,end_ms:cue.end_ms,text:cue.text}]:[]):[];
  return [{id:row.id,state:row.state.slice(0,40),language:String(row.language||'').slice(0,20),created_at:String(row.created_at||'').slice(0,50),revision:Number(row.revision)||0,cues:cues.length===raw.length&&!captionValidation(cues,duration)?cues:[],error:typeof row.error_code==='string'?row.error_code.slice(0,80):null}];
 });
}
export const captionCommand=(client:LiveClient,clipId:string,action:string,payload:Record<string,unknown>={},requestId:string|null=null)=>liveRpc(client,'live_transcription_command',{p_clip_id:clipId,p_action:action,p_payload:payload,p_request_id:requestId});
export async function captionStatus(client:LiveClient,clipId:string,duration:number){const data=await captionCommand(client,clipId,'status');if(typeof data.enabled!=='boolean'||!Array.isArray(data.items))throw Error('INVALID_SERVICE_RESPONSE');return{enabled:data.enabled,items:parseCaptionJobs(data.items,duration)};}
export function captionError(error:unknown):string{
 const code=error instanceof Error?error.message:record(error)?String(error.message||''):'';
 if(/INTEGRATION_DISABLED/.test(code))return 'Automatic captions are not active yet. You can still add or import subtitles in the clip editor.';
 if(/CLIP_CHANGED|REVIEW_REQUIRED|PUBLICATION_ALREADY_PUBLISHED/.test(code))return 'The clip changed or has already been published. Refresh it before requesting or applying captions.';
 if(/ACCOUNT_LIMIT|RATE_LIMIT/.test(code))return 'Wait for your current caption requests to finish before starting another.';
 if(/ACCESS_DENIED|AUTH_REQUIRED/.test(code))return 'Your access to this clip has changed. Sign in again or return to your library.';
 return 'This caption request could not complete. Refresh its status before trying again.';
}
