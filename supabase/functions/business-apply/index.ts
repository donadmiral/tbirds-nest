// business-apply: a company applies for its account with NO personal
// login. Validates and files the application; the operations desk
// reviews it like any other. applicant_id stays null - the business
// will own itself on approval.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const svc = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    const b = await req.json();
    const company_name = String(b.company_name || '').trim();
    const description = String(b.description || '').trim();
    const contact_email = String(b.contact_email || '').trim();
    const desired_username = String(b.desired_username || '').trim().toLowerCase();
    if (!company_name || !description || !contact_email || !desired_username) {
      return new Response(JSON.stringify({ error: 'Company name, what you do, a contact email and a desired @ are required.' }), { status: 400, headers });
    }
    if (!/^[a-z0-9_]{3,30}$/.test(desired_username)) {
      return new Response(JSON.stringify({ error: 'Handle must be 3 to 30 characters: letters, numbers, underscores.' }), { status: 400, headers });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact_email)) {
      return new Response(JSON.stringify({ error: 'That contact email does not look valid.' }), { status: 400, headers });
    }
    const { count } = await svc.from('business_applications')
      .select('id', { count: 'exact', head: true })
      .eq('contact_email', contact_email).eq('status', 'submitted');
    if ((count ?? 0) >= 3) {
      return new Response(JSON.stringify({ error: 'There are already applications under review for this email.' }), { status: 429, headers });
    }
    const { error } = await svc.from('business_applications').insert({
      applicant_id: null,
      company_name,
      category: String(b.category || '').trim() || null,
      description,
      contact_email,
      contact_phone: String(b.contact_phone || '').trim() || null,
      website: String(b.website || '').trim() || null,
      registration_info: String(b.registration_info || '').trim() || null,
      desired_username,
    });
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error)?.message || 'Could not file the application.' }), { status: 500, headers });
  }
});