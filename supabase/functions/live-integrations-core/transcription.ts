import {fail,record} from './security.ts';
export type CaptionCue={start_ms:number;end_ms:number;text:string};
export type CaptionDraft={text:string;cues:CaptionCue[];language:string|null;provider:'aws_transcribe';timing:'provider_words';requires_review:true};
/** Only provider word timestamps establish cue timing. Text is inert plain text. */
export function parseTranscribeResult(value:unknown,durationMs:number,expectedJobName:string):CaptionDraft{
 if(!Number.isInteger(durationMs)||durationMs<1000||durationMs>600000||!/^pc-live-caption-[a-f0-9]{32}$/.test(expectedJobName))fail('INVALID_REQUEST');
 if(!record(value)||value.jobName!==expectedJobName||value.status!=='COMPLETED'||!record(value.results)||!Array.isArray(value.results.items)||value.results.items.length>10000)fail('PROVIDER_RESPONSE_INVALID');
 const results=value.results,cues:CaptionCue[]=[];let current:CaptionCue|null=null,previousEnd=0,words=0;
 const clean=(input:unknown)=>{
  if(typeof input!=='string'||input.length<1||input.length>300||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input))fail('PROVIDER_RESPONSE_INVALID');
  return input.replace(/[<>]/g,'').replace(/\s+/g,' ').trim();
 };
 const flush=()=>{if(current){cues.push(current);current=null;if(cues.length>500)fail('PROVIDER_RESPONSE_INVALID');}};
 for(const raw of results.items as unknown[]){
  if(!record(raw)||!Array.isArray(raw.alternatives)||!record(raw.alternatives[0]))fail('PROVIDER_RESPONSE_INVALID');
  const content=clean(raw.alternatives[0].content);if(!content)continue;
  if(raw.type==='punctuation'){
   if(!/^[.,!?;:…'"“”‘’()\-—]+$/.test(content))fail('PROVIDER_RESPONSE_INVALID');
   if(current){current.text+=content;if(/[.!?…]$/.test(content))flush();}else if(cues.length)cues[cues.length-1].text+=content;
   continue;
  }
  if(raw.type!=='pronunciation'||typeof raw.start_time!=='string'||typeof raw.end_time!=='string'||!/^\d{1,4}(\.\d{1,6})?$/.test(raw.start_time)||!/^\d{1,4}(\.\d{1,6})?$/.test(raw.end_time))fail('PROVIDER_RESPONSE_INVALID');
  const start=Math.round(Number(raw.start_time)*1000),end=Math.round(Number(raw.end_time)*1000);
  if(start<previousEnd||end<=start||end>durationMs||end-start>15000)fail('PROVIDER_RESPONSE_INVALID');
  previousEnd=end;words++;
  if(current&&(start-current.end_ms>1200||end-current.start_ms>6000||current.text.length+1+content.length>100))flush();
  if(current){current.text+=' '+content;current.end_ms=end;}else current={start_ms:start,end_ms:end,text:content};
 }
 flush();if(!words||!cues.length)fail('TRANSCRIPTION_FAILED');
 const text=cues.map(c=>c.text).join(' ');if(text.length>100000)fail('PROVIDER_RESPONSE_INVALID');
 const language=typeof results.language_code==='string'&&/^[a-z]{2,3}-[A-Z]{2}$/.test(results.language_code)?results.language_code:null;
 return{text,cues,language,provider:'aws_transcribe',timing:'provider_words',requires_review:true};
}
/** The worker must use fixed configured S3 locations, never provider-returned URLs. */
export function transcriptionJob(jobId:string,bucket:string,region:string,language:string){
 if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(jobId)||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)||bucket.includes('..')||!/^us-east-2$/.test(region)||!['en-US','en-GB','es-US','fr-FR','de-DE','pt-BR','it-IT','hi-IN','ja-JP','ko-KR','zh-CN','ar-SA'].includes(language))fail('INVALID_REQUEST');
 const name='pc-live-caption-'+jobId.replaceAll('-',''),prefix='transcription/'+jobId+'/';
 return{region,input_key:prefix+'source.flac',output_key:prefix+'result.json',request:{TranscriptionJobName:name,LanguageCode:language,
  MediaFormat:'flac',Media:{MediaFileUri:`s3://${bucket}/${prefix}source.flac`},OutputBucketName:bucket,OutputKey:prefix+'result.json',
  Tags:[{Key:'Service',Value:'PlatinumLiveCaptions'}]}};
}
