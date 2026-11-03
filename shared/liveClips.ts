import { isLiveUuid, safeLiveImage } from './liveDirectory';
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export type ClipSubtitle={start_ms:number;end_ms:number;text:string};
export type ClipSpec={title:string;caption:string;tags:string[];start_ms:number;end_ms:number;cover_ms:number;formats:('vertical'|'horizontal')[];watermark:boolean;brand_text:string;burn_captions:boolean;subtitles:ClipSubtitle[]};
export type ClipSettings={viewer_clipping:boolean;review_required:boolean;watermark_required:boolean;brand_text:string;copyright_policy:'standard'|'owner_only'|'disabled';approved_user_ids:string[];can_manage:boolean};
export type ClipContext={session_id:string;can_clip:boolean;available_start_ms:number;available_end_ms:number;max_duration_ms:number;viewer_clipping:boolean;recording_available:boolean;can_manage?:boolean;settings?:ClipSettings};
export type LiveClip={id:string;session_id:string;title:string;caption:string;state:string;start_ms:number;end_ms:number;created_at:string;formats:string[];tags:string[];share_count:number|null;view_count:number|null;thumbnail_url:string|null;error:string|null};
export function validateClipSpec(value:ClipSpec,context:ClipContext):string|null {
  if(!value.title.trim()||value.title.trim().length>120)return 'Add a title of up to 120 characters.';
  if(context.settings?.watermark_required&&!value.watermark)return 'The creator requires a watermark on clips from this stream.';
  if(value.brand_text.length>80)return 'Keep brand text within 80 characters.';
  if(value.caption.length>2200)return 'Keep the caption within 2,200 characters.';
  if(!Number.isSafeInteger(value.start_ms)||!Number.isSafeInteger(value.end_ms)||value.start_ms<context.available_start_ms||value.end_ms>context.available_end_ms||value.end_ms-value.start_ms<1000||value.end_ms-value.start_ms>Math.min(600000,context.max_duration_ms))return 'Select an available range between 1 second and 10 minutes.';
  if(!Number.isSafeInteger(value.cover_ms)||value.cover_ms<0||value.cover_ms>=value.end_ms-value.start_ms)return 'Choose a cover frame inside the clip.';
  if(!value.formats.length||value.formats.length>2||value.formats.some(f=>!['vertical','horizontal'].includes(f))||new Set(value.formats).size!==value.formats.length)return 'Choose at least one export format.';
  if(value.tags.length>20||value.tags.some(tag=>!tag.trim()||tag.length>50))return 'Use up to 20 tags, each under 50 characters.';
  let before=-1;
  for(const cue of value.subtitles){if(!Number.isSafeInteger(cue.start_ms)||!Number.isSafeInteger(cue.end_ms)||cue.start_ms<0||cue.start_ms<before||cue.end_ms<=cue.start_ms||cue.end_ms>value.end_ms-value.start_ms||!cue.text.trim()||cue.text.length>500)return 'Check subtitle times and text. Times are relative to the clip.';before=cue.start_ms;}
  if(value.subtitles.length>500)return 'Use up to 500 subtitle cues.';
  return null;
}
export function parseWebVtt(source:string):ClipSubtitle[]{
  if(source.length>300000)throw Error('Caption file is too large.');
  const time=(raw:string)=>{const values=raw.trim().replace(',','.').split(':').map(Number);if(values.length<2||values.length>3||values.some(v=>!Number.isFinite(v)||v<0)||values.at(-1)!>=60||values.at(-2)!>=60)throw Error('Invalid caption time.');return Math.round(values.reduce((total,n)=>total*60+n,0)*1000);};
  const blocks=source.replace(/^\uFEFF/,'').replace(/\r/g,'').split(/\n\s*\n/);const cues:ClipSubtitle[]=[];
  for(const block of blocks){const lines=block.trim().split('\n'),index=lines.findIndex(line=>line.includes('-->'));if(index<0)continue;const match=lines[index].match(/^\s*([\d:.,]+)\s+-->\s+([\d:.,]+)(?:\s.*)?$/);if(!match)throw Error('Invalid caption timing line.');cues.push({start_ms:time(match[1]),end_ms:time(match[2]),text:lines.slice(index+1).join('\n').replace(/<[^>]*>/g,'').trim()});if(cues.length>500)throw Error('Use up to 500 subtitle cues.');}
  if(!cues.length)throw Error('No subtitle cues were found.');return cues;
}
export function parseLiveClip(value:unknown):LiveClip|null {
  if(!record(value)||!isLiveUuid(value.id)||!isLiveUuid(value.session_id))return null;
  return {id:value.id,session_id:value.session_id,title:String(value.title||'').slice(0,120),caption:String(value.caption||'').slice(0,2200),state:String(value.state||'draft'),start_ms:Number(value.start_ms)||0,end_ms:Number(value.end_ms)||0,created_at:typeof value.created_at==='string'?value.created_at:'',formats:Array.isArray(value.formats)?value.formats.filter(f=>['vertical','horizontal'].includes(f)).slice(0,2):[],tags:Array.isArray(value.tags)?value.tags.filter(t=>typeof t==='string').slice(0,20):[],share_count:Number.isSafeInteger(value.share_count)&&Number(value.share_count)>=0?Number(value.share_count):null,view_count:Number.isSafeInteger(value.view_count)&&Number(value.view_count)>=0?Number(value.view_count):null,thumbnail_url:safeLiveImage(value.thumbnail_url),error:typeof value.error==='string'?value.error.slice(0,160):null};
}
