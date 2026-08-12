// sign-in-with-username: resolve a handle to its email server-side and
// perform the password sign-in there, so the email never reaches the app
// before authentication. Replaces the anon-callable email_for_username RPC,
// which gets revoked on flip day. Unknown username and wrong password
// return the identical error on purpose.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) return json(400, { error: 'username and password required' });

    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const handle = username.replace(/^@+/, '').toLowerCase();
    const { data: prof } = await svc.from('profiles')
      .select('email').ilike('username', handle).limit(1).maybeSingle();

    const invalid = () => json(401, { error: 'Invalid username or password' });
    if (!prof?.email) return invalid();

    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data, error } = await anon.auth.signInWithPassword({ email: prof.email, password });
    if (error || !data?.session) return invalid();
    return json(200, { user: data.user, session: data.session });
  } catch (e) {
    return json(500, { error: String((e as any)?.message || e) });
  }
});