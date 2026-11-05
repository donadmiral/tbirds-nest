// Temporary, exact-fixture Storage cleanup. Retire after verified absence.
// No Storage policy changes and no service credentials leave the Edge runtime.
const base = 'https://uaulhuelcfkjwojtymmw.supabase.co';
const owner = '68b5b172-65dc-4611-9e40-7edd310a6c66';
const marker = 'c26762d6-a165-4910-a76f-820855533f24';
const groups = [
  { bucket: 'chat-media', paths: ['ordinary.mp4', 'limited.mp4'].map(name => `${owner}/${marker}/${name}`) },
  { bucket: 'adaptive-media', paths: [
    '0e47c19a-a547-46ee-ae14-3646710b6459/ef6a0c8c-2eec-4b63-b02d-3b952137d239/',
    'f85a7449-53e4-4d30-b95d-45ae2853e617/d6757b4c-425f-40a8-b7f3-93a801578ec0/',
  ].flatMap(prefix => ['fallback.mp4', 'master.m3u8', 'r0/index.m3u8', 'r0/seg00000.ts']
    .map(name => `${owner}/_renditions_v2/${prefix}${name}`)) },
];
const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
Deno.serve(async request => {
  if (Date.now() >= Date.parse('2026-11-05T18:00:00Z')) return reply(410, { error: 'RETIRED' });
  if (request.method !== 'POST') return reply(405, { error: 'METHOD' });
  if (Deno.env.get('SUPABASE_URL') !== base) return reply(503, { error: 'QA_ONLY' });
  const token = request.headers.get('Authorization') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!service || !anon || !token.startsWith('Bearer ') || token === `Bearer ${service}`) return reply(401, { error: 'AUTH' });
  try {
    const auth = await fetch(base + '/auth/v1/user', { headers: { Authorization: token, apikey: anon },
      redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!auth.ok) return reply(401, { error: 'AUTH' });
    const user = await auth.json();
    if (user.id !== owner || user.user_metadata?.qa_private_hls_canary !== marker) return reply(403, { error: 'FIXTURE_ONLY' });
    let removed = 0;
    for (const group of groups) {
      const response = await fetch(base + '/storage/v1/object/' + group.bucket, {
        method: 'DELETE', headers: { Authorization: `Bearer ${service}`, apikey: service, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: group.paths }), redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return reply(503, { error: 'STORAGE', removed });
      const values = await response.json();
      if (!Array.isArray(values) || values.some(value => !group.paths.includes(value.name))) return reply(503, { error: 'RESPONSE', removed });
      removed += values.length;
    }
    return reply(200, { removed, exactAllowedObjects: 10, independentAbsenceReadbackRequired: true });
  } catch { return reply(503, { error: 'CLEANUP_UNAVAILABLE' }); }
});
