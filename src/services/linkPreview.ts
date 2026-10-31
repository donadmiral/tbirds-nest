/** Link metadata is fetched and cached by the authenticated server. A preview
 * failure falls back to a working URL/domain card and never blocks a post. */
import { supabase } from './supabase';

export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  domain: string | null;
};

export function normalizeUrl(raw: string): string {
  const text=raw.trim();
  return /^https?:\/\//i.test(text)?text:`https://${text}`;
}

export function deriveDomain(url: string): string | null {
  try {return new URL(url).hostname.replace(/^www\./,'');}catch{return null;}
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview> {
  const url=normalizeUrl(rawUrl),domain=deriveDomain(url);
  const fallback: LinkPreview={url,title:null,description:null,image_url:null,domain};
  try {
    const {data,error}=await supabase.functions.invoke('link-preview',{body:{url}});
    if(error || !data || data.error || data.url!==url)return fallback;
    const text=(value: unknown,max: number)=>typeof value==='string'?value.slice(0,max):null;
    return {url,title:text(data.title,200),description:text(data.description,300),image_url:text(data.image_url,4096),domain};
  }catch{return fallback;}
}

// Retain the helper signature for callers from older source snapshots. Only the
// URL is sent to the server; client-supplied metadata is never authoritative.
export async function cacheLinkPreview(preview: LinkPreview): Promise<void> {
  await fetchLinkPreview(preview.url);
}
