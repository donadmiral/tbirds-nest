/**
 * linkPreview.ts
 *
 * Client-side link unfurling for post links. Checked first: link_previews
 * is a plain url/title/description/image_url/domain/fetched_at cache table
 * with no populating trigger or edge function behind it, and get_feed just
 * left-joins it by url. So this fetches the page on-device, pulls Open
 * Graph tags with regex, and caches the result via the upsert_link_preview
 * RPC. Never throws: any failure (blocked fetch, no OG tags, timeout)
 * falls back to a domain-only preview so a post with a working link never
 * breaks on a preview miss.
 *
 * Honest limit: some sites (TikTok in particular) gate real metadata
 * behind JS rendering a plain fetch can't run, so those often fall back
 * to the domain-only card. YouTube and most standard sites carry OG tags
 * in the server HTML and unfurl cleanly.
 */
import { supabase } from './supabase';

export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  domain: string | null;
};

export function normalizeUrl(raw: string): string {
  const t = raw.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function deriveDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function metaTag(html: string, names: string[]): string | null {
  for (const name of names) {
    const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'));
    if (a && a[1]) return decodeEntities(a[1]);
    const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, 'i'));
    if (b && b[1]) return decodeEntities(b[1]);
  }
  return null;
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview> {
  const url = normalizeUrl(rawUrl);
  const domain = deriveDomain(url);
  const fallback: LinkPreview = { url, title: null, description: null, image_url: null, domain };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PlatinumCirclesBot/1.0)' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('text/html')) return fallback;
    const html = (await res.text()).slice(0, 200000);
    const title = metaTag(html, ['og:title', 'twitter:title']) || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null);
    const description = metaTag(html, ['og:description', 'twitter:description', 'description']);
    let image = metaTag(html, ['og:image', 'twitter:image']);
    if (image && !/^https?:\/\//i.test(image)) {
      try { image = new URL(image, url).toString(); } catch { image = null; }
    }
    return {
      url,
      title: title ? decodeEntities(title).trim().slice(0, 200) : null,
      description: description ? description.trim().slice(0, 300) : null,
      image_url: image,
      domain,
    };
  } catch {
    return fallback;
  }
}

export async function cacheLinkPreview(preview: LinkPreview): Promise<void> {
  try {
    await supabase.rpc('upsert_link_preview', {
      p_url: preview.url,
      p_title: preview.title,
      p_description: preview.description,
      p_image_url: preview.image_url,
      p_domain: preview.domain,
    });
  } catch (e) {
    console.log('[linkPreview.cache]', e);
  }
}
