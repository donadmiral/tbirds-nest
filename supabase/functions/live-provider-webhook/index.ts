import { boundedJson, createDailyWebhook } from './webhook.mjs';

const origin = Deno.env.get('SUPABASE_URL') || '';
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const handler = createDailyWebhook({
  origin,
  secret: Deno.env.get('LIVE_DAILY_WEBHOOK_SECRET') || '',
  domainId: Deno.env.get('LIVE_DAILY_DOMAIN_ID') || '',
  relaySecret: origin === 'https://prlkikhckbifseosbukl.supabase.co'
    ? Deno.env.get('LIVE_QA_WEBHOOK_RELAY_SECRET') || '' : '',
  rpc: async (args: Record<string, unknown>) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: key };
    if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
    const response = await fetch(origin + '/rest/v1/rpc/live_provider_event', {
      method: 'POST', headers, body: JSON.stringify(args), redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('EVENT_NOT_CONFIRMED');
    }
    return await boundedJson(response, 8192);
  },
});
Deno.serve(handler);
