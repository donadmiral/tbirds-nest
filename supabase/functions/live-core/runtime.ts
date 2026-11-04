import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { boundedFetch } from '../_shared/boundedFetch.ts';
import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';
import { createLiveHandler } from './handler.ts';
import { withProviderDiagnostics } from './providerDiagnostics.ts';

export function serveLive(mode:'stage'|'control'|'playback'|'webhook'|'maintenance'){
 const env=(name:string)=>Deno.env.get(name)||'';
 const service=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:serviceRoleFetch(fetch,env('SUPABASE_SERVICE_ROLE_KEY'))}});
 const handler=createLiveHandler(mode,{
  service,
  removeCovers:paths=>service.storage.from('live-covers').remove(paths),
  caller:request=>createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{
   auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:request.headers.get('Authorization')||''},fetch:boundedFetch(fetch,request.signal)},
  }),
  fetch:withProviderDiagnostics(fetch,diagnostic=>console.warn(JSON.stringify(diagnostic))),
  config:{dailyKey:env('DAILY_API_KEY'),endpointName:env('LIVE_HLS_ENDPOINT_NAME')||'platinum-live',bucket:env('LIVE_HLS_BUCKET'),region:env('LIVE_HLS_REGION'),
   assumeRoleArn:env('LIVE_HLS_ASSUME_ROLE_ARN'),cdnOrigin:env('LIVE_HLS_CDN_ORIGIN'),signerUrl:env('LIVE_PLAYBACK_SIGNER_URL'),signerSecret:env('LIVE_PLAYBACK_SIGNER_SECRET'),
   webhookSecret:env('LIVE_DAILY_WEBHOOK_SECRET'),domainId:env('LIVE_DAILY_DOMAIN_ID'),workerSecret:env('LIVE_WORKER_SECRET')},
 });
 Deno.serve(handler);
}
