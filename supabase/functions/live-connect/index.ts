import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {createConnectHandler} from '../live-integrations-core/connect.ts';
import {Platform} from '../live-integrations-core/security.ts';
import {serviceRoleFetch} from '../_shared/serviceRoleFetch.ts';
import {boundedFetch} from '../_shared/boundedFetch.ts';
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const service=createClient(base,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:serviceRoleFetch(fetch,key)}});
const clients:Partial<Record<Platform,{clientId:string;clientSecret:string}>>={};
for(const platform of ['x','facebook','instagram','youtube','tiktok'] as const){
 const prefix=platform==='facebook'||platform==='instagram'?'META':platform.toUpperCase();
 const clientId=Deno.env.get(`LIVE_${prefix}_CLIENT_ID`),clientSecret=Deno.env.get(`LIVE_${prefix}_CLIENT_SECRET`);
 if(clientId&&clientSecret)clients[platform]={clientId,clientSecret};
}
let keys:Record<string,string>={};try{keys=JSON.parse(Deno.env.get('LIVE_INTEGRATION_VAULT_KEYS')||'{}');}catch{/* Configuration failure stays closed. */}
Deno.serve(createConnectHandler({config:{clients,redirectUri:Deno.env.get('LIVE_SOCIAL_REDIRECT_URI')||'',metaVersion:Deno.env.get('LIVE_META_GRAPH_VERSION')},vault:{activeKeyId:Deno.env.get('LIVE_INTEGRATION_VAULT_KEY_ID')||'',keys},fetch,
 rpc:(name,args)=>service.rpc(name,args),caller:request=>createClient(base,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:request.headers.get('Authorization')||''},fetch:boundedFetch(fetch,request.signal)}}),
}));
