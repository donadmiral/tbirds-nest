import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { boundedFetch } from '../_shared/boundedFetch.ts';
import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';
import { createLiveCoverHandler } from './handler.ts';

const base = Deno.env.get('SUPABASE_URL')!;
const service = createClient(base, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: serviceRoleFetch(fetch, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!) },
});
Deno.serve(createLiveCoverHandler({
  storageOrigin: base,
  service,
  storage: service.storage.from('live-covers'),
  caller: request => createClient(base, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: request.headers.get('Authorization') || '' }, fetch: boundedFetch(fetch, request.signal) },
  }),
}));
