import { serveBusinessRequest } from '../_shared/serveBusinessRequest.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createAppleMusicHandler } from './handler.ts';

serveBusinessRequest(createAppleMusicHandler({
  env: name => Deno.env.get(name),
  authenticate: async request => {
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) return null;
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser();
    return error || !data.user ? null : { id: data.user.id, anonymous: data.user.is_anonymous };
  },
}));
