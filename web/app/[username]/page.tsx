import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ProfilePosts } from "@/components/ProfilePosts";
import { VerifiedBadge, getTierColor } from "@/components/VerifiedBadge";
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
    .select("id, full_name, username, avatar_url, banner_url, bio, is_verified, verified_tier, account_type")
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

function fmtCount(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(n);
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
  const [followers, following, postCount] = await Promise.all([
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", p.id),
    supabase.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", p.id),
    supabase.from("posts").select("id", { count: "exact", head: true }).eq("user_id", p.id),
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
      <header className="-mx-4 pb-6">
        <div className="h-[164px] w-full border-b-2 border-pearl bg-navy">
          {p.banner_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.banner_url} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="px-4">
          <div className="-mt-[55px] mb-1 flex justify-center">
            <span className="flex h-[106px] w-[106px] items-center justify-center rounded-full ring-1 ring-pearl/30">
              <span className="rounded-full border-[3px] border-white bg-surface">
                <StoryAvatar userId={p.id} name={p.full_name} avatarUrl={p.avatar_url} size={92} />
              </span>
            </span>
          </div>

          <div className="flex items-center justify-center gap-[3px]">
            <h1
              className="truncate text-[22px] font-bold tracking-[-0.6px] text-ink"
              style={p.is_verified ? { color: getTierColor(p.verified_tier) ?? undefined } : undefined}
            >
              {p.full_name}
            </h1>
            {p.is_verified ? <VerifiedBadge tier={p.verified_tier} size={17} /> : null}
          </div>
          <p className="text-center text-[13.5px] text-ink/50">@{p.username}</p>
          {p.bio ? (
            <p className="mx-auto mt-2.5 max-w-[420px] whitespace-pre-wrap text-center text-[14.5px] leading-relaxed text-ink/80">{p.bio}</p>
          ) : null}

          {/* One segmented capsule, as on the phone: followers, following and
              posts read as a single control rather than three loose links. */}
          <div className="mt-4 flex justify-center">
            <div className="flex overflow-hidden rounded-full border border-ink/10 bg-pearl/10">
              <Link
                href={"/" + p.username + "/follows?tab=followers"}
                className="flex min-w-[92px] flex-col items-center px-4 py-2 transition-colors duration-[140ms] hover:bg-pearl/20"
              >
                <span className="text-[16px] font-bold text-ink">{fmtCount(followers.count ?? 0)}</span>
                <span className="text-[11.5px] text-ink/50">Followers</span>
              </Link>
              {!isBusiness ? (
                <Link
                  href={"/" + p.username + "/follows?tab=following"}
                  className="flex min-w-[92px] flex-col items-center border-l border-ink/10 px-4 py-2 transition-colors duration-[140ms] hover:bg-pearl/20"
                >
                  <span className="text-[16px] font-bold text-ink">{fmtCount(following.count ?? 0)}</span>
                  <span className="text-[11.5px] text-ink/50">Following</span>
                </Link>
              ) : null}
              <div className="flex min-w-[92px] flex-col items-center border-l border-ink/10 px-4 py-2">
                <span className="text-[16px] font-bold text-ink">{fmtCount(postCount.count ?? 0)}</span>
                <span className="text-[11.5px] text-ink/50">Posts</span>
              </div>
            </div>
          </div>
        </div>
      </header>
      <div className="mb-6 flex flex-col items-center gap-2 px-1">
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