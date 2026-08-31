import { serviceClient } from './supabaseAdmin';

/**
 * Media resolution for the desks.
 *
 * Two problems this solves. Tables name their media column differently, so
 * pickMedia scans a row for anything that actually looks like a media
 * reference rather than assuming a column name. And a public URL against a
 * private bucket returns 403 and renders as nothing, so resolveMedia signs
 * every storage path with the service key before it reaches the browser.
 */

const VIDEO_RX = /\.(mp4|mov|m4v|webm|hevc|avi|mkv|3gp)(\?|$)/i;
const IMAGE_RX = /\.(jpg|jpeg|png|gif|webp|heic|heif|avif|bmp)(\?|$)/i;
const OBJECT_RX = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?|$)/;
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

type Job = { raw: string; bucket: string | null; path: string };

/**
 * Turn raw values into URLs a browser can actually load.
 * Absolute non-storage URLs pass straight through. Storage URLs and bare
 * paths are signed, in one batch per bucket, so private buckets work.
 */
export async function resolveMedia(values: (string | null | undefined)[], ttlSeconds = 3600): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const raws = Array.from(new Set(values.filter((v): v is string => !!v && v.trim() !== '')));
  if (raws.length === 0) return map;

  const svc = serviceClient();
  const jobs: Job[] = [];

  for (const raw of raws) {
    const object = raw.match(OBJECT_RX);
    if (object) {
      jobs.push({ raw, bucket: object[1], path: decodeURIComponent(object[2]) });
      continue;
    }
    if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
      map[raw] = raw;
      continue;
    }
    const clean = raw.replace(/^\/+/, '');
    const slash = clean.indexOf('/');
    jobs.push(slash > 0
      ? { raw, bucket: clean.slice(0, slash), path: clean.slice(slash + 1) }
      : { raw, bucket: null, path: clean });
  }

  if (jobs.length === 0) return map;

  let bucketNames: string[] = [];
  const publicBuckets = new Set<string>();
  try {
    const { data } = await svc.storage.listBuckets();
    bucketNames = (data ?? []).map(b => b.name);
    (data ?? []).forEach(b => { if (b.public) publicBuckets.add(b.name); });
  } catch { bucketNames = []; }

  // Images in public buckets go through the render endpoint, exactly as the
  // web app does. It resizes, so thumbnails stop pulling full-size originals,
  // and it decodes formats a raw <img> refuses, which is why one story that
  // rendered on web showed broken here.
  const RENDER_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '') + '/storage/v1/render/image/public/';
  const isImagePath = (path: string) => /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(path.split('?')[0]);

  const byBucket: Record<string, Job[]> = {};
  const orphans: Job[] = [];
  for (const job of jobs) {
    if (job.bucket && (bucketNames.length === 0 || bucketNames.includes(job.bucket))) {
      (byBucket[job.bucket] = byBucket[job.bucket] || []).push(job);
    } else if (job.bucket) {
      // first segment was a folder, not a bucket
      orphans.push({ raw: job.raw, bucket: null, path: job.bucket + '/' + job.path });
    } else {
      orphans.push(job);
    }
  }

  async function sign(bucket: string, group: Job[]) {
    if (group.length === 0) return;
    if (publicBuckets.has(bucket) && RENDER_BASE.length > 40) {
      const rest: Job[] = [];
      for (const j of group) {
        if (isImagePath(j.path)) map[j.raw] = RENDER_BASE + bucket + '/' + j.path.split('?')[0].split('/').map(encodeURIComponent).join('/') + '?width=900&quality=80';
        else rest.push(j);
      }
      group = rest;
      if (group.length === 0) return;
    }
    try {
      const { data } = await svc.storage.from(bucket).createSignedUrls(group.map(j => j.path), ttlSeconds);
      (data ?? []).forEach((row, i) => {
        const job = group[i];
        if (row && !row.error && row.signedUrl && job) map[job.raw] = row.signedUrl;
      });
    } catch { /* bucket refused, other buckets may still answer */ }
  }

  await Promise.all(Object.keys(byBucket).map(b => sign(b, byBucket[b])));

  if (orphans.length) {
    const candidates = bucketNames
      .slice()
      .sort((a, b) => Number(/media|post|story|upload|public/i.test(b)) - Number(/media|post|story|upload|public/i.test(a)))
      .slice(0, 4);
    for (const bucket of candidates) {
      const left = orphans.filter(j => !map[j.raw]);
      if (left.length === 0) break;
      await sign(bucket, left);
    }
  }

  // anything still unresolved falls back to the raw value
  for (const job of jobs) if (!map[job.raw]) map[job.raw] = job.raw;
  return map;
}
