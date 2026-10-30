import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createBusinessSessionHandler, type BusinessSessionDependencies } from './handler.ts';
import { boundedFetch } from '../_shared/boundedFetch.ts';

export function businessSessionRuntime(mode: 'code' | 'owner') {
  return async (request: Request) => {
    const url = Deno.env.get('SUPABASE_URL'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), anon = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !service || !anon) return new Response(JSON.stringify({ code: 'BUSINESS_SESSION_UNAVAILABLE', error: 'Business sign-in is unavailable.' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
    const svc = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false }, global: {fetch:boundedFetch(fetch,request.signal)} });
    const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: {fetch:boundedFetch(fetch,request.signal)} });
    // Cancellation of the user request must not cancel compensating revocation.
    // Cleanup has its own eight-second per-call deadline and no parent signal.
    const cleanup = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false }, global: {fetch:boundedFetch(fetch)} });
    const deps: BusinessSessionDependencies = {
      rpc: async (name, args) => await (name==='triniti_business_cancel_signin'?cleanup:svc).rpc(name, args),
      getUser: token => svc.auth.getUser(token),
      getClaims: async token => await svc.auth.getClaims(token),
      getUserById: id => svc.auth.admin.getUserById(id),
      generateLink: email => svc.auth.admin.generateLink({ type: 'magiclink', email }),
      exchange: async token_hash => await auth.auth.verifyOtp({ type: 'magiclink', token_hash }),
      revoke: token => cleanup.auth.admin.signOut(token, 'local'),
      hash: async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join(''),
    };
    return createBusinessSessionHandler(mode, deps)(request);
  };
}
