// business-signin: a company representative signs in AS the business.
// Checks: business exists, access code valid and active, device approved.
// First device a business ever uses is trusted automatically; every later
// device must be approved from inside the business account. Returns a
// magiclink token_hash the client exchanges for a session as the business.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const svc = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    const { handle, code, device_id, device_label } = await req.json();
    if (!handle || !code || !device_id) {
      return new Response(JSON.stringify({ error: 'Handle, access code and device are required.' }), { status: 400, headers });
    }
    const h = String(handle).trim().toLowerCase().replace(/^@/, '');

    const { data: biz } = await svc.from('profiles')
      .select('id, full_name, username, account_type, deactivated_at')
      .ilike('username', h).eq('account_type', 'business').maybeSingle();
    if (!biz) return new Response(JSON.stringify({ error: 'No business account with that handle.' }), { status: 404, headers });
    if (biz.deactivated_at) return new Response(JSON.stringify({ error: 'This business account is suspended.' }), { status: 403, headers });

    const codeHash = await sha256(String(code).trim().toUpperCase());
    const { data: member } = await svc.from('business_access_members')
      .select('id, display_name, active').eq('business_id', biz.id).eq('code_hash', codeHash).maybeSingle();
    if (!member) {
      return new Response(JSON.stringify({ error: 'Invalid or revoked access credential.' }), { status: 401, headers });
    }

    const { data: devices } = await svc.from('business_devices').select('id, device_id, status').eq('business_id', biz.id);
    const known = (devices ?? []).find(d => d.device_id === device_id);
    if ((devices ?? []).length === 0) {
      await svc.from('business_devices').insert({ business_id: biz.id, device_id, label: device_label || 'First company device', status: 'approved', approved_at: new Date().toISOString() });
    } else if (!known) {
      // Testing phase: any device with a valid code is trusted automatically.
      await svc.from('business_devices').insert({ business_id: biz.id, device_id, label: device_label || 'Auto-trusted device', status: 'approved', approved_at: new Date().toISOString() });
    } else if (known.status !== 'approved') {
      await svc.from('business_devices').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', known.id);
    }

    await svc.from('business_access_members').update({ last_sign_in_at: new Date().toISOString() }).eq('id', member.id);
    await svc.from('business_signin_log').insert({ business_id: biz.id, member_id: member.id, member_name: member.display_name, device_id });

    const { data: authUser } = await svc.auth.admin.getUserById(biz.id);
    const email = authUser?.user?.email;
    if (!email) return new Response(JSON.stringify({ error: 'Business identity is missing its auth record.' }), { status: 500, headers });
    const { data: link, error: lErr } = await svc.auth.admin.generateLink({ type: 'magiclink', email });
    const tokenHash = (link as any)?.properties?.hashed_token;
    if (lErr || !tokenHash) return new Response(JSON.stringify({ error: 'Could not start the session.' }), { status: 500, headers });

    return new Response(JSON.stringify({ token_hash: tokenHash, email, business_name: biz.full_name, member_name: member.display_name }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error)?.message || 'Sign-in failed.' }), { status: 500, headers });
  }
});
