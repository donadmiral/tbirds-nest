import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';
import { createMediaBroker } from './handler.mjs';
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const backendFetch=serviceRoleFetch(fetch,key);
const client=createClient(base,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:backendFetch}});
const json=async(path:string,body:unknown,signal:AbortSignal)=>{
 const response=await backendFetch(base+'/storage/v1/'+path,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','x-upsert':'false'},body:JSON.stringify(body),signal,redirect:'error'});
 if(!response.ok){await response.body?.cancel();throw new Error('storage_unavailable');}
 return response.json();
};
Deno.serve(createMediaBroker({base,
 async rpc(name:string,args:Record<string,unknown>,signal:AbortSignal){const{data,error}=await client.rpc(name,args).abortSignal(signal);if(error)throw new Error('database_unavailable');return data;},
 storage:{
  async downloadURL(bucket:string,path:string,expiresIn:number,signal:AbortSignal){const data=await json('object/sign/'+bucket+'/'+path.split('/').map(encodeURIComponent).join('/'),{expiresIn},signal);return new URL(base+'/storage/v1'+(data.signedURL||data.signedUrl)).href;},
  async uploadURL(bucket:string,path:string,signal:AbortSignal){const data=await json('object/upload/sign/'+bucket+'/'+path.split('/').map(encodeURIComponent).join('/'),{},signal);return new URL(base+'/storage/v1'+data.url).href;},
  async remove(bucket:string,prefixes:string[],signal:AbortSignal){const response=await backendFetch(base+'/storage/v1/object/'+bucket,{method:'DELETE',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({prefixes}),signal,redirect:'error'});if(!response.ok){await response.body?.cancel();throw new Error('cleanup_unavailable');}await response.body?.cancel();},
 },
}));
