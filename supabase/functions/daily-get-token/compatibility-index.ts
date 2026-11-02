import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createCompatibleDailyTokenHandler } from './compatibility.ts';
import { boundedFetch } from '../_shared/boundedFetch.ts';
import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';
const base = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const service = createClient(base,serviceKey,{
  auth:{persistSession:false,autoRefreshToken:false},global:{fetch:serviceRoleFetch(fetch,serviceKey)},
});
Deno.serve(createCompatibleDailyTokenHandler({
  service, dailyKey:Deno.env.get('DAILY_API_KEY')||'', fetch:boundedFetch(fetch),
  caller:(request,signal)=>createClient(base,Deno.env.get('SUPABASE_ANON_KEY')!,{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{headers:{Authorization:request.headers.get('Authorization')||''},
      fetch:(input,init)=>boundedFetch(fetch)(input,{...init,signal:AbortSignal.any([signal,...(init?.signal?[init.signal]:[])])})},
  }),
}));
