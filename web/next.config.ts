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
};

export default nextConfig;
