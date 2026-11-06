import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {createClipMediaHandler} from './handler.ts';
import {serviceRoleFetch} from '../_shared/serviceRoleFetch.ts';
import {boundedFetch} from '../_shared/boundedFetch.ts';
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const service=createClient(base,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:serviceRoleFetch(fetch,key)}});
Deno.serve(createClipMediaHandler({base,caller:request=>createClient(base,Deno.env.get('SUPABASE_ANON_KEY')!,{
 auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:request.headers.get('Authorization')||''},fetch:boundedFetch(fetch,request.signal)},
}),async sign(path,ttl){const {data,error}=await service.storage.from('live-clips').createSignedUrl(path,ttl);return error?null:data?.signedUrl||null;}}));
