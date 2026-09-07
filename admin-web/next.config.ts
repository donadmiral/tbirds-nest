import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    // The vercel address never shows: every visit there is sent to the real domain.
    return [{ source: '/:path*', has: [{ type: 'host', value: '.*\\.vercel\\.app' }], destination: 'https://admin.platinumcircles.app/:path*', permanent: true }];
  },
  /* config options here */
};

export default nextConfig;
