import { appleMusicTrackFromCatalog } from '../../../shared/appleMusic.ts';
import { signMusicDeveloperToken, type MusicCredentials } from './token.ts';

type Dependencies = {
  env: (name: string) => string | undefined;
  authenticate: (request: Request) => Promise<{ id: string; anonymous?: boolean } | null>;
  fetch?: typeof fetch;
  sign?: typeof signMusicDeveloperToken;
  now?: () => number;
};

export function createAppleMusicHandler(deps: Dependencies) {
  const requestTimes = new Map<string, number[]>();
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const allowedOrigins = (deps.env('APPLE_MUSIC_ALLOWED_ORIGINS') || '').split(',').map(x => x.trim()).filter(value => {
      try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value; } catch { return false; }
    });
    const originAllowed = !origin || allowedOrigins.includes(origin);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...(origin && originAllowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    };
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers });
    if (!originAllowed) return json(403, { code: 'ORIGIN_NOT_ALLOWED', error: 'Apple Music is not available from this address.' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json(405, { error: 'Use POST.' });
    if (Number(request.headers.get('content-length')) > 4096) return json(413, { error: 'Request is too large.' });
    try {
      const user = await deps.authenticate(request);
      if (!user || user.anonymous) return json(401, { code: 'SIGN_IN_REQUIRED', error: 'Sign in to search Apple Music.' });
      const now = deps.now?.() ?? Date.now();
      // Bound isolate memory as well as request bursts. Provider limits remain authoritative.
      if (requestTimes.size > 2000) for (const [id, hits] of requestTimes) if (hits.at(-1)! < now - 60000) requestTimes.delete(id);
      if (requestTimes.size > 4000) return json(429, { error: 'Music search is busy. Try again shortly.' });
      const hits = (requestTimes.get(user.id) || []).filter(t => t > now - 60000);
      if (hits.length >= 30) return json(429, { error: 'Please wait a minute before searching again.' });
      requestTimes.set(user.id, [...hits, now]);
      const raw = await request.text();
      if (raw.length > 4096) return json(413, { error: 'Request is too large.' });
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { return json(400, { error: 'Invalid request.' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Invalid request.' });
      const teamId = deps.env('APPLE_MUSIC_TEAM_ID') || '';
      const keyId = deps.env('APPLE_MUSIC_KEY_ID') || '';
      const privateKey = deps.env('APPLE_MUSIC_PRIVATE_KEY') || '';
      const configured = /^[A-Z0-9]{10}$/.test(teamId) && /^[A-Z0-9]{10}$/.test(keyId) && privateKey.includes('PRIVATE KEY');
      if (body.action === 'status') return json(200, { configured, playbackAvailable: configured && !!origin, soundtrackAvailable: false });
      if (!configured) return json(503, { code: 'MUSIC_NOT_CONFIGURED', error: 'Apple Music search is not available yet. You can still share an Apple Music song link.' });
      const credentials: MusicCredentials = { teamId, keyId, privateKey };
      const sign = deps.sign || signMusicDeveloperToken;
      if (body.action === 'token') {
        if (!origin) return json(400, { error: 'Web playback requires an approved web origin.' });
        return json(200, await sign(credentials, origin, now));
      }
      if (!['search', 'track'].includes(String(body.action))) return json(400, { error: 'Unknown music action.' });
      const storefront = typeof body.storefront === 'string' ? body.storefront.toLowerCase() : '';
      if (!/^[a-z]{2}$/.test(storefront)) return json(400, { error: 'Choose a valid catalog country.' });
      const term = typeof body.term === 'string' ? body.term.trim() : '';
      const offset = body.offset === undefined ? 0 : body.offset;
      if (body.action === 'search' && (term.length < 2 || term.length > 120 || typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 980)) return json(400, { error: 'Enter 2 to 120 characters to search.' });
      const id = typeof body.id === 'string' ? body.id : '';
      if (body.action === 'track' && !/^\d{1,24}$/.test(id)) return json(400, { error: 'Invalid song.' });
      const url = new URL(body.action === 'search' ? `https://api.music.apple.com/v1/catalog/${storefront}/search` : `https://api.music.apple.com/v1/catalog/${storefront}/songs/${id}`);
      if (body.action === 'search') {
        url.searchParams.set('term', term); url.searchParams.set('types', 'songs');
        url.searchParams.set('limit', '20'); url.searchParams.set('offset', String(offset));
      }
      const { token } = await sign(credentials, undefined, now);
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 10000);
      try {
        const response = await (deps.fetch || fetch)(url, { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal });
        if (response.status === 404) return json(404, { error: 'This song or catalog is not available.' });
        if (response.status === 429) return json(429, { error: 'Apple Music is busy. Try again shortly.' });
        if (!response.ok) return json(503, { code: 'MUSIC_UNAVAILABLE', error: 'Apple Music could not be reached. Try again.' });
        const payload = await response.json();
        const songs = body.action === 'search' ? payload?.results?.songs : payload;
        const tracks = (Array.isArray(songs?.data) ? songs.data : []).map((row: unknown) => appleMusicTrackFromCatalog(row, storefront)).filter(Boolean);
        return json(200, { tracks, nextOffset: body.action === 'search' && songs?.next && Number(offset) < 980 ? Number(offset) + 20 : null });
      } finally { clearTimeout(timer); }
    } catch {
      return json(503, { code: 'MUSIC_UNAVAILABLE', error: 'Apple Music is temporarily unavailable. Try again.' });
    }
  };
}
