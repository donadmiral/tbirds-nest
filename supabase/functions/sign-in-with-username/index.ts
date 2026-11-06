// sign-in-with-username: resolve a handle to its email server-side and
// perform the password sign-in there, so the email never reaches the app
// before authentication. Its exact, indexed username lookup is service-only. Unknown username and wrong password
// return the identical error on purpose.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (s: number, b: unknown) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const body = await req.json().catch(() => ({}));
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || username.length > 128 || !password) return json(400, { error: 'username and password required' });

    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const handle = username.replace(/^@+/, '').toLowerCase();
    const { data: email, error: lookupError } = await svc.rpc('email_for_username', { p_username: handle });
    if (lookupError) return json(503, { error: 'Sign-in is temporarily unavailable' });

    const invalid = () => json(401, { error: 'Invalid username or password' });
    if (typeof email !== 'string' || !email) return invalid();

    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data?.session) return invalid();
    return json(200, { user: data.user, session: data.session });
  } catch {
    return json(503, { error: 'Sign-in is temporarily unavailable' });
  }
});