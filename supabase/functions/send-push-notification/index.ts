import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { boundedFetch } from '../_shared/boundedFetch.ts';
import { createPushNotificationHandler } from './handler.ts';

const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const service = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: boundedFetch(fetch) },
});
Deno.serve(createPushNotificationHandler({ service, serviceKey, fetch: boundedFetch(fetch), expoAccessToken: Deno.env.get('EXPO_ACCESS_TOKEN') }));
