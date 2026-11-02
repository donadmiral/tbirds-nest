import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createCompatibleVoipHandler } from './compatibility.ts';
import { boundedFetch } from '../_shared/boundedFetch.ts';
import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';
import { createLegacyServiceAuthorizer } from '../_shared/legacyServiceAuthorization.ts';
function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function apnsJwt(): Promise<string> {
  const p8 = Deno.env.get('APNS_KEY_P8') ?? '';
  const keyId = Deno.env.get('APNS_KEY_ID') ?? '';
  const teamId = Deno.env.get('APNS_TEAM_ID') ?? '';
  if (!p8 || !keyId || !teamId) throw new Error('APNs secrets not configured');
  const pem = p8.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${claims}`)));
  return `${header}.${claims}.${b64url(sig)}`;
}


const base = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const publicKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const service = createClient(base, serviceKey, { auth: { persistSession:false,autoRefreshToken:false }, global:{fetch:serviceRoleFetch(fetch,serviceKey)} });
Deno.serve(createCompatibleVoipHandler({
 service,serviceKey,fetch:boundedFetch(fetch),apnsToken:apnsJwt,androidDataOnly:Deno.env.get('ANDROID_CALL_MODE')==='data',
 apnsTopic:Deno.env.get('APNS_TOPIC') || (base==='https://uaulhuelcfkjwojtymmw.supabase.co'?'app.platinumcircles.mobile.qa.voip':'app.platinumcircles.mobile.voip'),
 expoAccessToken:Deno.env.get('EXPO_ACCESS_TOKEN'),
 authorizeLegacyService:createLegacyServiceAuthorizer({base,publicKey,fetch:boundedFetch(fetch)}),
 caller:(request,signal)=>createClient(base,publicKey,{auth:{persistSession:false,autoRefreshToken:false},
  global:{headers:{Authorization:request.headers.get('Authorization')||''},fetch:boundedFetch(fetch,signal)}}),
}));
