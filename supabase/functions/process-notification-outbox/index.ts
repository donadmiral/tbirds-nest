import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { boundedFetch } from '../_shared/boundedFetch.ts';
import { createLegacyServiceAuthorizer } from '../_shared/legacyServiceAuthorization.ts';
import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';
import { waitForPush } from '../_shared/pushDelivery.ts';
import { createNotificationOutboxHandler } from './handler.ts';

const base = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const fetcher = boundedFetch(fetch);
const service = createClient(base, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: serviceRoleFetch(fetch, serviceKey) },
});
const authorizeLegacyService = createLegacyServiceAuthorizer({ base, publicKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', fetch: fetcher });
const configuredJobs = Number(Deno.env.get('NOTIFICATION_WORKER_MAX_JOBS'));
const maxJobs = Number.isSafeInteger(configuredJobs) && configuredJobs > 0 ? Math.min(configuredJobs, 100) : 32;
Deno.serve(async request => {
  let consumed: string | null = null;
  const response = await createNotificationOutboxHandler({ service, serviceKey, fetch: fetcher, maxJobs,
    authorizeLegacyService,
    authorizeWorker: async (incoming, signal) => {
      const token = /^Bearer (pc_notify_[a-f0-9]{64})$/.exec(incoming.headers.get('Authorization') ?? '')?.[1];
      if (!token) return false;
      const proof = await waitForPush(service.rpc('validate_notification_worker_tick_v1', { p_token: token }).abortSignal(signal), signal);
      if (proof.error || proof.data !== true) return false;
      consumed = token;
      return true;
    },
  })(request);
  if (consumed) {
    try {
      const signal = AbortSignal.timeout(1500);
      await waitForPush(service.rpc('finish_notification_worker_tick_v1', {
        p_token: consumed, p_succeeded: response.ok,
      }).abortSignal(signal), signal);
    } catch { /* The expired slot becomes reusable even if the final receipt is interrupted. */ }
  }
  return response;
});
