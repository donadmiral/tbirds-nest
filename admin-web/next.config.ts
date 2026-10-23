import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // Keep preview builds on their own origin so they can be reviewed safely.
    if (process.env.VERCEL_ENV !== 'production') return [];
    return [{ source: '/:path*', has: [{ type: 'host', value: '.*\\.vercel\\.app' }], destination: 'https://admin.platinumcircles.app/:path*', permanent: true }];
  },
  /* config options here */
};

export default nextConfig;
