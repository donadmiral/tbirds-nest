import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createPrivateMediaSession } from '../private-media-session/handler.ts';
Deno.serve(createPrivateMediaSession({ protocol: 'legacy', env: name => Deno.env.get(name), fetch,
  client: (url, key, authorization) => createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization || '' } },
  }),
}));
