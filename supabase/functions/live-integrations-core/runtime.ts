import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {serviceRoleFetch} from '../_shared/serviceRoleFetch.ts';
import {boundedFetch} from '../_shared/boundedFetch.ts';
import type {Platform,Vault} from './security.ts';
import type {ProviderConfig} from './providers.ts';
export function integrationRuntime(){
 const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const service=createClient(base,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:serviceRoleFetch(fetch,key)}});
 const clients:ProviderConfig['clients']={};for(const platform of ['x','facebook','instagram','youtube','tiktok'] as Platform[]){const prefix=platform==='facebook'||platform==='instagram'?'META':platform.toUpperCase(),clientId=Deno.env.get(`LIVE_${prefix}_CLIENT_ID`),clientSecret=Deno.env.get(`LIVE_${prefix}_CLIENT_SECRET`);if(clientId&&clientSecret)clients[platform]={clientId,clientSecret};}
 let keys:Vault['keys']={};try{keys=JSON.parse(Deno.env.get('LIVE_INTEGRATION_VAULT_KEYS')||'{}');}catch{/* Fail closed. */}
 return{base,pullOrigin:Deno.env.get('LIVE_TIKTOK_VERIFIED_ORIGIN')||'',config:{clients,redirectUri:Deno.env.get('LIVE_SOCIAL_REDIRECT_URI')||'',metaVersion:Deno.env.get('LIVE_META_GRAPH_VERSION')} as ProviderConfig,vault:{activeKeyId:Deno.env.get('LIVE_INTEGRATION_VAULT_KEY_ID')||'',keys},fetch,
  rpc:(name:string,args:Record<string,unknown>)=>service.rpc(name,args),caller:(request:Request)=>createClient(base,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:request.headers.get('Authorization')||''},fetch:boundedFetch(fetch,request.signal)}}),
  async sign(path:string,ttl:number){const r=await service.storage.from('live-clips').createSignedUrl(path,ttl);return r.error?null:r.data?.signedUrl||null;}};
}
