import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { guardBusinessRequest } from './businessSessionGuard.ts';
import { boundedFetch } from './boundedFetch.ts';

export function serveBusinessRequest(handler: (request: Request) => Response | Promise<Response>, shouldCheck?: (request: Request) => boolean) {
  Deno.serve(guardBusinessRequest(handler, request => createClient(
    Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{
      auth:{persistSession:false,autoRefreshToken:false},
      global:{headers:{Authorization:request.headers.get('Authorization')||''},fetch:boundedFetch(fetch,request.signal)},
    },
  ),shouldCheck));
}
