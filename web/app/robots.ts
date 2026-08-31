import type { MetadataRoute } from "next";

// Public pages are indexable; anything personal or transactional is not.
export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://platinumcircles.com";
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/post/", "/jobs/", "/market/", "/discover", "/channels", "/communities"],
      disallow: ["/home", "/messages", "/notifications", "/saved", "/settings", "/studio", "/ads", "/write", "/story/", "/login", "/signup", "/business-login", "/archive"],
    },
    sitemap: site + "/sitemap.xml",
  };
}
