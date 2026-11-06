// Temporary cleanup for exactly two reviewed synthetic public source objects.
// Remove the exact canary post first. Retire this endpoint after absence readback.
const base = 'https://uaulhuelcfkjwojtymmw.supabase.co';
const owner = '78d81bd0-3381-499a-a8f3-f8264e36973c';
const marker = '554e817b-78b8-4e64-9a94-b2aa80fdca4d';
const paths = ['source.png', 'source.mp4'].map(name => `${owner}/${marker}/${name}`);
const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
Deno.serve(async request => {
  if (Date.now() >= Date.parse('2026-11-05T20:10:00Z')) return reply(410, { error: 'RETIRED' });
  if (request.method !== 'POST') return reply(405, { error: 'METHOD' });
  if (Deno.env.get('SUPABASE_URL') !== base) return reply(503, { error: 'QA_ONLY' });
  const token = request.headers.get('Authorization') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!service || !anon || !token.startsWith('Bearer ') || token === `Bearer ${service}`) return reply(401, { error: 'AUTH' });
  try {
    const auth = await fetch(base + '/auth/v1/user', {
      headers: { Authorization: token, apikey: anon }, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!auth.ok) return reply(401, { error: 'AUTH' });
    const user = await auth.json();
    if (user.id !== owner || user.user_metadata?.qa_physical_cache_canary !== marker) return reply(403, { error: 'FIXTURE_ONLY' });
    const response = await fetch(base + '/storage/v1/object/post-media', {
      method: 'DELETE', headers: { Authorization: `Bearer ${service}`, apikey: service, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: paths }), redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return reply(503, { error: 'STORAGE' });
    const values = await response.json();
    if (!Array.isArray(values) || values.length !== paths.length
      || !paths.every(path => values.some(value => value?.name === path))) return reply(503, { error: 'EXACT_DELETIONS_REQUIRED' });
    return reply(200, { removed: values.length, exactAllowedObjects: paths.length, independentAbsenceReadbackRequired: true });
  } catch { return reply(503, { error: 'CLEANUP_UNAVAILABLE' }); }
});
