import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';
import { createPrivateHLS } from './handler.ts';
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
Deno.serve(createPrivateHLS({
 env:name=>Deno.env.get(name),
 client:(url,key,authorization)=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:authorization}}}),
 fetch:serviceRoleFetch(fetch,service),
}));
