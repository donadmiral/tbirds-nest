// link-preview: fetches a URL server-side, extracts OpenGraph metadata,
// caches it in link_previews. The client never fetches external sites
// directly (slow, leaks user IPs). Cache hit = no external request.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CACHE_DAYS = 7;

function pick(html: string, prop: string): string | null {
  const re1 = new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, 'i');
  const m = html.match(re1) || html.match(re2);
  return m ? m[1] : null;
}

function decode(s: string | null): string | null {
  if (!s) return null;
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").slice(0, 300);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization') ?? '';
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: authErr } = await anon.auth.getUser();
  if (authErr || !userData?.user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });

  let url: string;
  try {
    const body = await req.json();
    url = String(body.url || '').trim();
  } catch { return new Response(JSON.stringify({ error: 'bad body' }), { status: 400 }); }

  let parsed: URL;
  try { parsed = new URL(url); } catch { return new Response(JSON.stringify({ error: 'bad url' }), { status: 400 }); }
  if (!/^https?:$/.test(parsed.protocol)) return new Response(JSON.stringify({ error: 'bad scheme' }), { status: 400 });
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')
      || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '0.0.0.0' || host === '[::1]') {
    return new Response(JSON.stringify({ error: 'blocked host' }), { status: 400 });
  }

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: cached } = await svc.from('link_previews').select('*').eq('url', url).maybeSingle();
  if (cached && (Date.now() - new Date(cached.fetched_at).getTime()) < CACHE_DAYS * 86400000) {
    return new Response(JSON.stringify(cached), { headers: { 'Content-Type': 'application/json' } });
  }

  let html = '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PlatinumCircles/1.0; +https://platinumcircles.app)' },
    });
    clearTimeout(t);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return new Response(JSON.stringify({ error: 'not html' }), { status: 422 });
    html = (await res.text()).slice(0, 300000);
  } catch {
    return new Response(JSON.stringify({ error: 'fetch failed' }), { status: 502 });
  }

  const titleTag = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const row = {
    url,
    title: decode(pick(html, 'title')) || decode(titleTag ? titleTag[1] : null),
    description: decode(pick(html, 'description')),
    image_url: pick(html, 'image'),
    domain: host.replace(/^www\./, ''),
    fetched_at: new Date().toISOString(),
  };

  const { data: saved, error: upErr } = await svc.from('link_previews')
    .upsert(row, { onConflict: 'url' }).select().single();
  if (upErr) return new Response(JSON.stringify({ error: upErr.message }), { status: 500 });

  return new Response(JSON.stringify(saved), { headers: { 'Content-Type': 'application/json' } });
});