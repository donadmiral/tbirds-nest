/** Only additive HLS discovery uses the external gateway. Original delivery is unchanged. */
const liveClipPath = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/){4}(?:horizontal|vertical)\.mp4$/;
export function adaptiveRedirect(request: Request, origin?: string): Response | null {
  const source = new URL(request.url), mode = source.searchParams.get('stream');
  if (mode !== 'hls' && mode !== 'check') return null;
  const headers = { 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Referrer-Policy': 'no-referrer' };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return new Response(null, { status: 405, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  // Supabase's relay can remove /functions/v1 before forwarding to the
  // function. Match the same two route shapes as original media delivery.
  const match = source.pathname.match(/^\/(?:functions\/v1\/)?media-content\/(post-media|story-media|live-clips)\/(.+)$/);
  let path = '';
  try { path = decodeURIComponent(match?.[2] || ''); } catch { return new Response(null, { status: 400, headers }); }
  if (!match || path.length > 1024 || /[%\\\u0000-\u001f]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..') || !/^[0-9a-f]{64}$/.test(source.searchParams.get('token') || '')
    || (match[1] === 'live-clips' && (!liveClipPath.test(path) || source.searchParams.getAll('token').length !== 1))) return new Response(null, { status: 400, headers });
  if (!origin) return new Response(JSON.stringify({ ready: false }), { status: mode === 'check' ? 200 : 404, headers: { ...headers, 'Content-Type': 'application/json' } });
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) return new Response(null, { status: 503, headers });
  const target = new URL(`/playback/${match[1]}/${path.split('/').map(encodeURIComponent).join('/')}`, base);
  target.searchParams.set('token', source.searchParams.get('token')!);
  if (mode === 'check') target.searchParams.set('format', 'json');
  return new Response(null, { status: 307, headers: { ...headers, Location: target.href } });
}
