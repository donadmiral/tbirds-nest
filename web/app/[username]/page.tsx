import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProfilePosts } from "@/components/ProfilePosts";
import { VerifiedBadge, getTierColor } from "@/components/VerifiedBadge";
import { CalendarDays, MapPin } from "lucide-react";
import { StoryAvatar } from "@/components/StoryAvatar";
import { BusinessProfile } from "@/components/BusinessProfile";
import { MemoryAlbumBook } from "@/components/MemoryAlbumBook";
import { MessageButton } from "@/components/MessageButton";
import { ProfileContext } from "@/components/ProfileContext";

type Params = { params: Promise<{ username: string }> };

async function loadProfile(username: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url, bio, is_verified, verified_tier, account_type, banner_url, headline, location, created_at")
    .ilike("username", username)
    .limit(1)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  const p = await loadProfile(username);
  if (!p) return { title: "Platinum Circles" };
  return {
    title: (p.full_name ?? p.username) + " (@" + p.username + ") on Platinum Circles",
    description: p.bio ?? "See " + (p.full_name ?? p.username) + " on Platinum Circles.",
  };
}

export default async function ProfilePage({ params }: Params) {
  const { username } = await params;
  const supabase = await createClient();
  const p = await loadProfile(username);

  if (!p) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="font-display text-2xl text-porcelain">Profile not found</h1>
        <Link href="/" className="mt-2 rounded-full bg-pearl px-5 py-2.5 text-sm font-bold text-ink transition-opacity duration-[140ms] hover:opacity-90">
          Open Platinum Circles
        </Link>
      </main>
    );
  }

  const isBusiness = p.account_type === "business";
  const [followers, following] = await Promise.all([
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", p.id),
    supabase.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", p.id),
  ]);

  const posts = (
    <ProfilePosts profileId={p.id}
      authorName={p.full_name}
      authorUsername={p.username}
      authorAvatar={p.avatar_url}
      authorVerified={!!p.is_verified}
    />
  );

  return (
    <main>
      <header className="mb-4 overflow-hidden rounded-2xl border border-ink/10 bg-white">
        {/* banner_url, headline and location were on the profile all along and
            nothing rendered them. */}
        {p.banner_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.banner_url} alt="" className="h-[140px] w-full object-cover" />
        ) : (
          <div className="h-[92px] w-full bg-gradient-to-br from-pearl/25 via-surface to-navy/10" />
        )}
        <div className="flex items-start gap-5 px-5 pb-5">
        <span className="-mt-9 shrink-0 rounded-full bg-white p-[3px] ring-1 ring-pearl/30">
          <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={84} />
        </span>
        <div className="min-w-0 flex-1 pt-1.5">
          <div className="flex items-center gap-1">
            <h1 className="truncate text-[22px] font-semibold text-ink" style={p.is_verified ? { color: getTierColor(p.verified_tier) ?? undefined } : undefined}>{p.full_name}</h1>
            {p.is_verified ? <VerifiedBadge tier={p.verified_tier} size={17} /> : null}
          </div>
          <p className="text-[13.5px] text-ink/50">@{p.username}</p>
          {p.headline ? <p className="mt-1.5 text-[14px] text-ink/70">{p.headline}</p> : null}
          {p.bio ? <p className="mt-2.5 whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink/80">{p.bio}</p> : null}
          {p.location || p.created_at ? (
            <p className="mt-2 flex flex-wrap items-center gap-3.5 text-[12.5px] text-ink/45">
              {p.location ? <span className="flex items-center gap-1"><MapPin size={12} /> {p.location}</span> : null}
              {p.created_at ? (
                <span className="flex items-center gap-1">
                  <CalendarDays size={12} /> Joined {new Date(p.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                </span>
              ) : null}
            </p>
          ) : null}
          <p className="mt-3.5 flex gap-5 text-[13px] text-ink/50">
            {!isBusiness ? (
              <Link href={"/" + p.username + "/follows?tab=following"} className="flex items-baseline gap-1.5 transition-colors duration-[140ms] hover:text-ink"><span className="font-display text-[17px] text-porcelain">{following.count ?? 0}</span> Following</Link>
            ) : null}
            <Link href={"/" + p.username + "/follows?tab=followers"} className="flex items-baseline gap-1.5 transition-colors duration-[140ms] hover:text-ink"><span className="font-display text-[17px] text-porcelain">{followers.count ?? 0}</span> Followers</Link>
          </p>
        </div>
        </div>
      </header>
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white px-5 py-4">
        <MessageButton profileId={p.id} />
        <ProfileContext profileId={p.id} username={p.username ?? ""} />
      </div>
      <MemoryAlbumBook profileId={p.id} />
      {isBusiness ? (
        <BusinessProfile profileId={p.id} postsSlot={posts} />
      ) : (
        <div>{posts}</div>
      )}
    </main>
  );
}