import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createMusicMaintenanceHandler } from './handler.ts';
const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(createMusicMaintenanceHandler({
  env: name => Deno.env.get(name),
  async rpc(name, args, signal) {
    const { data, error } = await client.rpc(name, args).abortSignal(signal);
    if (error) throw new Error('Music maintenance database unavailable');
    return data;
  },
  fetch, uuid: () => crypto.randomUUID(),
}));
