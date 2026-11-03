import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {createClipWorkerHandler} from './handler.ts';
import {serviceRoleFetch} from '../_shared/serviceRoleFetch.ts';
const env=(name:string)=>Deno.env.get(name)||'';
const service=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:serviceRoleFetch(fetch,env('SUPABASE_SERVICE_ROLE_KEY'))}});
Deno.serve(createClipWorkerHandler({service,secret:env('LIVE_CLIP_WORKER_SECRET'),cdnOrigin:env('LIVE_HLS_CDN_ORIGIN'),
 signerUrl:env('LIVE_PLAYBACK_SIGNER_URL'),signerSecret:env('LIVE_PLAYBACK_SIGNER_SECRET'),fetch,
 async signUpload(path){const {data,error}=await service.storage.from('live-clips').createSignedUploadUrl(path,{upsert:false});return error?null:data?.signedUrl||null;},
 async remove(paths){const {error}=await service.storage.from('live-clips').remove(paths);return !error;},
}));
