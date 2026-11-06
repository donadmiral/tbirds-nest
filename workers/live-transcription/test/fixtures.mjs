import { loadConfig } from '../config.mjs';
export const env={SUPABASE_URL:'https://prlkikhckbifseosbukl.supabase.co',AWS_ACCOUNT_ID:'123456789012',AWS_REGION:'us-east-2',LIVE_TRANSCRIPTION_BUCKET:'synthetic-caption-bucket',LIVE_TRANSCRIPTION_DATA_ROLE_ARN:'arn:aws:iam::123456789012:role/SyntheticTranscribeData',LIVE_TRANSCRIPTION_WORKER_SECRET:'synthetic-worker-secret-never-a-real-key',TRANSCRIPTION_DEPLOYMENT:'SyntheticCaptionWorker',LIVE_TRANSCRIPTION_EXECUTION_ENABLED:'true'};
export const config=()=>loadConfig({...env});
export const job=(extra={})=>({id:'11111111-1111-4111-8111-111111111111',lease_id:'22222222-2222-4222-8222-222222222222',clip_id:'33333333-3333-4333-8333-333333333333',format:'horizontal',language:'en-US',duration_ms:30000,job_name:'pc-live-caption-11111111111141118111111111111111',cleanup:false,configuration_hash:null,...extra});
export const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
export const remote=(plan,state='IN_PROGRESS')=>({...plan.request,TranscriptionJobStatus:state});
export const missing=()=>Object.assign(new Error("The requested job couldn't be found. Check the job name and try your request again."),{name:'BadRequestException'});
export const failure=code=>error=>error?.code===code;
