import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createCompatiblePushHandler } from './compatibility.ts';
import { boundedFetch } from '../_shared/boundedFetch.ts';
import { createLegacyServiceAuthorizer } from '../_shared/legacyServiceAuthorization.ts';
import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const service = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
 auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: serviceRoleFetch(fetch, serviceKey) },
});
Deno.serve(createCompatiblePushHandler({ service, serviceKey, fetch: boundedFetch(fetch), expoAccessToken: Deno.env.get('EXPO_ACCESS_TOKEN'),
 authorizeLegacyService: createLegacyServiceAuthorizer({ base: Deno.env.get('SUPABASE_URL')!, publicKey: Deno.env.get('SUPABASE_ANON_KEY') || '', fetch: boundedFetch(fetch) }),
}));
