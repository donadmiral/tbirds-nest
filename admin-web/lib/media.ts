import 'server-only';
import { serviceClient } from './supabaseAdmin';
import { publicMediaUrl } from './publicMedia';

/** Discover content media references, then resolve only explicitly public content buckets. */

const VIDEO_RX = /\.(mp4|mov|m4v|webm|hevc|avi|mkv|3gp)(\?|$)/i;
const IMAGE_RX = /\.(jpg|jpeg|png|gif|webp|heic|heif|avif|bmp)(\?|$)/i;
const MEDIA_KEY_RX = /(media|image|img|photo|picture|thumb|cover|banner|avatar|video|url|asset|attachment|file)/i;

export function isVideoUrl(u: string | null | undefined): boolean {
  return !!u && VIDEO_RX.test(u);
}

function looksLikeMedia(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 2048) return false;
  if (VIDEO_RX.test(v) || IMAGE_RX.test(v)) return true;
  if (/^https?:\/\//i.test(v) && /(storage|cdn|media|image|photo|video)/i.test(v)) return true;
  return false;
}

/** Every media reference on a row, in column order, whatever the columns are called. */
export function pickAllMedia(row: Record<string, unknown> | null | undefined): string[] {
  if (!row) return [];
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && looksLikeMedia(v)) { if (!out.includes(v)) out.push(v); }
  };
  for (const key of Object.keys(row)) {
    const v = row[key];
    if (typeof v === 'string') {
      if (MEDIA_KEY_RX.test(key) || looksLikeMedia(v)) push(v);
    } else if (Array.isArray(v)) {
      v.forEach(item => {
        if (typeof item === 'string') push(item);
        else if (item && typeof item === 'object') Object.values(item as Record<string, unknown>).forEach(push);
      });
    } else if (v && typeof v === 'object') {
      Object.values(v as Record<string, unknown>).forEach(push);
    }
  }
  return out;
}

/** The first media reference on a row, or null. */
export function pickMedia(row: Record<string, unknown> | null | undefined): string | null {
  return pickAllMedia(row)[0] ?? null;
}

/** Fail closed for private, unknown, cross-project and malformed references. */
export async function resolveMedia(values: (string | null | undefined)[]): Promise<Record<string, string>> {
  const map: Record<string, string> = Object.create(null);
  const raws = [...new Set(values.filter((v): v is string => typeof v === 'string' && !!v.trim()))];
  if (!raws.length) return map;
  const { data, error } = await serviceClient().storage.listBuckets();
  const publicBuckets = new Set(error ? [] : (data ?? []).filter(b => b.public === true).map(b => b.id));
  for (const raw of raws) {
    map[raw] = publicMediaUrl(raw, process.env.NEXT_PUBLIC_SUPABASE_URL || '', publicBuckets) || '';
  }
  return map;
}
