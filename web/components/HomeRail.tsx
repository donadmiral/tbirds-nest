"use client";

/**
 * The Home rail.
 *
 * Discovery panels (trending, suggestions) are shared across routes, so they
 * stay in DiscoveryRail. These two are Home's own: what is coming up, and how
 * your own week is going.
 *
 * Every number here is queried, never estimated. A panel with nothing to show
 * hides itself rather than displaying zeroes, because an empty rail reads as
 * calm and a rail of zeroes reads as broken.
 */
import { useAccountResource } from "@/lib/useAccountResource";
import { Eye, Heart, PenLine, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DiscoveryRail } from "@/components/DiscoveryRail";
import { Panel } from "@/components/ui";



type Activity = { posts: number; views: number; engagement: number; followers: number };

async function loadActivity(supabase: ReturnType<typeof createClient>, uid: string): Promise<Activity> {
  const since=new Date(Date.now()-7*86400000).toISOString();
  const [posts,mine,followers]=await Promise.all([
    supabase.from("posts").select("id",{count:"exact",head:true}).eq("user_id",uid).gte("created_at",since),
    supabase.from("posts").select("likes_count, comments_count, views_count").eq("user_id",uid).gte("created_at",since),
    supabase.from("follows").select("follower_id",{count:"exact",head:true}).eq("following_id",uid).gte("created_at",since),
  ]);
  if(posts.error||mine.error||followers.error||posts.count===null||followers.count===null)throw new Error("Your activity could not load.");
  const rows=(mine.data??[]) as {likes_count:number|null;comments_count:number|null;views_count:number|null}[];
  if(rows.length!==posts.count)throw new Error("Your complete activity could not load. Please try again.");
  return {posts:posts.count,views:rows.reduce((n,row)=>n+(row.views_count??0),0),engagement:rows.reduce((n,row)=>n+(row.likes_count??0)+(row.comments_count??0),0),followers:followers.count};
}
function YourActivity() {
  const resource=useAccountResource<Activity|null>(loadActivity,null);
  if(resource.error)return <Panel title="Your activity"><p className="text-sm text-muted" role="status">{resource.error}</p><button type="button" className="mt-2 min-h-11 text-sm font-semibold text-ink" onClick={resource.retry}>Try again</button></Panel>;
  const a=resource.data;
  if (!a || (a.posts === 0 && a.views === 0 && a.engagement === 0 && a.followers === 0)) return null;

  const cells = [
    { label: "Posts", n: a.posts, icon: PenLine },
    { label: "Views", n: a.views, icon: Eye },
    { label: "Engagement", n: a.engagement, icon: Heart },
    { label: "New followers", n: a.followers, icon: Users },
  ];

  return (
    <Panel title="Your activity" action="This week" actionHref="/studio">
      <div className="grid grid-cols-2 gap-3">
        {cells.map((c) => (
          <div key={c.label} className="rounded-xl bg-surface px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
              <c.icon size={12} /> {c.label}
            </span>
            <span className="mt-0.5 block font-display text-[20px] leading-tight text-porcelain">{c.n.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function HomeRail() {
  return (
    <>
      <DiscoveryRail />
      <YourActivity />
    </>
  );
}

/** Discover leads with what is moving rather than with your own numbers. */
export function DiscoverRail() {
  return (
    <>
      <DiscoveryRail />
    </>
  );
}

export { YourActivity };
