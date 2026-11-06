import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createMaintenanceHandler } from './handler.ts';
import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';
import { withProviderDiagnostics } from '../live-core/providerDiagnostics.ts';
const env = (name: string) => Deno.env.get(name) || '';
const service = (signal: AbortSignal) => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => serviceRoleFetch(fetch, env('SUPABASE_SERVICE_ROLE_KEY'), signal)(input, { ...init, signal: AbortSignal.any([
    signal, AbortSignal.timeout(6000), ...(init?.signal ? [init.signal] : []), ...(input instanceof Request ? [input.signal] : []),
  ]) }) },
});
// Presence checks only. These do not expose secrets or claim vendor acceptance.
const names = ['DAILY_API_KEY', 'LIVE_HLS_BUCKET', 'LIVE_HLS_REGION', 'LIVE_HLS_ASSUME_ROLE_ARN',
  'LIVE_HLS_CDN_ORIGIN', 'LIVE_PLAYBACK_SIGNER_URL', 'LIVE_PLAYBACK_SIGNER_SECRET', 'LIVE_DAILY_WEBHOOK_SECRET', 'LIVE_DAILY_DOMAIN_ID'];
Deno.serve(createMaintenanceHandler({
  rpc: (name, args, signal) => service(signal).rpc(name, args),
  removeCover: (path, signal) => service(signal).storage.from('live-covers').remove([path]),
  fetch: withProviderDiagnostics(fetch, diagnostic => console.warn(JSON.stringify(diagnostic))),
  dailyKey: env('DAILY_API_KEY'), configuration: Object.fromEntries(names.map(name => [name, !!env(name)])),
}));
