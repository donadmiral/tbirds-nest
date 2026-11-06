import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Reuse recently visited dynamic routes in this browser. Authentication
  // changes discard the entire document/cache in NavigationSessionBoundary.
  // Data is still fetched per request on the server; this is not a shared cache.
  experimental: { staleTimes: { dynamic: 300, static: 300 } },
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  async rewrites() {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(base)) return [];
    return [{ source: '/api/live/social-pull/:id/clip.mp4', destination: base.replace(/\/$/, '') + '/functions/v1/live-social-pull/:id/clip.mp4' }];
  },
  async headers() {
    return [{ source: '/api/live/social-pull/:id/clip.mp4', headers: [
      { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
      { key: 'CDN-Cache-Control', value: 'no-store' },
      { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
      { key: 'x-vercel-enable-rewrite-caching', value: '0' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
    ] }];
  },
};

export default nextConfig;
