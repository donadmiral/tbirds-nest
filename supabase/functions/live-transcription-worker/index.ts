import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {serviceRoleFetch} from '../_shared/serviceRoleFetch.ts';
import {createTranscriptionWorkerHandler} from './handler.ts';
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const service=createClient(base,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:serviceRoleFetch(fetch,key)}});
Deno.serve(createTranscriptionWorkerHandler({base,secret:Deno.env.get('LIVE_TRANSCRIPTION_WORKER_SECRET')||'',peekSecret:Deno.env.get('LIVE_TRANSCRIPTION_QUEUE_SECRET')||'',rpc:(name,args)=>service.rpc(name,args),
 async sign(path,ttl){const r=await service.storage.from('live-clips').createSignedUrl(path,ttl);return r.error?null:r.data?.signedUrl||null;},
}));
