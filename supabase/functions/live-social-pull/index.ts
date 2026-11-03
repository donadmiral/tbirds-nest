import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {serviceRoleFetch} from '../_shared/serviceRoleFetch.ts';
import {createSocialPullHandler} from './handler.ts';
const base=Deno.env.get('SUPABASE_URL')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const service=createClient(base,serviceKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:serviceRoleFetch(fetch,serviceKey)}});
Deno.serve(createSocialPullHandler({base,serviceKey,
 async resolve(id,tokenHash,consume,signal){const result=await service.rpc('live_social_pull_grant',{p_id:id,p_token_hash:tokenHash,p_consume:consume}).abortSignal(signal);if(result.error)throw Error('MEDIA_UNAVAILABLE');return result.data;},
 fetch:(url,init)=>{const headers=new Headers(init?.headers);if(serviceKey.startsWith('sb_secret_')){headers.set('apikey',serviceKey);headers.delete('Authorization');}return fetch(url,{...init,headers});},
}));
