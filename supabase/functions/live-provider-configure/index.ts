import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';
import { createProviderConfigureHandler } from './handler.ts';
import { verifyStorage } from './storage.ts';
const env = (name: string) => Deno.env.get(name) || '';
const service = (signal: AbortSignal) => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => serviceRoleFetch(fetch, env('SUPABASE_SERVICE_ROLE_KEY'), signal)(input, { ...init,
    signal: AbortSignal.any([signal, AbortSignal.timeout(6000), ...(init?.signal ? [init.signal] : []),
      ...(input instanceof Request ? [input.signal] : [])]) }) },
});
Deno.serve(createProviderConfigureHandler({
  rpc: (name, args, signal) => service(signal).rpc(name, args), fetch,
  projectOrigin: env('SUPABASE_URL'), dailyKey: env('DAILY_API_KEY'), domainId: env('LIVE_DAILY_DOMAIN_ID'),
  webhookSecret: env('LIVE_DAILY_WEBHOOK_SECRET'),
  storage: { bucket: env('LIVE_HLS_BUCKET'), region: env('LIVE_HLS_REGION'), assumeRoleArn: env('LIVE_HLS_ASSUME_ROLE_ARN'),
    endpointName: env('LIVE_HLS_ENDPOINT_NAME') || 'platinum-live', verify: verifyStorage },
}));
