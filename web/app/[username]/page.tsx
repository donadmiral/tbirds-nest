import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ProfilePosts } from "@/components/ProfilePosts";
import { VerifiedBadge } from "@/components/VerifiedBadge";
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
    .select("id, full_name, username, avatar_url, bio, is_verified, verified_tier, account_type")
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
    <main className="mx-auto min-h-screen w-full max-w-[640px] px-4 py-6">
      <Link href="/home" aria-label="Back to Platinum Circles" className="mb-6 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink/60 transition-colors duration-[140ms] hover:bg-surface hover:text-ink">
        <ArrowLeft size={19} />
      </Link>
      <header className="flex items-start gap-5 px-1 pb-7">
        <span className="rounded-full p-[3px] ring-1 ring-pearl/30">
          <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={80} />
        </span>
        <div className="min-w-0 flex-1 pt-1.5">
          <div className="flex items-center gap-1">
            <h1 className="truncate text-[22px] font-semibold text-ink">{p.full_name}</h1>
            {p.is_verified ? <VerifiedBadge tier={p.verified_tier} size={17} /> : null}
          </div>
          <p className="text-[13.5px] text-ink/50">@{p.username}</p>
          {p.bio ? <p className="mt-2.5 whitespace-pre-wrap text-[14.5px] leading-relaxed text-ink/80">{p.bio}</p> : null}
          <p className="mt-3.5 flex gap-5 text-[13px] text-ink/50">
            {!isBusiness ? (
              <Link href={"/" + p.username + "/follows?tab=following"} className="flex items-baseline gap-1.5 transition-colors duration-[140ms] hover:text-ink"><span className="font-display text-[17px] text-porcelain">{following.count ?? 0}</span> Following</Link>
            ) : null}
            <Link href={"/" + p.username + "/follows?tab=followers"} className="flex items-baseline gap-1.5 transition-colors duration-[140ms] hover:text-ink"><span className="font-display text-[17px] text-porcelain">{followers.count ?? 0}</span> Followers</Link>
          </p>
        </div>
      </header>
      <div className="mb-6 px-1">
        <MessageButton profileId={p.id} />
        <ProfileContext profileId={p.id} username={p.username ?? ""} />
      </div>
      <MemoryAlbumBook profileId={p.id} />
      {isBusiness ? (
        <BusinessProfile profileId={p.id} postsSlot={posts} />
      ) : (
        <div className="border-t border-ink/10">{posts}</div>
      )}
    </main>
  );
}