import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';
import { createClipQueueHandler } from './handler.ts';
const env = (name: string) => Deno.env.get(name) || '';
const service = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: serviceRoleFetch(fetch, env('SUPABASE_SERVICE_ROLE_KEY')) },
});
Deno.serve(createClipQueueHandler({ service, secret: env('LIVE_CLIP_QUEUE_SECRET') }));
