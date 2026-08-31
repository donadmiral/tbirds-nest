import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";

/**
 * The sitemap lists what a visitor without an account can open: public
 * profiles, public posts and open jobs. It reads with the anon key, so
 * anything RLS hides from anonymous users is also hidden from search engines.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://platinumcircles.com";
  const fixed: MetadataRoute.Sitemap = [
    { url: site, changeFrequency: "daily", priority: 1 },
    { url: site + "/discover", changeFrequency: "hourly", priority: 0.8 },
    { url: site + "/jobs", changeFrequency: "daily", priority: 0.7 },
    { url: site + "/market", changeFrequency: "daily", priority: 0.7 },
  ];

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return fixed;
  const supabase = createClient(url, key);

  const [profiles, posts, jobs] = await Promise.all([
    supabase.from("profiles").select("username, updated_at").not("username", "is", null).is("deactivated_at", null).order("updated_at", { ascending: false }).limit(2000),
    supabase.from("posts").select("id, created_at").is("community_id", null).order("created_at", { ascending: false }).limit(5000),
    supabase.from("jobs").select("id, created_at").or("deadline.is.null,deadline.gt." + new Date().toISOString()).order("created_at", { ascending: false }).limit(2000),
  ]);

  return [
    ...fixed,
    ...((profiles.data ?? []) as { username: string; updated_at: string | null }[]).map((p) => ({
      url: site + "/" + p.username,
      lastModified: p.updated_at ? new Date(p.updated_at) : undefined,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...((posts.data ?? []) as { id: string; created_at: string }[]).map((p) => ({
      url: site + "/post/" + p.id,
      lastModified: new Date(p.created_at),
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
    ...((jobs.data ?? []) as { id: string; created_at: string }[]).map((j) => ({
      url: site + "/jobs/" + j.id,
      lastModified: new Date(j.created_at),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
