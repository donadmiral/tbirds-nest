import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createMediaContentHandler } from './handler.ts';
import { createProofTransport, type ProofBudget } from './proofTransport.ts';
import { adaptiveRedirect } from './adaptive.ts';
const base = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const proofTransport = createProofTransport(fetch,serviceKey);
const client = createClient(base, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: proofTransport.fetch } });
// Streaming has the handler's startup/read-idle deadlines. Do not give an
// entire long-lived media response the short database request timeout.
const mediaFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  if (serviceKey.startsWith('sb_secret_')) { headers.set('apikey', serviceKey); headers.delete('Authorization'); }
  return fetch(input, { ...init, headers });
};
const originalHandler = createMediaContentHandler({ base, serviceKey, fetch: mediaFetch,
  async resolve(token,bucket,path,signal,stage,budget) {
    return proofTransport.run(stage,budget,signal,attempt => client.rpc('resolve_media_delivery',{p_token:token,p_bucket:bucket,p_path:path}).abortSignal(attempt));
  },
  ...(Deno.env.get('MEDIA_VARIANT_DELIVERY') === 'true' ? {
    async resolveVariant(token:string,bucket:string,path:string,version:string,signal:AbortSignal,stage:'variant_selection'|'variant_revalidation',budget:ProofBudget) {
      return proofTransport.run(stage,budget,signal,attempt => client.rpc('resolve_media_variant_for_ticket_v1',{p_token:token,p_bucket:bucket,p_path:path,p_source_version:version}).abortSignal(attempt));
    },
  } : {}),
  diagnostic(event) {
    // Successful requests expose phase timings in Server-Timing. Log slow
    // starts and failures without capabilities, object paths or private data.
    if (event.outcome === 'timeout' || event.outcome === 'error' || (event.outcome === 'ready' && event.elapsedMs >= 2000)) {
      console.warn(JSON.stringify({ event: 'media_delivery', ...event }));
    }
  },
});
let gatewayOrigin: { value: string | undefined; until: number } | null = null;
let gatewayLookup: Promise<string | undefined> | null = null;
async function adaptiveOrigin(): Promise<string | undefined> {
  const configured = Deno.env.get('MEDIA_ADAPTIVE_GATEWAY_ORIGIN');
  if (configured) return configured;
  if (gatewayOrigin && gatewayOrigin.until > Date.now()) return gatewayOrigin.value;
  if (gatewayLookup) return gatewayLookup;
  gatewayLookup = (async () => {
    const { data, error } = await client.rpc('media_adaptive_gateway_origin_v2').abortSignal(AbortSignal.timeout(2000));
    const value = !error && typeof data === 'string' ? data : undefined;
    gatewayOrigin = { value, until: Date.now() + (value ? 30000 : 5000) };
    return value;
  })().catch(() => undefined).finally(() => { gatewayLookup = null; });
  return gatewayLookup;
}
Deno.serve(async (request: Request) => {
  const mode = new URL(request.url).searchParams.get('stream');
  if (mode !== 'hls' && mode !== 'check') return originalHandler(request);
  return adaptiveRedirect(request, await adaptiveOrigin()) ?? originalHandler(request);
});
